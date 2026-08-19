const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('status={s}', { s: 'ok' }), 'status=ok');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('success', 'IAC_STATUS_SET', { status: 'success' }),
        'iac_status=success'
    );
    assert.equal(
        message('success', 'ARTIFACT_NAME_SET', { name: 'iac-results-abc' }),
        'artifact_name=iac-results-abc'
    );
    assert.equal(
        message('success', 'RESULTS_COLLECTED'),
        'resultados IaC/Secrets coletados em iac-results/'
    );
    assert.equal(
        message('warning', 'NO_IAC_RESULTS'),
        'Nenhum arquivo de resultado do IaC foi encontrado para coletar.'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'NO_IAC_RESULTS'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail propaga erro do catálogo', () => {
    assert.throws(() => fail('NAO_EXISTE', {}), /Mensagem desconhecida/);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'success',
        'IAC_STATUS_SET',
        'status=failure'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'iac_status=failure');
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
