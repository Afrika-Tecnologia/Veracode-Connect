'use strict';

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
        message('success', 'PLAN_OK', { count: 2 }),
        'pipeline-scan-set: 2 artefato(s) planejado(s)'
    );
    assert.equal(
        message('warning', 'SCAN_ERROR', { file: 'app.zip' }),
        'Pipeline Scan do artefato app.zip falhou (scan_error).'
    );
    assert.equal(
        message('warning', 'UNSCANNABLE', { file: 'py.zip' }),
        'Pipeline Scan do artefato py.zip: pacote sem fonte não vazia (unscannable); slot ignorado somente se houver outro scan válido.'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'NO_SCAN_FILES'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('NO_SCAN_FILES');
    assert.equal(err.message, errors.NO_SCAN_FILES);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'success',
        'MERGE_OK',
        'scanned=2',
        'errors=0',
        'policy=1'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, success.MERGE_OK.replace('{scanned}', '2').replace('{errors}', '0').replace('{policy}', '1'));
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
