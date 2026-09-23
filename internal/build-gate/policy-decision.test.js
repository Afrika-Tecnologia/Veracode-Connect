'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hasPolicyFailure, isCurrentScanResult, shouldBlockPolicy } = require('./policy-decision');

test('blocks only when policy failure is enabled and a complete scan has violations', () => {
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', flowOutcome: 'success', resultAvailable: true }), true);
    assert.equal(shouldBlockPolicy({ failBuild: 'false', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'false', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '0', plannedCount: '2', scannedCount: '2', resultAvailable: true }), false);
});

test('technical scan errors and unavailable results never block the workflow', () => {
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '1', policyViolations: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '', policyViolations: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: 'not-a-number', policyViolations: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', resultAvailable: false }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '1', plannedCount: '2', scannedCount: '1', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '1', plannedCount: '1', scannedCount: '1', flowOutcome: 'failure', resultAvailable: true }), false);
});

test('recognizes policy findings even when build blocking is disabled', () => {
    const result = { failBuild: 'false', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', flowOutcome: 'success', resultAvailable: true };
    assert.equal(hasPolicyFailure(result), true);
    assert.equal(shouldBlockPolicy(result), false);
    assert.equal(hasPolicyFailure({ ...result, scanErrorCount: '1' }), false);
});

test('requires a fresh, valid merged result before treating findings as policy failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-'));
    try {
        const marker = path.join(dir, 'started');
        const resultPath = path.join(dir, 'results.json');
        fs.writeFileSync(marker, '');
        assert.equal(isCurrentScanResult(resultPath, marker), false);
        fs.writeFileSync(resultPath, '{invalid');
        assert.equal(isCurrentScanResult(resultPath, marker), false);
        fs.writeFileSync(resultPath, '{"other":[]}');
        assert.equal(isCurrentScanResult(resultPath, marker), false);
        fs.writeFileSync(resultPath, '{"findings":[]}');
        assert.equal(isCurrentScanResult(resultPath, marker), true);
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(resultPath, old, old);
        assert.equal(isCurrentScanResult(resultPath, marker), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI writes the policy decision for later composite steps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-'));
    try {
        const output = path.join(dir, 'github-output');
        const marker = path.join(dir, 'started');
        const resultPath = path.join(dir, 'results.json');
        fs.writeFileSync(marker, '');
        fs.writeFileSync(resultPath, '{"findings":[]}');
        const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-decision.js')], {
            env: {
                ...process.env,
                GITHUB_OUTPUT: output,
                FAIL_BUILD: 'true',
                POLICY_FAIL: 'true',
                SCAN_ERROR_COUNT: '0',
                POLICY_VIOLATIONS: '1',
                PLANNED_COUNT: '1',
                SCANNED_COUNT: '1',
                FLOW_OUTCOME: 'success',
                START_MARKER: marker,
                PIPELINE_RESULT: resultPath
            }
        });
        assert.equal(run.status, 0, run.stderr.toString());
        assert.equal(fs.readFileSync(output, 'utf8'), 'blocked=true\npolicy_present=true\nscan_status=failure\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI reports a technical scan error as warning without blocking', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-'));
    try {
        const output = path.join(dir, 'github-output');
        const marker = path.join(dir, 'started');
        const resultPath = path.join(dir, 'results.json');
        fs.writeFileSync(marker, '');
        fs.writeFileSync(resultPath, '{"findings":[]}');
        const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-decision.js')], {
            env: {
                ...process.env,
                GITHUB_OUTPUT: output,
                FAIL_BUILD: 'true',
                POLICY_FAIL: 'true',
                SCAN_ERROR_COUNT: '1',
                POLICY_VIOLATIONS: '1',
                PLANNED_COUNT: '1',
                SCANNED_COUNT: '1',
                FLOW_OUTCOME: 'success',
                START_MARKER: marker,
                PIPELINE_RESULT: resultPath
            }
        });
        assert.equal(run.status, 0, run.stderr.toString());
        assert.equal(fs.readFileSync(output, 'utf8'), 'blocked=false\npolicy_present=false\nscan_status=warning\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI warns on an incomplete scan even when another slot has policy findings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-'));
    try {
        const output = path.join(dir, 'github-output');
        const marker = path.join(dir, 'started');
        const resultPath = path.join(dir, 'results.json');
        fs.writeFileSync(marker, '');
        fs.writeFileSync(resultPath, '{"findings":[]}');
        const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-decision.js')], {
            env: {
                ...process.env, GITHUB_OUTPUT: output, FAIL_BUILD: 'true', POLICY_FAIL: 'true',
                SCAN_ERROR_COUNT: '0', POLICY_VIOLATIONS: '1', PLANNED_COUNT: '2',
                SCANNED_COUNT: '1', FLOW_OUTCOME: 'success', START_MARKER: marker,
                PIPELINE_RESULT: resultPath
            }
        });
        assert.equal(run.status, 0, run.stderr.toString());
        assert.equal(fs.readFileSync(output, 'utf8'), 'blocked=false\npolicy_present=false\nscan_status=warning\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI reports nonblocking policy findings as warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-'));
    try {
        const output = path.join(dir, 'github-output');
        const marker = path.join(dir, 'started');
        const resultPath = path.join(dir, 'results.json');
        fs.writeFileSync(marker, '');
        fs.writeFileSync(resultPath, '{"findings":[]}');
        const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-decision.js')], {
            env: {
                ...process.env,
                GITHUB_OUTPUT: output,
                FAIL_BUILD: 'false',
                POLICY_FAIL: 'true',
                SCAN_ERROR_COUNT: '0',
                POLICY_VIOLATIONS: '1',
                PLANNED_COUNT: '1',
                SCANNED_COUNT: '1',
                FLOW_OUTCOME: 'success',
                START_MARKER: marker,
                PIPELINE_RESULT: resultPath
            }
        });
        assert.equal(run.status, 0, run.stderr.toString());
        assert.equal(fs.readFileSync(output, 'utf8'), 'blocked=false\npolicy_present=true\nscan_status=warning\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
