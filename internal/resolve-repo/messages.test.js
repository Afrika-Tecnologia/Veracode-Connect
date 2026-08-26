const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('success', 'REPO_RESOLVED', { repo: 'Afrika-Tecnologia/exemplo-app' }),
        'repository_full_name=Afrika-Tecnologia/exemplo-app'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'X'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('REPO_UNDEFINED');
    assert.equal(err.message, errors.REPO_UNDEFINED);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'error', 'REPO_UNDEFINED'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, errors.REPO_UNDEFINED);
});

test('catálogos não têm chaves vazias', () => {
    for (const [name, catalog] of [['errors', errors], ['warnings', warnings], ['success', success]]) {
        for (const [key, value] of Object.entries(catalog)) {
            assert.equal(typeof value, 'string', `${name}.${key}`);
            assert.ok(value.length > 0, `${name}.${key} vazio`);
        }
    }
});
