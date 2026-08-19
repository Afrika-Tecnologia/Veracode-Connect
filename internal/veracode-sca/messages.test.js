const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, parseVars, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('{status}', { status: 'ok' }), 'ok');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('warning', 'SCA_FAILED_CONTINUE'),
        'Veracode SCA retornou falha (trava final via build-gate).'
    );
    assert.equal(
        message('success', 'SCA_STATUS_SET', { status: 'warning' }),
        'sca_status=warning'
    );
    assert.equal(
        message('success', 'SCA_ARTIFACT_NORMALIZED', { file: 'veracode_sca.log', source: 'scaResults.txt' }),
        'artefato_sca=veracode_sca.log (origem: scaResults.txt)'
    );
    assert.equal(
        message('success', 'ARTIFACT_NAME_SET', { name: 'sca-results-abc' }),
        'artifact_name=sca-results-abc'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'SCA_FAILED_CONTINUE'), /Catálogo desconhecido/);
    assert.throws(() => message('warning', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('parseVars converte pares k=v', () => {
    const vars = parseVars(['status=warning', 'file=a.log']);
    assert.deepEqual(vars, { status: 'warning', file: 'a.log' });
    assert.throws(() => parseVars(['invalid']), /Parâmetro inválido/);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'success',
        'SCA_STATUS_SET',
        'status=success'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'sca_status=success');
});

test('CLI falha com chave desconhecida', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'error', 'NAO_EXISTE'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Mensagem desconhecida/);
});

test('catálogos não têm chaves vazias', () => {
    for (const [name, catalog] of [['warnings', warnings], ['success', success]]) {
        for (const [key, value] of Object.entries(catalog)) {
            assert.equal(typeof value, 'string', `${name}.${key}`);
            assert.ok(value.length > 0, `${name}.${key} vazio`);
        }
    }
});
