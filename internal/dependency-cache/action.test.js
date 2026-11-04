'use strict';

/**
 * Contrato do action.yml do dependency-cache: o que é salvo, quando e como a
 * chave é calculada. Executa o script do step "plan" com o hash vazio/preenchido.
 */

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'action.yml'), 'utf8').replace(/\r\n/g, '\n');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const bashAvailable = cp.spawnSync(bash, ['--version']).status === 0;

function block(id) {
    const start = source.lastIndexOf('\n    - name:', source.indexOf(`\n      id: ${id}\n`));
    const next = source.indexOf('\n    - name:', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
}

function runScript(id) {
    const lines = block(id).split('\n');
    const run = lines.findIndex(line => line.trim() === 'run: |');
    return lines.slice(run + 1).map(line => line.slice(8)).join('\n');
}

test('cacheia apenas repositórios locais (nunca settings.xml com credenciais)', () => {
    const paths = source.match(/path: \|\n((?:          .*\n)+)/g);
    assert.equal(paths.length, 2, 'restore e save');
    for (const entry of paths) {
        const list = entry.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
        assert.deepEqual(list, ['~/.m2/repository', '~/.m2/wrapper', '~/.gradle/caches', '~/.gradle/wrapper']);
    }
    assert.doesNotMatch(source, /path:.*settings\.xml/);
});

test('chave combina SO e hash dos arquivos de build JVM, com restore por prefixo', () => {
    const plan = block('plan');
    for (const pattern of ['**/pom.xml', '**/build.gradle', '**/build.gradle.kts', '**/gradle-wrapper.properties', '**/maven-wrapper.properties', '!**/node_modules/**']) {
        assert.ok(plan.includes(`'${pattern}'`), pattern);
    }
    assert.match(plan, /KEY_PREFIX: veracode-connect-deps-v1-\$\{\{ runner\.os \}\}-/);
    assert.match(block('restore'), /restore-keys: \$\{\{ steps\.plan\.outputs\.prefix \}\}/);
});

test('save só roda com chave, sem hit exato e com cache habilitado; cleanup roda sempre', () => {
    const lines = source.split('\n');
    const saveIf = lines.find(l => l.includes("inputs.mode == 'save' && inputs.cache_dependencies == 'true'"));
    assert.match(saveIf, /inputs\.key != ''/);
    assert.match(saveIf, /inputs\.cache_hit != 'true'/);
    const cleanupIf = lines.find(l => l.includes("inputs.settings_created == 'true'"));
    assert.match(cleanupIf, /always\(\)/);
});

test('ações de cache pinadas por SHA', () => {
    for (const line of source.split('\n').filter(l => /^\s+uses:/.test(l))) {
        assert.match(line, /@[0-9a-f]{40} # v4\.3\.0$/);
    }
});

test('step plan sem arquivos de build não gera chave', { skip: bashAvailable ? false : 'bash indisponível' }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deps-'));
    const out = path.join(tmp, 'out');
    const env = { ...process.env, GITHUB_OUTPUT: out, GITHUB_ACTION_PATH: __dirname, KEY_PREFIX: 'veracode-connect-deps-v1-Linux-' };

    fs.writeFileSync(out, '');
    let result = cp.spawnSync(bash, ['-c', runScript('plan')], { env: { ...env, BUILD_HASH: '' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(out, 'utf8'), 'key=\n');
    assert.match(result.stdout, /nenhum pom\.xml/);

    fs.writeFileSync(out, '');
    result = cp.spawnSync(bash, ['-c', runScript('plan')], { env: { ...env, BUILD_HASH: 'abc123' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /^key=veracode-connect-deps-v1-Linux-abc123\nprefix=veracode-connect-deps-v1-Linux-\n$/);
});
