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
        message('error', 'SEED_UPLOAD_FAILED', { status: 403 }),
        'Falha ao enviar baseline para Portal Afrika (HTTP 403). Verifique as credenciais.'
    );
    assert.equal(
        message('warning', 'PORTAL_HTTP_ERROR', { status: 500 }),
        'Portal Afrika retornou HTTP 500 ao consultar baseline. Continuando sem baseline.'
    );
    assert.equal(
        message('success', 'BASELINE_FOUND', { repo: 'org/app' }),
        'baseline=encontrado repo=org/app'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'BASELINE_FOUND'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('SEED_UPLOAD_FAILED', { status: 401 });
    assert.equal(err.message, errors.SEED_UPLOAD_FAILED.replace('{status}', '401'));
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'warning',
        'SEED_NOT_DEFAULT_BRANCH',
        'default_branch=main'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, warnings.SEED_NOT_DEFAULT_BRANCH
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
