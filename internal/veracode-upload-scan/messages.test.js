const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('{path}', { path: '/tmp/app.zip' }), '/tmp/app.zip');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('error', 'FILEPATH_NOT_FOUND', { path: '/tmp/app.zip' }),
        'Falha ao resolver filepath: arquivo não encontrado: /tmp/app.zip'
    );
    assert.equal(
        message('success', 'PREP_OK', { sandbox: 'true', mode: 'auto', branch: 'feat' }),
        'upload_scan preparado: sandbox=true mode=auto branch=feat'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'SANDBOX_INVALID'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('SANDBOX_INVALID');
    assert.equal(err.message, errors.SANDBOX_INVALID);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'success',
        'FILEPATH_RESOLVED',
        'path=/tmp/app.zip'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'filepath=/tmp/app.zip');
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
