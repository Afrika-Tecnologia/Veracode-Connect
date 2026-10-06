'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = cp.spawnSync(bash, ['--version']).status === 0;

function scriptFor(dir, id) {
    const step = fs.readFileSync(path.join(dir, 'action.yml'), 'utf8').split(`      id: ${id}`)[1].split('\n    - name:')[0];
    return step.split('      run: |')[1].split(/\r?\n/).slice(1).map(line => line.slice(8)).join('\n');
}

for (const provider of ['repo-baseline-flow', 'portal-afrika-baseline-flow']) {
    for (const seeded of ['skipped', 'success']) {
        test(`${provider} initial scan with policy findings stays completed when seed=${seeded}`, { skip: !available }, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-baseline-initial-'));
            try {
                const action = path.resolve(__dirname, '..', provider);
                const output = path.join(dir, 'output');
                const env = { ...process.env, GITHUB_ACTION_PATH: action.replace(/\\/g, '/'),
                    GITHUB_OUTPUT: output.replace(/\\/g, '/'), SCAN_ERROR_COUNT: '0', POLICY_VIOLATIONS: '1',
                    POLICY_FAIL: 'true', CAN_SEED: seeded === 'success' ? 'true' : 'false', SEEDED: seeded };
                const run = cp.spawnSync(bash, ['-c', scriptFor(action, 'pipeline_status_without_baseline')], { cwd: dir, env, encoding: 'utf8' });
                assert.equal(run.status, 0, run.stderr);
                assert.equal(fs.readFileSync(output, 'utf8'), seeded === 'success'
                    ? 'pipeline_status=scan_completed_without_baseline_and_uploaded\n'
                    : 'pipeline_status=scan_completed_without_baseline\n');
                // Even if this execution just saved a baseline, it was not used by its scan.
                fs.writeFileSync(path.join(dir, 'results.json'), '{"findings":[]}');
                fs.writeFileSync(path.join(dir, 'baseline.json'), '{"findings":[]}');
                const check = cp.spawnSync(bash, ['-c', scriptFor(action, 'policy_check')], {
                    cwd: dir, env: { ...env, HAS_BASELINE: 'false' }, encoding: 'utf8'
                });
                assert.equal(check.status, 0, check.stderr);
                assert.doesNotMatch(check.stdout, /::warning::/);
                const enforced = cp.spawnSync(bash, ['-c', scriptFor(action, 'policy_check')], {
                    cwd: dir, env: { ...env, HAS_BASELINE: 'true' }, encoding: 'utf8'
                });
                assert.equal(enforced.status, 0, enforced.stderr);
                assert.match(enforced.stdout, /::warning::/);
                const technical = cp.spawnSync(bash, ['-c', scriptFor(action, 'policy_check')], {
                    cwd: dir, env: { ...env, HAS_BASELINE: 'false', SCAN_ERROR_COUNT: '1' }, encoding: 'utf8'
                });
                assert.equal(technical.status, 0, technical.stderr);
                assert.match(technical.stdout, /::warning::/);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });
    }
}
