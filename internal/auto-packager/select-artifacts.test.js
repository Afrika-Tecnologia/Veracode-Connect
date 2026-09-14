'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { errors, warnings } = require('./messages.js');
const {
    SCAN_EXTENSIONS,
    listPackagerArtifacts,
    parsePackageLog,
    resolvePackagerScanFile,
    createStoreZip,
    extractZip
} = require('./select-artifacts.js');

const cli = path.join(__dirname, 'select-artifacts.js');

function makeDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vc-packager-'));
}

function writeFile(dir, name, contents = 'payload') {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    return filePath;
}

function listZipEntries(zipPath) {
    const buf = fs.readFileSync(zipPath);
    const names = [];
    let offset = 0;
    while (offset + 4 <= buf.length) {
        const sig = buf.readUInt32LE(offset);
        if (sig !== 0x04034b50) {
            break;
        }
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const compSize = buf.readUInt32LE(offset + 18);
        names.push(buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8'));
        offset += 30 + nameLen + extraLen + compSize;
    }
    return names;
}

test('SCAN_EXTENSIONS cobre os tipos gerados pelo Auto Packager', () => {
    for (const ext of ['.zip', '.jar', '.war', '.ear', '.apk', '.ipa', '.aab']) {
        assert.ok(SCAN_EXTENSIONS.has(ext), ext);
    }
});

test('listPackagerArtifacts ignora ZIP do workspace e lê só o diretório de saída', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'aaa.zip', 'workspace-zip');
    writeFile(root, 'app.zip', 'workspace-app');
    writeFile(root, 'veracode-artifact-old.zip', 'old-pattern');
    const expected = writeFile(outputDir, 'veracode-auto-pack-api-js.zip', 'packager');

    assert.deepEqual(listPackagerArtifacts(outputDir), [expected]);
});

test('listPackagerArtifacts aceita jar/war/apk copiados pela CLI, não só zip', () => {
    const outputDir = makeDir();
    const jar = writeFile(outputDir, 'example-1.0-SNAPSHOT.jar', 'jar');
    const apk = writeFile(outputDir, 'app-debug.apk', 'apk');
    writeFile(outputDir, 'readme.txt', 'ignore');
    fs.mkdirSync(path.join(outputDir, 'nested'));

    assert.deepEqual(listPackagerArtifacts(outputDir), [apk, jar]);
});

test('listPackagerArtifacts devolve vazio se o diretório não existe ou está vazio', () => {
    assert.deepEqual(listPackagerArtifacts(path.join(os.tmpdir(), 'vc-packager-missing')), []);
    assert.deepEqual(listPackagerArtifacts(makeDir()), []);
});

test('resolvePackagerScanFile falha se não há artefato no diretório de saída', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'vendor.zip', 'not-from-packager');

    assert.throws(
        () => resolvePackagerScanFile({
            outputDir,
            bundlePath: path.join(root, 'bundle.zip')
        }),
        (err) => {
            assert.match(err.message, /nenhum artefato/i);
            assert.match(err.message, /packaged/);
            return true;
        }
    );
    assert.equal(fs.existsSync(path.join(root, 'bundle.zip')), false);
});

test('resolvePackagerScanFile com um artefato usa o arquivo original, sem copiar para app.zip', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'app.zip', 'workspace-app');
    const artifact = writeFile(outputDir, 'veracode-auto-pack-app-python.zip', 'real');

    const result = resolvePackagerScanFile({
        outputDir,
        bundlePath: path.join(root, 'bundle.zip')
    });

    assert.equal(result.scanFile, artifact);
    assert.equal(result.bundled, false);
    assert.deepEqual(result.artifacts, [artifact]);
    assert.equal(fs.existsSync(path.join(root, 'bundle.zip')), false);
    assert.equal(fs.readFileSync(path.join(root, 'app.zip'), 'utf8'), 'workspace-app');
});

test('resolvePackagerScanFile descompacta cada ZIP e reúne o conteúdo, sem zip aninhado', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'aaa.zip', 'unrelated');
    writeFile(root, 'app.zip', 'workspace-app');

    const frontPayload = writeFile(makeDir(), 'app.js', 'frontend-src');
    const front = path.join(outputDir, 'veracode-auto-pack-frontend-js.zip');
    createStoreZip([frontPayload], front);

    const apiPayload = writeFile(makeDir(), 'App.dll', 'dotnet-bin');
    const api = path.join(outputDir, 'veracode-auto-pack-api-dotnet.zip');
    createStoreZip([apiPayload], api);

    const jar = writeFile(outputDir, 'service-1.0.jar', 'jar-bytes');
    const bundlePath = path.join(root, 'veracode-packager-bundle.zip');

    const result = resolvePackagerScanFile({ outputDir, bundlePath });

    assert.equal(result.scanFile, bundlePath);
    assert.equal(result.bundled, true);
    assert.deepEqual(result.artifacts, [jar, api, front].sort());
    const entries = listZipEntries(bundlePath).sort();
    assert.deepEqual(entries, [
        'service-1.0.jar',
        'veracode-auto-pack-api-dotnet/App.dll',
        'veracode-auto-pack-frontend-js/app.js'
    ].sort());
    assert.ok(entries.every((name) => !name.toLowerCase().endsWith('.zip')));
    assert.equal(fs.readFileSync(path.join(root, 'aaa.zip'), 'utf8'), 'unrelated');
    assert.equal(fs.readFileSync(path.join(root, 'app.zip'), 'utf8'), 'workspace-app');
});

test('createStoreZip grava entradas STORE com o conteúdo original', () => {
    const dir = makeDir();
    const a = writeFile(dir, 'a.zip', 'AAAA');
    const b = writeFile(dir, 'b.jar', 'BBBB');
    const dest = path.join(dir, 'out.zip');
    createStoreZip([a, b], dest);

    const buf = fs.readFileSync(dest);
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    const names = listZipEntries(dest);
    assert.deepEqual(names.sort(), ['a.zip', 'b.jar']);
    const extracted = {};
    let offset = 0;
    while (offset + 4 <= buf.length) {
        const sig = buf.readUInt32LE(offset);
        if (sig !== 0x04034b50) {
            break;
        }
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const compSize = buf.readUInt32LE(offset + 18);
        const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
        const start = offset + 30 + nameLen + extraLen;
        extracted[name] = buf.subarray(start, start + compSize).toString('utf8');
        offset = start + compSize;
    }
    assert.equal(extracted['a.zip'], 'AAAA');
    assert.equal(extracted['b.jar'], 'BBBB');
});

test('extractZip lê DEFLATE e rejeita caminho fora da pasta de destino', () => {
    const zlib = require('node:zlib');
    const dir = makeDir();
    const payload = Buffer.from('deflated-hello');
    const compressed = zlib.deflateRawSync(payload);
    const name = Buffer.from('src/hello.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(local.length + name.length + compressed.length, 16);
    const deflateZip = path.join(dir, 'deflate.zip');
    fs.writeFileSync(deflateZip, Buffer.concat([local, name, compressed, central, name, eocd]));

    const out = path.join(dir, 'out');
    extractZip(deflateZip, out);
    assert.equal(fs.readFileSync(path.join(out, 'src', 'hello.txt'), 'utf8'), 'deflated-hello');

    const slipName = Buffer.from('../evil.txt');
    const slipLocal = Buffer.alloc(30);
    slipLocal.writeUInt32LE(0x04034b50, 0);
    slipLocal.writeUInt16LE(20, 4);
    slipLocal.writeUInt32LE(1, 18);
    slipLocal.writeUInt32LE(1, 22);
    slipLocal.writeUInt16LE(slipName.length, 26);
    const slipCentral = Buffer.alloc(46);
    slipCentral.writeUInt32LE(0x02014b50, 0);
    slipCentral.writeUInt16LE(20, 4);
    slipCentral.writeUInt16LE(20, 6);
    slipCentral.writeUInt32LE(1, 20);
    slipCentral.writeUInt32LE(1, 24);
    slipCentral.writeUInt16LE(slipName.length, 28);
    const slipEocd = Buffer.alloc(22);
    slipEocd.writeUInt32LE(0x06054b50, 0);
    slipEocd.writeUInt16LE(1, 8);
    slipEocd.writeUInt16LE(1, 10);
    slipEocd.writeUInt32LE(slipCentral.length + slipName.length, 12);
    slipEocd.writeUInt32LE(slipLocal.length + slipName.length + 1, 16);
    const slipZip = path.join(dir, 'slip.zip');
    fs.writeFileSync(slipZip, Buffer.concat([slipLocal, slipName, Buffer.from('x'), slipCentral, slipName, slipEocd]));
    assert.throws(() => extractZip(slipZip, path.join(dir, 'safe')), /inseguro/i);
});

test('parsePackageLog extrai todos os artefatos, não só a última linha', () => {
    const log = [
        'Packager initiated...',
        'Project Bookstore.Web zipped and saved to: C:\\verascan\\veracode-auto-pack-Bookstore.Web-dotnet.zip',
        'DotNet project Bookstore.Web JavaScript packaged to: C:\\verascan\\veracode-auto-pack-Bookstore.Web-dotnet-js.zip',
        'Copied artifact: path/to/verascan/app-debug.apk.',
        'Project example-javascript packaged to path/to/verascan/veracode-auto-pack-example-javascript-js.zip.',
        'Package created: /tmp/legacy/veracode-auto-packaged.zip',
        'Successfully created 3 artifact(s).'
    ].join('\n');

    assert.deepEqual(parsePackageLog(log), [
        'C:\\verascan\\veracode-auto-pack-Bookstore.Web-dotnet.zip',
        'C:\\verascan\\veracode-auto-pack-Bookstore.Web-dotnet-js.zip',
        'path/to/verascan/app-debug.apk',
        'path/to/verascan/veracode-auto-pack-example-javascript-js.zip',
        '/tmp/legacy/veracode-auto-packaged.zip'
    ]);
});

test('CLI grava scan_file no GITHUB_OUTPUT e falha sem artefatos', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'noise.zip', 'nope');
    const githubOutput = path.join(root, 'github-output.txt');
    const bundlePath = path.join(root, 'bundle.zip');

    const missing = cp.spawnSync(process.execPath, [cli, outputDir, bundlePath], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: githubOutput, GITHUB_WORKSPACE: root }
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /::error::/);
    assert.match(missing.stderr, /nenhum artefato/i);

    writeFile(outputDir, 'veracode-auto-pack-app-go.zip', 'go');
    const ok = cp.spawnSync(process.execPath, [cli, outputDir, bundlePath], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: githubOutput, GITHUB_WORKSPACE: root }
    });
    assert.equal(ok.status, 0, ok.stderr);
    const output = fs.readFileSync(githubOutput, 'utf8');
    assert.match(output, /scan_file=packaged\/veracode-auto-pack-app-go.zip/);
    assert.match(output, /artifact_count=1/);
    assert.match(output, /bundled=false/);
});

test('mensagens de falha fechada existem no catálogo', () => {
    assert.match(errors.NO_PACKAGER_ARTIFACTS, /nenhum artefato/i);
    assert.match(errors.PACKAGE_FAILED_NO_ARTIFACTS, /nenhum artefato/i);
    assert.match(warnings.PACKAGE_EXIT_WITH_ARTIFACTS, /artefato/);
    assert.match(warnings.MULTIPLE_ARTIFACTS_BUNDLED, /descompact/i);
});
