'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hasPolicyFailure, isCurrentScanResult, shouldBlockPolicy } = require('./policy-decision');

for (const baselineMode of ['repo', 'portal_afrika']) {
    test(`${baselineMode} policy enforcement starts only when the scan uses a registered baseline`, () => {
        const decision = { baselineMode, hasBaseline: 'false', failBuild: 'true', policyFail: 'true',
            scanErrorCount: '0', policyViolations: '1', plannedCount: '1', scannedCount: '1',
            flowOutcome: 'success', resultAvailable: true };
        assert.equal(hasPolicyFailure(decision), false);
        assert.equal(shouldBlockPolicy(decision), false);
        assert.equal(shouldBlockPolicy({ ...decision, hasBaseline: 'true' }), true);
        assert.equal(shouldBlockPolicy({ ...decision, hasBaseline: '' }), false);
        assert.equal(shouldBlockPolicy({ ...decision, iacPolicyStatus: 'failed' }), true);
        assert.equal(shouldBlockPolicy({ ...decision, scaStatus: 'failure' }), true);
    });
}

test('blocks only when policy failure is enabled and valid scans have violations', () => {
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', flowOutcome: 'success', resultAvailable: true }), true);
    assert.equal(shouldBlockPolicy({ failBuild: 'false', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'false', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '0', plannedCount: '2', scannedCount: '2', resultAvailable: true }), false);
});

test('technical scan errors without confirmed policy evidence never block the workflow', () => {
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '1', policyViolations: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '', policyViolations: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: 'not-a-number', policyViolations: '2', resultAvailable: true }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', resultAvailable: false }), false);
    assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true', scanErrorCount: '1', policyViolations: '0', plannedCount: '2', scannedCount: '1', flowOutcome: 'failure', resultAvailable: true }), false);
});

test('recognizes policy findings even when build blocking is disabled', () => {
    const result = { failBuild: 'false', policyFail: 'true', scanErrorCount: '0', policyViolations: '2', plannedCount: '2', scannedCount: '2', flowOutcome: 'success', resultAvailable: true };
    assert.equal(hasPolicyFailure(result), true);
    assert.equal(shouldBlockPolicy(result), false);
    assert.equal(hasPolicyFailure({ ...result, scanErrorCount: 'not-a-number' }), false);
});

test('confirmed Pipeline violations still block when another artifact has a technical error', () => {
    const decision = {
        failBuild: 'true', policyFail: 'true', scanErrorCount: '1', policyViolations: '1',
        plannedCount: '2', scannedCount: '1', flowOutcome: 'failure', resultAvailable: true
    };
    assert.equal(hasPolicyFailure(decision), true);
    assert.equal(shouldBlockPolicy(decision), true);
    assert.equal(shouldBlockPolicy({ ...decision, scanErrorCount: '0', flowOutcome: 'success' }), true);
    for (const invalid of [
        { scannedCount: '0' }, { scannedCount: '3' }, { policyViolations: '2' },
        { plannedCount: '' }, { flowOutcome: 'skipped' }, { resultAvailable: false }
    ]) {
        assert.equal(shouldBlockPolicy({ ...decision, ...invalid }), false);
    }
});

test('blocks a rejected IaC policy without requiring Pipeline Scan results', () => {
    const decision = { failBuild: 'true', policyFail: 'true', iacPolicyStatus: 'failed', resultAvailable: false };
    assert.equal(shouldBlockPolicy(decision), true);
    assert.equal(shouldBlockPolicy({ ...decision, failBuild: 'false' }), false);
    assert.equal(shouldBlockPolicy({ ...decision, policyFail: 'false' }), false);
    for (const status of ['passed', 'error', 'not_used', 'skipped', '', undefined]) {
        assert.equal(shouldBlockPolicy({ ...decision, iacPolicyStatus: status }), false);
    }
});

test('honors a failed SCA result with policy blocking enabled at the final gate', () => {
    const decision = { failBuild: 'true', policyFail: 'true', scaStatus: 'failure', resultAvailable: false };
    assert.equal(shouldBlockPolicy(decision), true);
    assert.equal(shouldBlockPolicy({ ...decision, policyFail: 'false' }), false);
    assert.equal(shouldBlockPolicy({ ...decision, failBuild: 'false' }), false);
    for (const status of ['success', 'warning', 'skipped', '', undefined]) {
        assert.equal(shouldBlockPolicy({ ...decision, scaStatus: status }), false);
    }
});

test('a Pipeline technical error does not hide a confirmed IaC policy rejection', () => {
    assert.equal(shouldBlockPolicy({
        failBuild: 'true', policyFail: 'true', iacPolicyStatus: 'failed',
        scanErrorCount: '1', plannedCount: '2', scannedCount: '1',
        policyViolations: '0', flowOutcome: 'failure', resultAvailable: true
    }), true);
});

test('recognizes Pipeline policy findings when policy blocking is disabled', () => {
    const decision = {
        failBuild: 'true', policyFail: 'false', scanErrorCount: '0', policyViolations: '1',
        plannedCount: '1', scannedCount: '1', flowOutcome: 'success', resultAvailable: true
    };
    assert.equal(hasPolicyFailure(decision), true);
    assert.equal(shouldBlockPolicy(decision), false);
});

test('CLI keeps Pipeline status separate from an IaC policy block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-'));
    try {
        const marker = path.join(dir, 'started');
        const resultPath = path.join(dir, 'results.json');
        fs.writeFileSync(marker, '');
        fs.writeFileSync(resultPath, '{"findings":[]}');
        const cases = [
            { name: 'IaC only', planned: '', scanned: '', violations: '', errors: '', outcome: 'skipped', policyFail: 'true', expected: 'blocked=true\npolicy_present=false\nscan_status=\n' },
            { name: 'Pipeline passed', planned: '1', scanned: '1', violations: '0', errors: '0', outcome: 'success', policyFail: 'true', expected: 'blocked=true\npolicy_present=false\nscan_status=\n' },
            { name: 'Pipeline technical error', planned: '2', scanned: '1', violations: '0', errors: '1', outcome: 'failure', policyFail: 'true', expected: 'blocked=true\npolicy_present=false\nscan_status=warning\n' },
            { name: 'blocking disabled', planned: '1', scanned: '1', violations: '1', errors: '0', outcome: 'success', policyFail: 'false', expected: 'blocked=false\npolicy_present=true\nscan_status=failure\n' }
        ];
        for (const scenario of cases) {
            const output = path.join(dir, `output-${scenario.name}`);
            const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-decision.js')], {
                env: {
                    ...process.env, GITHUB_OUTPUT: output, FAIL_BUILD: 'true', POLICY_FAIL: scenario.policyFail,
                    IAC_POLICY_STATUS: 'failed', PLANNED_COUNT: scenario.planned, SCANNED_COUNT: scenario.scanned,
                    POLICY_VIOLATIONS: scenario.violations, SCAN_ERROR_COUNT: scenario.errors,
                    FLOW_OUTCOME: scenario.outcome, START_MARKER: marker, PIPELINE_RESULT: resultPath
                }
            });
            assert.equal(run.status, 0, `${scenario.name}: ${run.stderr}`);
            assert.equal(fs.readFileSync(output, 'utf8'), scenario.expected, scenario.name);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
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

test('CLI blocks on confirmed policy findings in an incomplete scan', () => {
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
        assert.equal(fs.readFileSync(output, 'utf8'), 'blocked=true\npolicy_present=true\nscan_status=failure\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI reports confirmed policy findings as failure even when build blocking is disabled', () => {
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
        assert.equal(fs.readFileSync(output, 'utf8'), 'blocked=false\npolicy_present=true\nscan_status=failure\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
