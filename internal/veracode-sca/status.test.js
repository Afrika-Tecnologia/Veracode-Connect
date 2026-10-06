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
    { outcome: 'failure', policyFail: 'true', results: 'Total Libraries 1\nHigh Risk Vulnerabilities 1', want: 'failure' },
    { outcome: 'failure', policyFail: 'false', results: 'Total Libraries 1\nHigh Risk Vulnerabilities 1', want: 'warning' },
    { outcome: 'success', policyFail: 'true', results: 'Total Libraries 1\nHigh Risk Vulnerabilities 0', want: 'success' },
    { outcome: 'success', policyFail: 'false', results: 'Total Libraries 1\nHigh Risk Vulnerabilities 0', want: 'success' },
    { outcome: 'failure', policyFail: 'true', want: 'warning' },
    { outcome: 'success', policyFail: 'true', want: 'warning' },
    { outcome: 'failure', policyFail: 'true', results: 'Authentication failed', want: 'warning' },
    { outcome: 'failure', policyFail: 'true', results: 'Total Libraries 0\nHigh Risk Vulnerabilities 0', want: 'warning' },
    { outcome: 'failure', policyFail: 'true', results: '{invalid-json', want: 'warning' },
    { outcome: 'failure', policyFail: 'true', results: '{"records":[]}', want: 'warning' },
    { outcome: 'failure', policyFail: 'true', results: '{"records":[{"libraries":[{"name":"test"}]}]}', want: 'failure' },
    { outcome: 'skipped', policyFail: 'true', want: 'warning' }
]) {
    test(`SCA ${scenario.outcome}, policy_fail=${scenario.policyFail}, results=${scenario.results || 'absent'} reports ${scenario.want} without ending the flow`, {
        skip: !available && 'Bash is required for composite-action scripts'
    }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-status-'));
        try {
            const output = path.join(dir, 'output');
            if (scenario.results) fs.writeFileSync(path.join(dir, 'scaResults.txt'), scenario.results);
            const run = cp.spawnSync(bash, ['-c', script], {
                cwd: dir,
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

test('a failed SCA retry cannot use results left by the previous scan', { skip: !available }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-retry-'));
    try {
        const action = fs.readFileSync(path.join(__dirname, 'action.yml'), 'utf8');
        const prepare = action.split('      id: prepare_results')[1];
        assert.ok(prepare, 'SCA must prepare current-run artifacts before invoking the scanner');
        const cleanup = prepare.split('\n    - name:')[0].split('      run: |')[1]
            .split(/\r?\n/).slice(1).map(line => line.slice(8)).join('\n');
        for (const name of ['scaResults.txt', 'scaResults.json', 'veracode_sca.log']) {
            fs.writeFileSync(path.join(dir, name), 'Total Libraries 1\nHigh Risk Vulnerabilities 1');
        }
        fs.writeFileSync(path.join(dir, 'source.txt'), 'preserve source');
        const env = { ...process.env, GITHUB_ACTION_PATH: __dirname.replace(/\\/g, '/'),
            GITHUB_OUTPUT: path.join(dir, 'output').replace(/\\/g, '/'), SCA_OUTCOME: 'failure', POLICY_FAIL: 'true' };
        assert.equal(cp.spawnSync(bash, ['-c', cleanup], { cwd: dir, env }).status, 0);
        assert.equal(cp.spawnSync(bash, ['-c', script], { cwd: dir, env }).status, 0);
        assert.equal(fs.readFileSync(path.join(dir, 'output'), 'utf8'), 'sca_status=warning\n');
        assert.equal(fs.readFileSync(path.join(dir, 'source.txt'), 'utf8'), 'preserve source');
        for (const name of ['scaResults.txt', 'scaResults.json', 'veracode_sca.log']) assert.equal(fs.existsSync(path.join(dir, name)), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
