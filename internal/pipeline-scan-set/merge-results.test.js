'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeStoreZipEntries } = require('../auto-packager/classify-artifacts.js');
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

function writeZip(dir, name, sourceName, source) {
    const filePath = path.join(dir, name);
    writeStoreZipEntries([{ name: sourceName, data: source }], filePath);
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

test('planning a new scan discards previous generated results before a failed scan can reuse them', () => {
    const dir = makeDir();
    try {
        for (let slot = 1; slot <= 6; slot++) {
            writeJson(dir, `results-${slot}.json`, { scan_status: 'SUCCESS', findings: [{ severity: 5 }] });
            writeJson(dir, `filtered-${slot}.json`, { findings: [{ severity: 5 }] });
            fs.writeFileSync(path.join(dir, `results-${slot}.txt`), 'Old scan results');
        }
        writeJson(dir, 'results.json', { findings: [{ severity: 5 }] });
        writeJson(dir, 'filtered_results.json', { findings: [{ severity: 5 }] });
        fs.writeFileSync(path.join(dir, 'baseline.json'), 'baseline to preserve');
        fs.writeFileSync(path.join(dir, 'results-custom.json'), 'unrelated file to preserve');
        const env = {
            ...process.env, GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: path.join(dir, 'output'),
            SCAN_FILES: '["app.zip"]', SCAN_FILE: '', MAX_ARTIFACTS: '6'
        };
        const plan = cp.spawnSync(process.execPath, [path.join(__dirname, 'merge-results.js'), 'plan'], { env, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        // No current result is produced: the scan failed before writing output.
        const merged = mergeSlots({ workspace: dir, files: ['app.zip'], manifestPath: path.join(dir, 'manifest.json') });
        assert.equal(merged.policyViolations, 0);
        assert.equal(merged.scannedCount, 0);
        assert.equal(merged.scanErrorCount, 1);
        assert.equal(fs.existsSync(path.join(dir, 'results.json')), false);
        for (let slot = 1; slot <= 6; slot++) {
            for (const name of [`results-${slot}.json`, `filtered-${slot}.json`, `results-${slot}.txt`]) {
                assert.equal(fs.existsSync(path.join(dir, name)), false, name);
            }
        }
        assert.equal(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8'), 'baseline to preserve');
        assert.equal(fs.readFileSync(path.join(dir, 'results-custom.json'), 'utf8'), 'unrelated file to preserve');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
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
    const empty = writeZip(dir, 'empty-python.zip', 'constants.py', '');
    writeJson(dir, 'results-1.json', {
        scan_id: 'u1',
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });
    assert.equal(classifySlot(dir, 1, empty).classification, 'unscannable');
    assert.equal(classifySlot(dir, 1, empty).scanStatus, 'FAILURE');
});

test('classifySlot: mensagem no results-N.txt é unscannable mesmo sem JSON', () => {
    const dir = makeDir();
    const empty = writeZip(dir, 'empty-python.zip', 'constants.py', '');
    fs.writeFileSync(
        path.join(dir, 'results-2.txt'),
        'PIPELINE-SCAN ERROR: The scan failed to complete: there are no results to analyze.\n'
        + 'SCAN_STATUS: FAILURE\nSCAN_MESSAGE: No files found for scanning\n'
    );
    assert.equal(classifySlot(dir, 2, empty).classification, 'unscannable');
});

test('mensagem No files found em ZIP com fonte real continua erro de scan', () => {
    const dir = makeDir();
    const app = writeZip(dir, 'app-python.zip', 'app.py', 'print("scan")');
    writeJson(dir, 'results-1.json', {
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });
    assert.equal(classifySlot(dir, 1, app).classification, 'scan_error');
    const merged = mergeSlots({
        workspace: dir,
        files: [app],
        manifestPath: path.join(dir, 'manifest.json')
    });
    assert.equal(merged.scanErrorCount, 1);
    assert.equal(merged.scanOutcome, 'failure');
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
    const empty = writeZip(dir, 'python-no-pm.zip', 'constants.py', '');
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
        files: ['app-js.zip', empty],
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

test('mergeSlots: todos unscannable falha sem criar resultado ou baseline vazio', () => {
    const dir = makeDir();
    const emptyA = writeZip(dir, 'a.zip', 'constants.py', '');
    const emptyB = writeZip(dir, 'b.zip', 'config.py', '');
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
        files: [emptyA, emptyB],
        manifestPath: path.join(dir, 'manifest.json')
    });

    assert.equal(result.scanOutcome, 'failure');
    assert.equal(result.scanErrorCount, 2);
    assert.equal(result.unscannableCount, 2);
    assert.equal(result.scannedCount, 0);
    assert.equal(fs.existsSync(path.join(dir, 'results.json')), false);
});

test('retryPlan não marca unscannable', () => {
    const dir = makeDir();
    const empty = writeZip(dir, 'empty.zip', 'constants.py', '');
    writeJson(dir, 'results-1.json', { scan_id: 's1', scan_status: 'SUCCESS', findings: [] });
    writeJson(dir, 'results-2.json', {
        scan_status: 'FAILURE',
        scan_message: 'No files found for scanning'
    });
    const retries = retryPlan({
        workspace: dir,
        files: ['ok.zip', empty, 'missing.zip']
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
