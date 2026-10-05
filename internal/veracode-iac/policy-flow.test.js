'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveIacStatus } = require('./policy-evaluation');
const { shouldBlockPolicy } = require('../build-gate/policy-decision');

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = cp.spawnSync(bash, ['--version']).status === 0;
// Exercise the command shipped by the action, including its argument positions.
const source = fs.readFileSync(path.join(__dirname, 'action.yml'), 'utf8');
const invocation = source.split(/\r?\n/).find(line => line.trimStart().startsWith('policy_status="$(node '));
assert.ok(invocation, 'Missing policy evaluation invocation');

for (const scenario of [
    { name: 'rejected policy', result: '{"policy-passed":"failed","vulnerabilities":{"matches":[]},"secrets":[],"configs":[]}', exit: '3', status: 'failed', blocked: true },
    { name: 'passed policy', result: '{"policy-passed":"passed"}', exit: '0', status: 'passed', blocked: false },
    { name: 'technical scan error', result: '{"policy-passed":"failed"}', exit: '1', status: 'error', blocked: false },
    { name: 'invalid JSON', result: '{invalid-json', exit: '0', status: 'error', blocked: false }
]) {
    test(`shipped IaC evaluation command: ${scenario.name}`, {
        skip: !available && 'Bash is required for composite-action scripts'
    }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-flow-'));
        try {
            fs.writeFileSync(path.join(dir, 'results.json'), scenario.result);
            const run = cp.spawnSync(bash, ['-c', `${invocation.trim()}\nprintf '%s\\n' "$policy_status"`], {
                env: { ...process.env, GITHUB_ACTION_PATH: __dirname.replace(/\\/g, '/'),
                    GITHUB_WORKSPACE: dir.replace(/\\/g, '/'), scan_exit: scenario.exit },
                encoding: 'utf8'
            });
            assert.equal(run.status, 0, run.stderr);
            const policyStatus = run.stdout.trim();
            assert.equal(policyStatus, scenario.status);
            const status = resolveIacStatus({ policyName: 'Container IaC Policy - N2',
                scanStatus: policyStatus === 'error' ? 'failure' : 'success', policyStatus });
            assert.equal(status.iac_policy_status, scenario.status);
            assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'true',
                iacPolicyStatus: status.iac_policy_status, scaStatus: 'success' }), scenario.blocked);
            assert.equal(shouldBlockPolicy({ failBuild: 'true', policyFail: 'false',
                iacPolicyStatus: status.iac_policy_status, scaStatus: 'success' }), false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
