'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { normalizeFailOnSeverity } = require('./fail-on-severity');

test('fail_on_severity sai entre aspas para não ser dividido pelo shell', () => {
    assert.deepEqual(normalizeFailOnSeverity('Very High, High'),
        { value: '"Very High, High"', severities: ['Very High', 'High'] });
    assert.equal(normalizeFailOnSeverity(' very  high,HIGH ,high ').value, '"Very High, High"');
    assert.equal(normalizeFailOnSeverity('"Medium"').value, '"Medium"');
    assert.equal(normalizeFailOnSeverity('Very Low,Informational').value, '"Very Low, Informational"');
});

test('fail_on_severity vazio continua vazio', () => {
    assert.deepEqual(normalizeFailOnSeverity(''), { value: '', severities: [] });
    assert.deepEqual(normalizeFailOnSeverity(undefined), { value: '', severities: [] });
    assert.deepEqual(normalizeFailOnSeverity(' , '), { value: '', severities: [] });
});

test('fail_on_severity rejeita severidade desconhecida ou caracteres de shell', () => {
    assert.deepEqual(normalizeFailOnSeverity('High, Critical'), { error: 'Critical' });
    assert.deepEqual(normalizeFailOnSeverity('High; rm -rf /'), { error: 'High; rm -rf /' });
    assert.equal(normalizeFailOnSeverity('High $(id)').error, 'High $(id)');
});

test('validate-inputs publica fail_on_severity normalizado e falha com valor inválido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-fos-'));
    const out = path.join(dir, 'output');
    const script = path.join(__dirname, 'index.js');
    try {
        const ok = cp.spawnSync(process.execPath, [script], {
            env: { VID: '123', VKEY: 'abc123bb', BASELINE_MODE: 'none', FAIL_ON_SEVERITY: 'Very High, High', GITHUB_OUTPUT: out },
            encoding: 'utf8'
        });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.match(fs.readFileSync(out, 'utf8'), /^fail_on_severity="Very High, High"$/m);

        const bad = cp.spawnSync(process.execPath, [script], {
            env: { VID: '123', VKEY: 'abc123bb', BASELINE_MODE: 'none', FAIL_ON_SEVERITY: 'High, Critical' },
            encoding: 'utf8'
        });
        assert.notEqual(bad.status, 0);
        assert.match(bad.stdout, /fail_on_severity contém severidade inválida: 'Critical'/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('os fluxos de baseline recebem o fail_on_severity normalizado, não o input cru', () => {
    const root = fs.readFileSync(path.join(__dirname, '..', '..', 'action.yml'), 'utf8');
    const passed = root.match(/^\s+fail_on_severity: .+$/gm).map((l) => l.trim());
    assert.deepEqual(passed, [
        'fail_on_severity: ${{ inputs.fail_on_severity }}',
        'fail_on_severity: ${{ steps.validate.outputs.fail_on_severity }}',
        'fail_on_severity: ${{ steps.validate.outputs.fail_on_severity }}'
    ]);
});
