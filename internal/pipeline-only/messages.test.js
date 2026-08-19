const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('status={status}', { status: 'ok' }), 'status=ok');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('error', 'RESULTS_MISSING_POLICY_CHECK'),
        'Falha na verificação do Pipeline Scan: results.json não encontrado após o scan.'
    );
    assert.equal(
        message('warning', 'POLICY_FAIL_FALSE'),
        'Pipeline Scan reportou falhas, mas policy_fail=false (o job continua).'
    );
    assert.equal(
        message('success', 'PIPELINE_STATUS_SET', { status: 'scan_completed_without_portal_afrika' }),
        'pipeline_status=scan_completed_without_portal_afrika'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'POLICY_FAIL_TRUE'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('POLICY_FAIL_TRUE');
    assert.equal(err.message, errors.POLICY_FAIL_TRUE);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'success',
        'PIPELINE_STATUS_SET',
        'status=scan_failed_without_portal_afrika'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'pipeline_status=scan_failed_without_portal_afrika');
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
