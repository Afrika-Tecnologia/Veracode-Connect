'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = cp.spawnSync(bash, ['--version']).status === 0;
const step = fs.readFileSync(path.join(__dirname, 'action.yml'), 'utf8')
    .split('      id: run_sca')[1].split('\n    - name:')[0];
const script = step.split('      run: |')[1].split(/\r?\n/).slice(1).map(line => line.slice(8)).join('\n');

for (const scenario of [
    { outcome: 'failure', policyFail: 'true', want: 'failure' },
    { outcome: 'failure', policyFail: 'false', want: 'warning' },
    { outcome: 'success', policyFail: 'true', want: 'success' },
    { outcome: 'success', policyFail: 'false', want: 'success' }
]) {
    test(`SCA ${scenario.outcome} with policy_fail=${scenario.policyFail} reports ${scenario.want} without ending the flow`, {
        skip: !available && 'Bash is required for composite-action scripts'
    }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-status-'));
        try {
            const output = path.join(dir, 'output');
            const run = cp.spawnSync(bash, ['-c', script], {
                env: {
                    ...process.env, GITHUB_ACTION_PATH: __dirname.replace(/\\/g, '/'),
                    GITHUB_OUTPUT: output.replace(/\\/g, '/'),
                    SCA_OUTCOME: scenario.outcome, POLICY_FAIL: scenario.policyFail
                }, encoding: 'utf8'
            });
            assert.equal(run.status, 0, run.stderr);
            assert.equal(fs.readFileSync(output, 'utf8'), `sca_status=${scenario.want}\n`);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
