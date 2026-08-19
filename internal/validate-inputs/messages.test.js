const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('error', 'PORTAL_URL_TRAILING_SLASH', { url: 'https://x.io/' }),
        "portal_afrika_base_url não deve terminar com barra (/). Atual: 'https://x.io/'"
    );
    assert.equal(message('success', 'BASELINE_MODE_RESOLVED', { mode: 'repo' }), 'baseline_mode=repo');
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'X'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('VID_REQUIRED');
    assert.equal(err.message, errors.VID_REQUIRED);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'error', 'VID_REQUIRED'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, errors.VID_REQUIRED);
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
