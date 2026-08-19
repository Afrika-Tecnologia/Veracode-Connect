const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('HTTP {status}', { status: 422 }), 'HTTP 422');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('error', 'PUT_FAILED', { status: 409, store: 'org/repo/a/baseline.json', detail: 'x' }),
        'Falha ao gravar baseline (HTTP 409) em org/repo/a/baseline.json: x'
    );
    assert.equal(
        message('warning', 'RETRY', { attempt: 1, max: 5, status: 409, detail: 'ff' }),
        'retry 1/5 HTTP 409: ff'
    );
    assert.equal(message('success', 'AUTH', { source: 'github_app' }), 'auth=github_app');
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'AUTH'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('RULESET_PR_REQUIRED', { store: 'org/repo/app/baseline.json' });
    assert.equal(err.message, errors.RULESET_PR_REQUIRED.replace('{store}', 'org/repo/app/baseline.json'));
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'warning',
        'SEED_NOT_DEFAULT_BRANCH',
        'branch=feat',
        'default_branch=main'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, warnings.SEED_NOT_DEFAULT_BRANCH
        .replace('{branch}', 'feat')
        .replace('{default_branch}', 'main'));
});

test('CLI falha com chave desconhecida', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'error', 'NAO_EXISTE'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Mensagem desconhecida/);
});

test('catálogos não têm chaves vazias', () => {
    for (const [name, catalog] of [['errors', errors], ['warnings', warnings], ['success', success]]) {
        for (const [key, value] of Object.entries(catalog)) {
            assert.equal(typeof value, 'string', `${name}.${key}`);
            assert.ok(value.length > 0, `${name}.${key} vazio`);
        }
    }
});
