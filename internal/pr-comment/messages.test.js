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
    assert.equal(message('success', 'CREATED', { pr: 42 }), 'pr_comment=created pr=42');
    assert.equal(message('warning', 'NOT_PR', {}), 'pr_comment=skipped reason=not_pr');
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'X'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('TOKEN_REQUIRED');
    assert.equal(err.message, errors.TOKEN_REQUIRED);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'success', 'UPDATED', 'pr=7'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'pr_comment=updated pr=7');
});

test('catálogos não têm chaves vazias', () => {
    for (const [name, catalog] of [['errors', errors], ['warnings', warnings], ['success', success]]) {
        for (const [key, value] of Object.entries(catalog)) {
            assert.equal(typeof value, 'string', `${name}.${key}`);
            assert.ok(value.length > 0, `${name}.${key} vazio`);
        }
    }
});
