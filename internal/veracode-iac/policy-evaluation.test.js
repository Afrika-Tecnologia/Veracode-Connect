'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { evaluatePolicyResult, resolveIacStatus } = require('./policy-evaluation');

function withResult(result, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-'));
    const file = path.join(dir, 'results.json');
    try {
        fs.writeFileSync(file, JSON.stringify(result));
        return run(file);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('policy-passed false marks policy failed even when CLI exits with policy code 3', () => {
    withResult({ 'policy-passed': 'failed' }, (file) => {
        assert.equal(evaluatePolicyResult(file, 3), 'failed');
    });
});

test('camelCase policyPassed true is accepted with a successful CLI exit', () => {
    withResult({ policyPassed: true }, (file) => {
        assert.equal(evaluatePolicyResult(file, 0), 'passed');
    });
});

test('unexpected CLI error cannot be mistaken for a policy failure result', () => {
    withResult({ 'policy-passed': 'failed' }, (file) => {
        assert.equal(evaluatePolicyResult(file, 1), 'error');
    });
});

test('malformed scan output is classified as policy evaluation error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-'));
    const file = path.join(dir, 'results.json');
    try {
        fs.writeFileSync(file, '{not-json');
        assert.equal(evaluatePolicyResult(file, 0), 'error');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('none preserves the official scan status without a policy result', () => {
    assert.deepEqual(resolveIacStatus?.({ policyName: 'none', scanOutcome: 'success' }), {
        iac_status: 'success',
        iac_policy_status: 'not_used'
    });
});

test('failed IaC policy marks the consolidated IaC status failed after the scan completes', () => {
    assert.deepEqual(resolveIacStatus?.({
        policyName: 'Team IaC',
        scanStatus: 'success',
        policyStatus: 'failed'
    }), {
        iac_status: 'failure',
        iac_policy_status: 'failed'
    });
});

test('passed IaC policy keeps the consolidated scan successful', () => {
    assert.deepEqual(resolveIacStatus({
        policyName: 'Team IaC',
        scanStatus: 'success',
        policyStatus: 'passed'
    }), {
        iac_status: 'success',
        iac_policy_status: 'passed'
    });
});

test('policy download/evaluation error remains visible after fallback scan completes', () => {
    assert.deepEqual(resolveIacStatus?.({
        policyName: 'Team IaC',
        scanStatus: 'success',
        policyStatus: 'error'
    }), {
        iac_status: 'failure',
        iac_policy_status: 'error'
    });
});

test('scan technical error cannot be presented as a successful policy evaluation', () => {
    assert.deepEqual(resolveIacStatus({
        policyName: 'Team IaC',
        scanStatus: 'failure',
        policyStatus: 'passed'
    }), {
        iac_status: 'failure',
        iac_policy_status: 'error'
    });
});

test('status command exports policy failure for the composite action outputs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-output-'));
    const output = path.join(dir, 'github-output');
    try {
        const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-evaluation.js'), 'status'], {
            env: {
                ...process.env,
                GITHUB_OUTPUT: output,
                IAC_POLICY: 'Team IaC',
                IAC_SCAN_STATUS: 'success',
                IAC_POLICY_STATUS: 'failed'
            },
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, 'failure\n');
        assert.equal(fs.readFileSync(output, 'utf8'), 'iac_status=failure\niac_policy_status=failed\n');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
