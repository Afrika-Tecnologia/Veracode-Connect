'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    extractFindings,
    findingKey,
    parseScanFiles,
    classifySlot,
    mergeScanDocuments,
    mergeSlots,
    retryPlan
} = require('./merge-results.js');

function makeDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vc-scan-set-'));
}

function writeJson(dir, name, data) {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, JSON.stringify(data));
    return filePath;
}

test('findingKey usa hashes de flaw, sem scan_id nem módulo', () => {
    const finding = {
        title: 'eval',
        cwe_id: '95',
        files: { source_file: { file: 'a.js', line: 10 } },
        flaw_match: {
            procedure_hash: 'p',
            prototype_hash: 't',
            flaw_hash: 'f',
            flaw_hash_ordinal: 1,
            cause_hash: 'c',
            cause_hash_ordinal: 1
        }
    };
    const key = findingKey(finding);
    assert.equal(key, 'p:t:f:1:c:1');
    assert.equal(key.includes('eval'), false);
    assert.equal(findingKey({ ...finding, module: 'other.zip' }), key);
});

test('parseScanFiles lê JSON array e cai para scan_file', () => {
    assert.deepEqual(parseScanFiles('["a.zip","b.zip"]', ''), ['a.zip', 'b.zip']);
    assert.deepEqual(parseScanFiles('', 'only.zip'), ['only.zip']);
});

test('classifySlot: ausente ou scan_status ruim é scan_error; filtered com findings é policy', () => {
    const dir = makeDir();
    assert.equal(classifySlot(dir, 1).classification, 'scan_error');

    writeJson(dir, 'results-2.json', { scan_status: 'FAILED', findings: [] });
    assert.equal(classifySlot(dir, 2).classification, 'scan_error');

    writeJson(dir, 'results-3.json', {
        scan_id: 'abc',
        scan_status: 'SUCCESS',
        findings: [{ title: 'x', severity: 5 }]
    });
    writeJson(dir, 'filtered-3.json', { findings: [{ title: 'x', severity: 5 }] });
    assert.equal(classifySlot(dir, 3).classification, 'policy');

    writeJson(dir, 'results-4.json', {
        scan_id: 'def',
        scan_status: 'SUCCESS',
        findings: [{ title: 'y' }]
    });
    writeJson(dir, 'filtered-4.json', { findings: [] });
    assert.equal(classifySlot(dir, 4).classification, 'sem_findings');
});

test('classifySlot: No files found via JSON é unscannable', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', {
        scan_id: 'u1',
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });
    assert.equal(classifySlot(dir, 1).classification, 'unscannable');
    assert.equal(classifySlot(dir, 1).scanStatus, 'FAILURE');
});

test('classifySlot: mensagem no results-N.txt é unscannable mesmo sem JSON', () => {
    const dir = makeDir();
    fs.writeFileSync(
        path.join(dir, 'results-2.txt'),
        'PIPELINE-SCAN ERROR: The scan failed to complete: there are no results to analyze.\n'
        + 'SCAN_STATUS: FAILURE\nSCAN_MESSAGE: No files found for scanning\n'
    );
    assert.equal(classifySlot(dir, 2).classification, 'unscannable');
});

test('classifySlot: FAILURE sem mensagem conhecida continua scan_error', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', {
        scan_status: 'FAILURE',
        scan_message: 'HTTP 429 Too Many Requests'
    });
    assert.equal(classifySlot(dir, 1).classification, 'scan_error');
});

test('mergeSlots: SUCCESS + unscannable não falha e não conta unscannable em scanned', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', {
        scan_id: 's1',
        scan_status: 'SUCCESS',
        modules: ['a.js'],
        findings: []
    });
    writeJson(dir, 'filtered-1.json', { findings: [] });
    writeJson(dir, 'results-2.json', {
        scan_id: 's2',
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });

    const result = mergeSlots({
        workspace: dir,
        files: ['app-js.zip', 'python-no-pm.zip'],
        manifestPath: path.join(dir, 'manifest.json')
    });

    assert.equal(result.scanOutcome, 'success');
    assert.equal(result.scanErrorCount, 0);
    assert.equal(result.unscannableCount, 1);
    assert.equal(result.scannedCount, 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.scans[0].classification, 'sem_findings');
    assert.equal(manifest.scans[1].classification, 'unscannable');
    assert.equal(fs.existsSync(path.join(dir, 'results.json')), true);
});

test('mergeSlots: todos unscannable grava results.json vazio e outcome success', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', {
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });
    fs.writeFileSync(
        path.join(dir, 'results-2.txt'),
        'there are no results to analyze\n'
    );

    const result = mergeSlots({
        workspace: dir,
        files: ['a.zip', 'b.zip'],
        manifestPath: path.join(dir, 'manifest.json')
    });

    assert.equal(result.scanOutcome, 'success');
    assert.equal(result.scanErrorCount, 0);
    assert.equal(result.unscannableCount, 2);
    assert.equal(result.scannedCount, 0);
    const merged = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
    assert.equal(merged.scan_status, 'SUCCESS');
    assert.deepEqual(merged.findings, []);
});

test('retryPlan não marca unscannable', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', { scan_id: 's1', scan_status: 'SUCCESS', findings: [] });
    writeJson(dir, 'results-2.json', {
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });
    const retries = retryPlan({
        workspace: dir,
        files: ['ok.zip', 'empty.zip', 'missing.zip']
    });
    assert.equal(retries.length, 1);
    assert.equal(retries[0].slot, 3);
    assert.equal(retries[0].file, 'missing.zip');
});

test('mergeScanDocuments une findings sem duplicar e sem chaves novas', () => {
    const a = {
        scan_id: 'one',
        scan_status: 'SUCCESS',
        message: 'ok',
        modules: ['app.js'],
        modules_count: 1,
        findings: [{
            title: 'one',
            flaw_match: { flaw_hash: 'h1', procedure_hash: 'p', prototype_hash: 't' }
        }]
    };
    const b = {
        scan_id: 'two',
        scan_status: 'SUCCESS',
        modules: ['app.js', 'lib.js'],
        modules_count: 2,
        findings: [
            {
                title: 'dup',
                flaw_match: { flaw_hash: 'h1', procedure_hash: 'p', prototype_hash: 't' }
            },
            {
                title: 'two',
                flaw_match: { flaw_hash: 'h2', procedure_hash: 'p', prototype_hash: 't' }
            }
        ]
    };
    const merged = mergeScanDocuments([a, b]);
    assert.equal(merged.scan_id, 'one');
    assert.equal(merged.scan_status, 'SUCCESS');
    assert.equal(merged.findings.length, 2);
    assert.deepEqual(merged.modules, ['app.js', 'lib.js']);
    assert.equal(merged.modules_count, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(merged, 'artifacts'), false);
});

test('mergeSlots grava results.json unificado e classifica policy vs erro', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', {
        scan_id: 's1',
        scan_status: 'SUCCESS',
        modules: ['a.js'],
        findings: [{
            title: 'a',
            flaw_match: { flaw_hash: 'ha' }
        }]
    });
    writeJson(dir, 'filtered-1.json', { findings: [] });
    writeJson(dir, 'results-2.json', {
        scan_id: 's2',
        scan_status: 'SUCCESS',
        modules: ['b.js'],
        findings: [{
            title: 'b',
            severity: 5,
            flaw_match: { flaw_hash: 'hb' }
        }]
    });
    writeJson(dir, 'filtered-2.json', {
        findings: [{ title: 'b', severity: 5, flaw_match: { flaw_hash: 'hb' } }]
    });

    const result = mergeSlots({
        workspace: dir,
        files: ['front.zip', 'api.zip', ''],
        manifestPath: path.join(dir, 'manifest.json')
    });

    assert.equal(result.scanOutcome, 'success');
    assert.equal(result.scannedCount, 2);
    assert.equal(result.scanErrorCount, 0);
    assert.equal(result.policyViolations, 1);
    const merged = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
    assert.equal(merged.findings.length, 2);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.scans[0].classification, 'sem_findings');
    assert.equal(manifest.scans[1].classification, 'policy');
    assert.equal(manifest.scans[1].scan_id, 's2');
});

test('mergeSlots com results ausente conta scan_error e não vira sucesso', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', {
        scan_id: 's1',
        scan_status: 'SUCCESS',
        findings: []
    });
    writeJson(dir, 'filtered-1.json', { findings: [] });

    const result = mergeSlots({
        workspace: dir,
        files: ['ok.zip', 'bad.zip'],
        manifestPath: path.join(dir, 'manifest.json')
    });
    assert.equal(result.scanOutcome, 'failure');
    assert.equal(result.scanErrorCount, 1);
    assert.equal(result.scannedCount, 1);
    assert.equal(fs.existsSync(path.join(dir, 'results.json')), true);
});

test('retryPlan só marca slots sem results válido', () => {
    const dir = makeDir();
    writeJson(dir, 'results-1.json', { scan_id: 's1', scan_status: 'SUCCESS', findings: [] });
    const retries = retryPlan({
        workspace: dir,
        files: ['ok.zip', 'missing.zip', '']
    });
    assert.equal(retries.length, 1);
    assert.equal(retries[0].slot, 2);
    assert.equal(retries[0].file, 'missing.zip');
});

test('extractFindings lê o formato real da Veracode', () => {
    assert.equal(extractFindings({ findings: [{ title: 'x' }] }).length, 1);
    assert.equal(extractFindings({ scanResult: { findings: [{ title: 'x' }] } }).length, 1);
});
