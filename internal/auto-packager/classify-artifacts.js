'use strict';

/**
 * Classifica artefatos do Veracode Auto Packager pelo conteúdo do
 * diretório central do ZIP. Não descompacta, não remistura, não rezipa.
 *
 * Bash: node "$GITHUB_ACTION_PATH/classify-artifacts.js" <outputDir> <uploadDir> [maxArtifacts] [manifestPath]
 */

const fs = require('fs');
const path = require('path');
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

const ALWAYS_SCAN_EXTENSIONS = new Set([
    '.jar',
    '.war',
    '.ear',
    '.apk',
    '.ipa',
    '.aab'
]);

const BINARY_EXTENSIONS = new Set([
    '.dll',
    '.exe',
    '.class',
    '.jar',
    '.war',
    '.ear',
    '.aar',
    '.so',
    '.dylib'
]);

const CODE_EXTENSIONS = new Set([
    '.java',
    '.jsp',
    '.jspx',
    '.cs',
    '.vb',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.vue',
    '.py',
    '.go',
    '.php',
    '.rb',
    '.erb',
    '.scala',
    '.kt',
    '.kts',
    '.groovy',
    '.swift',
    '.m',
    '.mm',
    '.c',
    '.cc',
    '.cpp',
    '.h',
    '.hpp',
    '.i',
    '.cfm',
    '.cfc',
    '.cbl',
    '.cob',
    '.cpy',
    '.cls',
    '.trigger',
    ...BINARY_EXTENSIONS
]);

const WEAK_EXTENSIONS = new Set([
    '.html',
    '.htm',
    '.sh',
    '.bat',
    '.ps1',
    '.cmd',
    '.sql',
    '.pks',
    '.pkb',
    '.trg',
    '.pl',
    '.pm',
    '.pyc'
]);

const NOISE_EXTENSIONS = new Set([
    '.json',
    '.map',
    '.yaml',
    '.yml',
    '.lock',
    '.css',
    '.md',
    '.txt',
    '.xml',
    '.csv',
    '.properties',
    '.toml',
    '.ini',
    '.scss',
    '.less',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.webp',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.otf'
]);

const TEST_SEGMENTS = new Set([
    'test',
    'tests',
    'spec',
    'specs',
    '__tests__',
    'e2e'
]);

const DEP_SEGMENTS = new Set([
    'node_modules',
    'vendor',
    '.venv',
    'venv',
    '__pycache__',
    'site-packages'
]);

const DEFAULT_MAX_ARTIFACTS = 6;
const LANGUAGE_TAGS = [
    'preprocessed_c_cpp',
    'ios-xcarchive',
    'ios-podfile',
    'dotnet-js',
    'dotnet',
    'python',
    'cobol',
    'msvc',
    'ruby',
    'php',
    'sql',
    'ios',
    'go',
    'js'
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

function parseMaxArtifacts(value) {
    const n = Number.parseInt(String(value == null || value === '' ? DEFAULT_MAX_ARTIFACTS : value), 10);
    if (!Number.isFinite(n) || n < 1) {
        return DEFAULT_MAX_ARTIFACTS;
    }
    return Math.min(n, DEFAULT_MAX_ARTIFACTS);
}

function listPackagerArtifacts(outputDir) {
    if (!outputDir || !fs.existsSync(outputDir)) {
        return [];
    }
    const files = [];
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(abs);
                continue;
            }
            if (!ent.isFile()) {
                continue;
            }
            const ext = path.extname(ent.name).toLowerCase();
            if (SCAN_EXTENSIONS.has(ext)) {
                files.push(abs);
            }
        }
    };
    walk(outputDir);
    files.sort();
    return files;
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
        const crc = buf.readUInt32LE(offset + 16);
        const uncompSize = buf.readUInt32LE(offset + 24);
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
        entries.push({ crc, size: uncompSize, name });
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
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

function extensionOf(fileName) {
    const base = String(fileName || '').split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) {
        return '';
    }
    return base.slice(dot).toLowerCase();
}

function isTestFileName(base) {
    if (/\.test\./i.test(base)) {
        return true;
    }
    if (/\.spec\./i.test(base)) {
        return true;
    }
    if (/_test\.go$/i.test(base)) {
        return true;
    }
    if (/^test_.*\.py$/i.test(base)) {
        return true;
    }
    if (/Test\.java$/i.test(base)) {
        return true;
    }
    if (/Tests\.cs$/i.test(base)) {
        return true;
    }
    return false;
}

function pathSegments(relativeName) {
    return String(relativeName || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);
}

function languageTag(fileName) {
    const lower = String(fileName || '').toLowerCase();
    for (const tag of LANGUAGE_TAGS) {
        if (lower.endsWith(`-${tag}.zip`)) {
            return tag;
        }
    }
    const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
    if (ext && ext !== 'zip') {
        return ext;
    }
    return '';
}

function entryKind(ext) {
    if (CODE_EXTENSIONS.has(ext)) {
        return 'code';
    }
    if (WEAK_EXTENSIONS.has(ext)) {
        return 'weak';
    }
    if (NOISE_EXTENSIONS.has(ext) || ext === '') {
        return 'noise';
    }
    return 'noise';
}

function inspectZipEntry(relativeName, crc, size) {
    const normalized = String(relativeName || '').replace(/\\/g, '/');
    if (!normalized || normalized.endsWith('/')) {
        return null;
    }
    const segments = pathSegments(normalized);
    const base = segments[segments.length - 1] || '';
    const ext = extensionOf(base);
    const isTest = segments.some((seg) => TEST_SEGMENTS.has(seg.toLowerCase()))
        || isTestFileName(base);
    const isDep = segments.some((seg) => DEP_SEGMENTS.has(seg.toLowerCase()));
    const isBinary = BINARY_EXTENSIONS.has(ext);
    const kind = entryKind(ext);
    const countsTowardFirstParty = kind === 'code' && size > 0 && !isTest && (!isDep || isBinary);
    return {
        name: normalized,
        base,
        ext,
        crc,
        size,
        kind,
        isTest,
        isDep,
        isBinary,
        countsTowardFirstParty
    };
}

function inspectZip(zipPath) {
    try {
        const buf = fs.readFileSync(zipPath);
        const listed = listCentralDirectory(buf);
        const entries = [];
        for (const item of listed) {
            const entry = inspectZipEntry(item.name, item.crc, item.size);
            if (entry) {
                entries.push(entry);
            }
        }
        return { parseError: false, entries };
    } catch (_) {
        return { parseError: true, entries: [] };
    }
}

function fileSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch (_) {
        return 0;
    }
}

function inspectArtifact(filePath) {
    const name = path.basename(filePath);
    const ext = path.extname(name).toLowerCase();
    const size = fileSize(filePath);
    const language = languageTag(name);
    const counts = {
        code: 0,
        emptyCode: 0,
        test: 0,
        noise: 0,
        dependency: 0,
        weak: 0
    };

    if (size === 0) {
        return {
            path: filePath,
            name,
            size,
            language,
            alwaysScan: false,
            parseError: false,
            emptySourceOnly: true,
            firstPartyCode: 0,
            codeBytes: 0,
            identities: [],
            counts
        };
    }

    if (ALWAYS_SCAN_EXTENSIONS.has(ext)) {
        return {
            path: filePath,
            name,
            size,
            language,
            alwaysScan: true,
            parseError: false,
            firstPartyCode: 1,
            codeBytes: size,
            identities: [`file:${size}:${name.toLowerCase()}`],
            counts: { ...counts, code: 1 }
        };
    }

    const inspected = inspectZip(filePath);
    if (inspected.parseError) {
        return {
            path: filePath,
            name,
            size,
            language,
            alwaysScan: true,
            parseError: true,
            firstPartyCode: 1,
            codeBytes: size,
            identities: [`file:${size}:${name.toLowerCase()}`],
            counts
        };
    }

    const identities = [];
    let firstPartyCode = 0;
    let codeBytes = 0;
    for (const entry of inspected.entries) {
        if (entry.isTest) {
            counts.test += 1;
        }
        if (entry.isDep) {
            counts.dependency += 1;
        }
        if (entry.kind === 'code' && entry.size === 0) {
            counts.emptyCode += 1;
        } else if (entry.kind === 'code') {
            counts.code += 1;
        } else if (entry.kind === 'weak') {
            counts.weak += 1;
        } else {
            counts.noise += 1;
        }
        if (entry.countsTowardFirstParty) {
            firstPartyCode += 1;
            codeBytes += Number(entry.size) || 0;
            identities.push(`${entry.crc}:${entry.size}:${entry.base.toLowerCase()}`);
        }
    }

    const hasPayload = inspected.entries.some((entry) => entry.size > 0);
    const hasEmptySource = inspected.entries.some((entry) => (
        entry.kind === 'code' && entry.size === 0 && !entry.isTest && !entry.isDep
    ));
    const hasNonEmptyPotential = inspected.entries.some((entry) => (
        entry.size > 0 && (entry.kind !== 'noise' || !NOISE_EXTENSIONS.has(entry.ext))
    ));
    return {
        path: filePath,
        name,
        size,
        language,
        alwaysScan: false,
        parseError: false,
        emptySourceOnly: !hasPayload || (hasEmptySource && !hasNonEmptyPotential),
        firstPartyCode,
        codeBytes,
        identities,
        counts
    };
}

function identitySet(artifact) {
    return new Set(artifact.identities);
}

function isSubset(child, parent) {
    if (child.size === 0) {
        return false;
    }
    for (const item of child) {
        if (!parent.has(item)) {
            return false;
        }
    }
    return true;
}

function classifyArtifacts(artifacts, maxArtifacts) {
    const inspected = artifacts.map(inspectArtifact);
    const skip = new Map();

    for (const item of inspected) {
        if (!item.alwaysScan && item.firstPartyCode === 0) {
            skip.set(item.path, item.emptySourceOnly
                ? 'artefato com conteúdo vazio; sem código analisável pelo Pipeline Scan'
                : 'sem código analisável pelo Pipeline Scan');
        }
    }

    const remaining = inspected.filter((item) => !skip.has(item.path));
    remaining.sort((a, b) => a.name.localeCompare(b.name));

    for (const candidate of remaining) {
        if (candidate.alwaysScan) {
            continue;
        }
        const child = identitySet(candidate);
        for (const other of remaining) {
            if (other.path === candidate.path) {
                continue;
            }
            const parent = identitySet(other);
            if (!isSubset(child, parent)) {
                continue;
            }
            if (child.size < parent.size) {
                skip.set(candidate.path, `coberto por ${other.name}`);
                break;
            }
            if (child.size === parent.size && other.name.localeCompare(candidate.name) < 0) {
                skip.set(candidate.path, `coberto por ${other.name}`);
                break;
            }
        }
    }

    let scanList = inspected.filter((item) => !skip.has(item.path));
    let coverageGuard = false;
    const guardCandidates = inspected.filter((item) => !item.emptySourceOnly);
    if (scanList.length === 0 && guardCandidates.length > 0) {
        coverageGuard = true;
        scanList = guardCandidates;
        for (const item of guardCandidates) {
            skip.delete(item.path);
            item.coverageGuard = true;
        }
    }

    scanList.sort((a, b) => {
        if (b.firstPartyCode !== a.firstPartyCode) {
            return b.firstPartyCode - a.firstPartyCode;
        }
        if (b.codeBytes !== a.codeBytes) {
            return b.codeBytes - a.codeBytes;
        }
        return a.name.localeCompare(b.name);
    });

    const limited = [];
    for (let i = 0; i < scanList.length; i++) {
        if (i < maxArtifacts) {
            limited.push(scanList[i]);
        } else {
            skip.set(scanList[i].path, 'acima do limite de slots');
        }
    }

    return inspected.map((item) => {
        const skipped = skip.has(item.path);
        let reason;
        if (skipped) {
            reason = skip.get(item.path);
        } else if (item.parseError) {
            reason = 'zip ilegível; mantido por cobertura';
        } else if (item.alwaysScan) {
            reason = 'artefato nativo (JAR/WAR/EAR/APK/AAB/IPA)';
        } else if (coverageGuard) {
            reason = 'guarda de cobertura: nenhum artefato passou no filtro';
        } else {
            reason = `código de primeiro lado (${item.firstPartyCode})`;
        }
        return {
            name: item.name,
            path: item.path,
            size: item.size,
            language: item.language,
            counts: item.counts,
            firstPartyCode: item.firstPartyCode,
            codeBytes: item.codeBytes,
            decision: skipped ? 'skip' : 'scan',
            reason
        };
    });
}

function uniqueDestName(used, filePath) {
    let destName = path.basename(filePath);
    if (!used.has(destName.toLowerCase())) {
        used.add(destName.toLowerCase());
        return destName;
    }
    const parent = path.basename(path.dirname(filePath));
    destName = `${parent}-${destName}`;
    let index = 2;
    while (used.has(destName.toLowerCase())) {
        destName = `${parent}-${index}-${path.basename(filePath)}`;
        index += 1;
    }
    used.add(destName.toLowerCase());
    return destName;
}

function copyToUploadDir(artifacts, uploadDir) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    fs.mkdirSync(uploadDir, { recursive: true });
    const used = new Set();
    const copies = [];
    for (const src of artifacts) {
        const destName = uniqueDestName(used, src);
        const dest = path.join(uploadDir, destName);
        fs.copyFileSync(src, dest);
        copies.push(dest);
    }
    return copies;
}

function withTrailingSlash(dirPath) {
    const normalized = String(dirPath || '').replace(/\\/g, '/');
    if (!normalized) {
        return '';
    }
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function toGithubPath(absPath, workspace) {
    if (!workspace) {
        return String(absPath || '').split(path.sep).join('/');
    }
    const rel = path.relative(workspace, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return String(absPath || '').split(path.sep).join('/');
    }
    return rel.split(path.sep).join('/');
}

function appendOutput(out, name, value) {
    fs.appendFileSync(out, `${name}=${value}\n`);
}

function appendMultilineOutput(out, name, value) {
    const delimiter = `EOF_${name}`;
    fs.appendFileSync(out, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function writeGithubOutput(result, workspace) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        return;
    }
    const scanFiles = result.scanFiles.map((file) => toGithubPath(file, workspace));
    const scanFile = scanFiles[0] || '';
    const uploadDir = withTrailingSlash(toGithubPath(result.uploadDir, workspace));
    const packagedDir = withTrailingSlash(toGithubPath(result.packagedDir, workspace));
    appendOutput(out, 'scan_file', scanFile);
    appendMultilineOutput(out, 'scan_files', JSON.stringify(scanFiles));
    appendOutput(out, 'upload_dir', uploadDir);
    appendOutput(out, 'packaged_dir', packagedDir);
    appendOutput(out, 'artifact_count', String(result.artifactCount));
    appendOutput(out, 'scan_count', String(result.scanCount));
    appendOutput(out, 'skipped_count', String(result.skippedCount));
    appendOutput(out, 'artifact_names', result.records.map((item) => item.name).join(', '));
    appendOutput(out, 'coverage_guard', result.coverageGuard ? 'true' : 'false');
}

function writeManifest(manifestPath, records) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify({ artifacts: records }, null, 2)}\n`);
}

function classifyPackagerOutput({ outputDir, uploadDir, maxArtifacts, manifestPath }) {
    const artifacts = listPackagerArtifacts(outputDir);
    if (artifacts.length === 0) {
        throw fail('NO_PACKAGER_ARTIFACTS', { dir: outputDir });
    }
    const limit = parseMaxArtifacts(maxArtifacts);
    const records = classifyArtifacts(artifacts, limit);
    copyToUploadDir(artifacts, uploadDir);
    const scanFiles = records
        .filter((item) => item.decision === 'scan')
        .sort((a, b) => {
            if (b.firstPartyCode !== a.firstPartyCode) {
                return b.firstPartyCode - a.firstPartyCode;
            }
            if (b.codeBytes !== a.codeBytes) {
                return b.codeBytes - a.codeBytes;
            }
            return a.name.localeCompare(b.name);
        })
        .map((item) => item.path);
    const coverageGuard = records.some((item) => item.reason.startsWith('guarda de cobertura'));
    if (manifestPath) {
        writeManifest(manifestPath, records.map((item) => ({
            ...item,
            path: toGithubPath(item.path, process.env.GITHUB_WORKSPACE || '')
        })));
    }
    if (scanFiles.length === 0) {
        throw fail('NO_SCANNABLE_ARTIFACTS');
    }
    return {
        scanFile: scanFiles[0],
        scanFiles,
        uploadDir,
        packagedDir: outputDir,
        artifactCount: artifacts.length,
        scanCount: scanFiles.length,
        skippedCount: artifacts.length - scanFiles.length,
        records,
        coverageGuard
    };
}

if (require.main === module) {
    try {
        const [outputDir, uploadDir, maxArtifacts, manifestArg] = process.argv.slice(2);
        if (!outputDir || !uploadDir) {
            throw new Error('Uso: node classify-artifacts.js <outputDir> <uploadDir> [maxArtifacts] [manifestPath]');
        }
        const workspace = process.env.GITHUB_WORKSPACE || '';
        const manifestPath = manifestArg
            || (workspace
                ? path.join(workspace, '.veracode-connect', 'artifacts.json')
                : path.join(path.dirname(uploadDir), 'artifacts.json'));
        const result = classifyPackagerOutput({
            outputDir,
            uploadDir,
            maxArtifacts,
            manifestPath
        });
        writeGithubOutput(result, workspace);
        const scanFile = toGithubPath(result.scanFile, workspace);
        process.stdout.write(message('success', 'ARTIFACTS_SELECTED', {
            count: String(result.scanCount),
            file: scanFile
        }) + '\n');
        if (result.coverageGuard) {
            process.stdout.write(`::warning::${message('warning', 'COVERAGE_GUARD', {
                count: String(result.artifactCount)
            })}\n`);
        }
        if (result.skippedCount > 0) {
            process.stdout.write(`::notice::${message('warning', 'ARTIFACTS_SKIPPED', {
                skipped: String(result.skippedCount),
                total: String(result.artifactCount)
            })}\n`);
        }
        const overLimit = result.records.filter((item) => item.reason === 'acima do limite de slots');
        if (overLimit.length > 0) {
            process.stdout.write(`::warning::${message('warning', 'ABOVE_SLOT_LIMIT', {
                skipped: String(overLimit.length),
                max: String(parseMaxArtifacts(maxArtifacts))
            })}\n`);
        }
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    SCAN_EXTENSIONS,
    CODE_EXTENSIONS,
    WEAK_EXTENSIONS,
    TEST_SEGMENTS,
    DEP_SEGMENTS,
    DEFAULT_MAX_ARTIFACTS,
    listPackagerArtifacts,
    listCentralDirectory,
    writeStoreZipEntries,
    createStoreZip,
    inspectZipEntry,
    inspectArtifact,
    classifyArtifacts,
    classifyPackagerOutput,
    copyToUploadDir,
    languageTag,
    isTestFileName,
    toGithubPath,
    withTrailingSlash,
    parseMaxArtifacts
};
