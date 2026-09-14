'use strict';

/**
 * Seleciona somente artefatos gerados pelo Veracode Auto Packager
 * no diretório de saída isolado. Nunca escolhe ZIP do workspace.
 *
 * Com vários artefatos, descompacta cada ZIP numa pasta, copia
 * JAR/WAR/EAR/APK como módulo e gera um único ZIP plano (sem ZIP aninhado).
 *
 * Bash: node "$GITHUB_ACTION_PATH/select-artifacts.js" <outputDir> <bundlePath>
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { message, fail } = require('./messages');

const SCAN_EXTENSIONS = new Set([
    '.zip',
    '.jar',
    '.war',
    '.ear',
    '.apk',
    '.ipa',
    '.aab'
]);

const EXTRACT_EXTENSIONS = new Set(['.zip']);

const LOG_PATTERNS = [
    /Package created:\s+(\S+)/i,
    /zipped and saved to:\s+(\S+)/i,
    /packaged to:\s+(\S+)/i,
    /Copied artifact:\s+(\S+)/i,
    /packaged to\s+(\S+)/i
];

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function listPackagerArtifacts(outputDir) {
    if (!outputDir || !fs.existsSync(outputDir)) {
        return [];
    }
    const files = [];
    for (const ent of fs.readdirSync(outputDir, { withFileTypes: true })) {
        if (!ent.isFile()) {
            continue;
        }
        const ext = path.extname(ent.name).toLowerCase();
        if (!SCAN_EXTENSIONS.has(ext)) {
            continue;
        }
        files.push(path.join(outputDir, ent.name));
    }
    files.sort();
    return files;
}

function normalizeLogPath(raw) {
    return String(raw || '').replace(/[.,;]+$/, '');
}

function parsePackageLog(logText) {
    const found = [];
    const seen = new Set();
    for (const line of String(logText || '').split(/\r?\n/)) {
        for (const pattern of LOG_PATTERNS) {
            const match = line.match(pattern);
            if (!match) {
                continue;
            }
            const artifact = normalizeLogPath(match[1]);
            if (!artifact || seen.has(artifact)) {
                break;
            }
            seen.add(artifact);
            found.push(artifact);
            break;
        }
    }
    return found;
}

function writeStoreZipEntries(files, destPath) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        localParts.push(local, nameBuf, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBuf);

        offset += local.length + nameBuf.length + data.length;
    }

    const centralDir = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.concat([...localParts, centralDir, eocd]));
}

function createStoreZip(filePaths, destPath) {
    const files = filePaths.map((filePath) => ({
        name: path.basename(filePath).replace(/\\/g, '/'),
        data: fs.readFileSync(filePath)
    }));
    writeStoreZipEntries(files, destPath);
}

function findEocdOffset(buf) {
    const maxScan = Math.min(buf.length, 22 + 65535);
    for (let i = buf.length - 22; i >= buf.length - maxScan; i--) {
        if (i < 0) {
            break;
        }
        if (buf.readUInt32LE(i) !== 0x06054b50) {
            continue;
        }
        const commentLen = buf.readUInt16LE(i + 20);
        if (i + 22 + commentLen === buf.length) {
            return i;
        }
    }
    throw new Error('Arquivo ZIP inválido: EOCD não encontrado.');
}

function listCentralDirectory(buf) {
    const eocd = findEocdOffset(buf);
    const entryCount = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (entryCount === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
        throw new Error('Arquivo ZIP64 não é suportado.');
    }
    const entries = [];
    let offset = cdOffset;
    for (let i = 0; i < entryCount; i++) {
        if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('Arquivo ZIP inválido: diretório central corrompido.');
        }
        const method = buf.readUInt16LE(offset + 10);
        const compSize = buf.readUInt32LE(offset + 20);
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        const localOffset = buf.readUInt32LE(offset + 42);
        const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
        entries.push({ method, compSize, localOffset, name });
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

function resolveUnder(rootDir, relativeName) {
    const normalized = String(relativeName || '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter((part) => part && part !== '.');
    if (parts.some((part) => part === '..')) {
        throw new Error(`Caminho inseguro no ZIP: ${relativeName}`);
    }
    const dest = path.resolve(rootDir, ...parts);
    const root = path.resolve(rootDir);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
        throw new Error(`Caminho inseguro no ZIP: ${relativeName}`);
    }
    return dest;
}

function inflateEntry(buf, entry) {
    const lo = entry.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) {
        throw new Error(`Arquivo ZIP inválido: header local ausente (${entry.name}).`);
    }
    const nameLen = buf.readUInt16LE(lo + 26);
    const extraLen = buf.readUInt16LE(lo + 28);
    const dataStart = lo + 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) {
        return compressed;
    }
    if (entry.method === 8) {
        return zlib.inflateRawSync(compressed);
    }
    throw new Error(`Compressão ZIP não suportada (${entry.method}) em ${entry.name}.`);
}

function extractZip(zipPath, destDir) {
    const buf = fs.readFileSync(zipPath);
    const entries = listCentralDirectory(buf);
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of entries) {
        const name = String(entry.name || '').replace(/\\/g, '/');
        if (!name || name.endsWith('/')) {
            continue;
        }
        const dest = resolveUnder(destDir, name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, inflateEntry(buf, entry));
    }
}

function collectFiles(dir, prefix = '') {
    const files = [];
    if (!fs.existsSync(dir)) {
        return files;
    }
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            files.push(...collectFiles(abs, rel));
        } else if (ent.isFile()) {
            files.push({
                name: rel.replace(/\\/g, '/'),
                data: fs.readFileSync(abs)
            });
        }
    }
    return files;
}

function flattenArtifacts(artifacts, stagingDir) {
    fs.mkdirSync(stagingDir, { recursive: true });
    for (const artifact of artifacts) {
        const ext = path.extname(artifact).toLowerCase();
        const base = path.basename(artifact, path.extname(artifact));
        if (EXTRACT_EXTENSIONS.has(ext)) {
            extractZip(artifact, path.join(stagingDir, base));
        } else {
            fs.copyFileSync(artifact, path.join(stagingDir, path.basename(artifact)));
        }
    }
}

function zipDirectory(sourceDir, destPath) {
    const files = collectFiles(sourceDir);
    if (files.length === 0) {
        throw new Error(`Nenhum arquivo para empacotar em ${sourceDir}`);
    }
    writeStoreZipEntries(files, destPath);
}

function resolvePackagerScanFile({ outputDir, bundlePath }) {
    const artifacts = listPackagerArtifacts(outputDir);
    if (artifacts.length === 0) {
        throw fail('NO_PACKAGER_ARTIFACTS', { dir: outputDir });
    }
    if (artifacts.length === 1) {
        return {
            scanFile: artifacts[0],
            artifacts,
            bundled: false
        };
    }
    const stagingDir = path.join(path.dirname(bundlePath), 'flatten-staging');
    try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        flattenArtifacts(artifacts, stagingDir);
        zipDirectory(stagingDir, bundlePath);
    } catch (err) {
        const wrapped = fail('BUNDLE_FAILED', {
            count: String(artifacts.length),
            file: bundlePath
        });
        throw new Error(`${wrapped.message} Detalhe: ${err.message}`);
    } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    return {
        scanFile: bundlePath,
        artifacts,
        bundled: true
    };
}

function toGithubPath(absPath, workspace) {
    if (!workspace) {
        return absPath;
    }
    const rel = path.relative(workspace, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return absPath.split(path.sep).join('/');
    }
    return rel.split(path.sep).join('/');
}

function writeGithubOutput(result, workspace) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        return;
    }
    const scanFile = toGithubPath(result.scanFile, workspace);
    const names = result.artifacts.map((file) => path.basename(file)).join(', ');
    fs.appendFileSync(out, `scan_file=${scanFile}\n`);
    fs.appendFileSync(out, `artifact_count=${result.artifacts.length}\n`);
    fs.appendFileSync(out, `bundled=${result.bundled}\n`);
    fs.appendFileSync(out, `artifact_names=${names}\n`);
}

if (require.main === module) {
    try {
        const [outputDir, bundlePath] = process.argv.slice(2);
        if (!outputDir || !bundlePath) {
            throw new Error('Uso: node select-artifacts.js <outputDir> <bundlePath>');
        }
        const result = resolvePackagerScanFile({ outputDir, bundlePath });
        const workspace = process.env.GITHUB_WORKSPACE || '';
        writeGithubOutput(result, workspace);
        const scanFile = toGithubPath(result.scanFile, workspace);
        process.stdout.write(message('success', 'ARTIFACTS_SELECTED', {
            count: String(result.artifacts.length),
            file: scanFile
        }) + '\n');
        if (result.bundled) {
            process.stdout.write(`::notice::${message('warning', 'MULTIPLE_ARTIFACTS_BUNDLED', {
                count: String(result.artifacts.length),
                file: scanFile
            })}\n`);
        }
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    SCAN_EXTENSIONS,
    listPackagerArtifacts,
    parsePackageLog,
    resolvePackagerScanFile,
    createStoreZip,
    extractZip,
    toGithubPath
};
