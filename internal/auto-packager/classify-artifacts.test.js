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
    writeStoreZipEntries,
    classifyArtifacts,
    classifyPackagerOutput,
    inspectArtifact,
    isTestFileName,
    languageTag
} = require('./classify-artifacts.js');

const cli = path.join(__dirname, 'classify-artifacts.js');

function makeDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vc-packager-'));
}

function writeFile(dir, name, contents = 'payload') {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    return filePath;
}

function writeZip(destPath, entries) {
    writeStoreZipEntries(
        entries.map((entry) => ({
            name: entry.name,
            data: entry.data == null ? 'src' : entry.data
        })),
        destPath
    );
    return destPath;
}

test('SCAN_EXTENSIONS cobre os tipos gerados pelo Auto Packager', () => {
    for (const ext of ['.zip', '.jar', '.war', '.ear', '.apk', '.ipa', '.aab']) {
        assert.ok(SCAN_EXTENSIONS.has(ext), ext);
    }
});

test('languageTag lê o sufixo só como informação', () => {
    assert.equal(languageTag('veracode-auto-pack-NodeGoat-js.zip'), 'js');
    assert.equal(languageTag('veracode-auto-pack-Bookstore.Web-dotnet-js.zip'), 'dotnet-js');
    assert.equal(languageTag('service-1.0.jar'), 'jar');
});

test('isTestFileName usa glob de arquivo, não substring do diretório', () => {
    assert.equal(isTestFileName('app.test.js'), true);
    assert.equal(isTestFileName('FooTest.java'), true);
    assert.equal(isTestFileName('FooTests.cs'), true);
    assert.equal(isTestFileName('foo_test.go'), true);
    assert.equal(isTestFileName('test_foo.py'), true);
    assert.equal(isTestFileName('app.js'), false);
});

test('listPackagerArtifacts ignora ZIP do workspace e lê só o diretório de saída', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'aaa.zip', 'workspace-zip');
    writeFile(root, 'app.zip', 'workspace-app');
    const expected = writeFile(outputDir, 'veracode-auto-pack-api-js.zip', 'packager');

    assert.deepEqual(listPackagerArtifacts(outputDir), [expected]);
});

test('listPackagerArtifacts aceita jar/war/apk e varre subpastas', () => {
    const outputDir = makeDir();
    const nested = path.join(outputDir, 'nested');
    fs.mkdirSync(nested);
    const jar = writeFile(outputDir, 'example-1.0-SNAPSHOT.jar', 'jar');
    const apk = writeFile(nested, 'app-debug.apk', 'apk');
    writeFile(outputDir, 'readme.txt', 'ignore');

    assert.deepEqual(listPackagerArtifacts(outputDir), [jar, apk].sort());
});

test('JAR solto é sempre scannable', () => {
    const dir = makeDir();
    const jar = writeFile(dir, 'service-1.0.jar', 'jar-bytes');
    const records = classifyArtifacts([jar], 6);
    assert.equal(records[0].decision, 'scan');
    assert.match(records[0].reason, /nativo/i);
});

test('zip com fonte JS é scannable; lockfile/json/html sozinhos não', () => {
    const dir = makeDir();
    const app = writeZip(path.join(dir, 'veracode-auto-pack-app-js.zip'), [
        { name: 'src/index.js', data: 'console.log(1)' }
    ]);
    const lock = writeZip(path.join(dir, 'veracode-auto-pack-lock-js.zip'), [
        { name: 'package-lock.json', data: '{}' },
        { name: 'yarn.lock', data: 'lock' }
    ]);
    const html = writeZip(path.join(dir, 'veracode-auto-pack-docs-js.zip'), [
        { name: 'index.html', data: '<p>hi</p>' }
    ]);

    const records = classifyArtifacts([app, lock, html], 6);
    const byName = Object.fromEntries(records.map((item) => [item.name, item]));
    assert.equal(byName['veracode-auto-pack-app-js.zip'].decision, 'scan');
    assert.equal(byName['veracode-auto-pack-lock-js.zip'].decision, 'skip');
    assert.equal(byName['veracode-auto-pack-docs-js.zip'].decision, 'skip');
    assert.match(byName['veracode-auto-pack-lock-js.zip'].reason, /sem código/i);
});

test('TEST só casa segmento exato ou glob; bateria-testes-agente e sample-api não são teste', () => {
    const dir = makeDir();
    const realTest = writeZip(path.join(dir, 'tests.zip'), [
        { name: 'src/test/java/Foo.java', data: 'class Foo {}' },
        { name: 'src/FooTest.java', data: 'class FooTest {}' }
    ]);
    const agent = writeZip(path.join(dir, 'veracode-auto-pack-bateria-testes-agente-js.zip'), [
        { name: 'bateria-testes-agente/app.js', data: 'module.exports = 1' }
    ]);
    const sample = writeZip(path.join(dir, 'veracode-auto-pack-sample-api-js.zip'), [
        { name: 'sample-api/index.js', data: 'exports.ok = true' }
    ]);

    const records = classifyArtifacts([realTest, agent, sample], 6);
    const byName = Object.fromEntries(records.map((item) => [item.name, item]));
    assert.equal(byName['tests.zip'].decision, 'skip');
    assert.equal(byName['veracode-auto-pack-bateria-testes-agente-js.zip'].decision, 'scan');
    assert.equal(byName['veracode-auto-pack-sample-api-js.zip'].decision, 'scan');
});

test('node_modules não conta como fonte; DLL em bin/ continua contando', () => {
    const dir = makeDir();
    const deps = writeZip(path.join(dir, 'deps-js.zip'), [
        { name: 'node_modules/leftpad/index.js', data: 'module.exports=1' }
    ]);
    const dotnet = writeZip(path.join(dir, 'veracode-auto-pack-api-dotnet.zip'), [
        { name: 'bin/Release/App.dll', data: 'MZ-dll' }
    ]);
    const java = writeZip(path.join(dir, 'service.zip'), [
        { name: 'target/app.jar', data: 'jar-bytes' }
    ]);

    const records = classifyArtifacts([deps, dotnet, java], 6);
    const byName = Object.fromEntries(records.map((item) => [item.name, item]));
    assert.equal(byName['deps-js.zip'].decision, 'skip');
    assert.equal(byName['veracode-auto-pack-api-dotnet.zip'].decision, 'scan');
    assert.equal(byName['service.zip'].decision, 'scan');
    assert.ok(byName['veracode-auto-pack-api-dotnet.zip'].firstPartyCode >= 1);
});

test('SQL/Perl sozinhos são fracos no Pipeline Scan; COBOL conta', () => {
    const dir = makeDir();
    const sql = writeZip(path.join(dir, 'veracode-auto-pack-plsql-sql.zip'), [
        { name: 'schema.sql', data: 'SELECT 1;' }
    ]);
    const cobol = writeZip(path.join(dir, 'veracode-auto-pack-app-cobol.zip'), [
        { name: 'PAYROLL.cbl', data: 'IDENTIFICATION DIVISION.' }
    ]);
    const records = classifyArtifacts([sql, cobol], 6);
    const byName = Object.fromEntries(records.map((item) => [item.name, item]));
    assert.equal(byName['veracode-auto-pack-plsql-sql.zip'].decision, 'skip');
    assert.equal(byName['veracode-auto-pack-app-cobol.zip'].decision, 'scan');
});

test('zip cujo código está contido em outro é skip; iguais mantêm o primeiro nome', () => {
    const dir = makeDir();
    const payload = 'function main() { return 1 }';
    const parent = writeZip(path.join(dir, 'aaa-app.zip'), [
        { name: 'src/app.js', data: payload },
        { name: 'src/lib.js', data: 'exports.x=1' }
    ]);
    const child = writeZip(path.join(dir, 'zzz-lib.zip'), [
        { name: 'nested/app.js', data: payload }
    ]);
    const twinA = writeZip(path.join(dir, 'aaa-twin.zip'), [
        { name: 'src/only.js', data: 'const a=1' }
    ]);
    const twinB = writeZip(path.join(dir, 'zzz-twin.zip'), [
        { name: 'other/only.js', data: 'const a=1' }
    ]);

    const records = classifyArtifacts([parent, child, twinA, twinB], 6);
    const byName = Object.fromEntries(records.map((item) => [item.name, item]));
    assert.equal(byName['aaa-app.zip'].decision, 'scan');
    assert.equal(byName['zzz-lib.zip'].decision, 'skip');
    assert.match(byName['zzz-lib.zip'].reason, /coberto por aaa-app.zip/);
    assert.equal(byName['aaa-twin.zip'].decision, 'scan');
    assert.equal(byName['zzz-twin.zip'].decision, 'skip');
});

test('guarda de cobertura: se o filtro zerar tudo, escaneia todos', () => {
    const dir = makeDir();
    const a = writeZip(path.join(dir, 'a-lock.zip'), [
        { name: 'package-lock.json', data: '{}' }
    ]);
    const b = writeZip(path.join(dir, 'b-html.zip'), [
        { name: 'index.html', data: '<p>x</p>' }
    ]);
    const records = classifyArtifacts([a, b], 6);
    assert.equal(records.every((item) => item.decision === 'scan'), true);
    assert.ok(records.every((item) => /guarda de cobertura/i.test(item.reason)));
});

test('acima do limite de slots marca skip depois do ranking', () => {
    const dir = makeDir();
    const files = [];
    for (let i = 0; i < 8; i++) {
        files.push(writeZip(path.join(dir, `app-${i}.zip`), [
            { name: `src/mod${i}.js`, data: `module.exports=${i}` }
        ]));
    }
    const records = classifyArtifacts(files, 6);
    const scanned = records.filter((item) => item.decision === 'scan');
    const skipped = records.filter((item) => item.decision === 'skip');
    assert.equal(scanned.length, 6);
    assert.equal(skipped.length, 2);
    assert.ok(skipped.every((item) => item.reason === 'acima do limite de slots'));
});

test('classifyPackagerOutput copia todos os zips intactos para upload/ e não rezipa', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    const uploadDir = path.join(root, 'upload');
    fs.mkdirSync(outputDir);
    writeFile(root, 'workspace.zip', 'unrelated');

    const front = writeZip(path.join(outputDir, 'veracode-auto-pack-frontend-js.zip'), [
        { name: 'src/app.js', data: 'frontend-src' }
    ]);
    const api = writeZip(path.join(outputDir, 'veracode-auto-pack-api-dotnet.zip'), [
        { name: 'bin/Release/App.dll', data: 'dotnet-bin' }
    ]);
    const jar = writeFile(outputDir, 'service-1.0.jar', 'jar-bytes');
    const originalFront = fs.readFileSync(front);

    const result = classifyPackagerOutput({
        outputDir,
        uploadDir,
        maxArtifacts: 6,
        manifestPath: path.join(root, 'artifacts.json')
    });

    assert.equal(result.artifactCount, 3);
    assert.equal(result.scanCount, 3);
    assert.equal(result.skippedCount, 0);
    assert.ok(result.scanFiles.includes(front));
    assert.ok(result.scanFiles.includes(api));
    assert.ok(result.scanFiles.includes(jar));
    assert.deepEqual(
        fs.readdirSync(uploadDir).sort(),
        ['service-1.0.jar', 'veracode-auto-pack-api-dotnet.zip', 'veracode-auto-pack-frontend-js.zip']
    );
    assert.deepEqual(
        fs.readFileSync(path.join(uploadDir, 'veracode-auto-pack-frontend-js.zip')),
        originalFront
    );
    assert.equal(fs.existsSync(path.join(root, 'veracode-packager-bundle.zip')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'artifacts.json'), 'utf8'));
    assert.equal(manifest.artifacts.length, 3);
});

test('classifyPackagerOutput falha se não há artefato no diretório de saída', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    fs.mkdirSync(outputDir);
    writeFile(root, 'vendor.zip', 'not-from-packager');

    assert.throws(
        () => classifyPackagerOutput({
            outputDir,
            uploadDir: path.join(root, 'upload'),
            maxArtifacts: 6
        }),
        (err) => {
            assert.match(err.message, /nenhum artefato/i);
            return true;
        }
    );
});

test('CLI grava scan_files e upload_dir no GITHUB_OUTPUT', () => {
    const root = makeDir();
    const outputDir = path.join(root, 'packaged');
    const uploadDir = path.join(root, 'upload');
    fs.mkdirSync(outputDir);
    writeZip(path.join(outputDir, 'veracode-auto-pack-app-go.zip'), [
        { name: 'main.go', data: 'package main' }
    ]);
    const githubOutput = path.join(root, 'github-output.txt');

    const missing = cp.spawnSync(process.execPath, [cli, path.join(root, 'empty'), uploadDir], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: githubOutput, GITHUB_WORKSPACE: root }
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /::error::/);

    const ok = cp.spawnSync(process.execPath, [cli, outputDir, uploadDir, '6'], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: githubOutput, GITHUB_WORKSPACE: root }
    });
    assert.equal(ok.status, 0, ok.stderr);
    const output = fs.readFileSync(githubOutput, 'utf8');
    assert.match(output, /scan_file=packaged\/veracode-auto-pack-app-go.zip/);
    assert.match(output, /artifact_count=1/);
    assert.match(output, /scan_count=1/);
    assert.match(output, /upload_dir=upload\//);
    assert.equal(output.includes('bundled='), false);
    assert.ok(fs.existsSync(path.join(uploadDir, 'veracode-auto-pack-app-go.zip')));
});

test('mensagens de classificação existem no catálogo', () => {
    assert.match(errors.NO_PACKAGER_ARTIFACTS, /nenhum artefato/i);
    assert.match(warnings.COVERAGE_GUARD, /cobertura/i);
    assert.match(warnings.ARTIFACTS_SKIPPED, /descart/i);
    assert.match(warnings.ABOVE_SLOT_LIMIT, /limite/i);
});
