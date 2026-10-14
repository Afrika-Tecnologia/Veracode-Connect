'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = cp.spawnSync(bash, ['--version']).status === 0;

function seedStep(action, context) {
    const step = fs.readFileSync(path.join(action, 'action.yml'), 'utf8')
        .split('      id: seed_gate')[1].split('\n    - name:')[0];
    const [config, source] = step.split('      run: |');
    const env = Object.fromEntries([...config.matchAll(/([A-Z_]+): \$\{\{ ([^}]+?) \}\}/g)]
        .map(([, key, expression]) => {
            assert.ok(Object.hasOwn(context, expression), `Unsupported context: ${expression}`);
            return [key, context[expression]];
        }));
    return { env, script: source.split(/\r?\n/).slice(1).map(line => line.slice(8)).join('\n') };
}

const scenarios = [
    { name: 'PR to main', head: 'feature/clean', ref: '42/merge', base: 'main', defaultBranch: 'main', allowed: 'true' },
    { name: 'PR to master', head: 'feature/clean', ref: '42/merge', base: 'master', defaultBranch: 'master', allowed: 'true' },
    { name: 'PR to custom default branch', head: 'feature/clean', ref: '42/merge', base: 'release/stable', defaultBranch: 'release/stable', allowed: 'true' },
    { name: 'PR to another branch', head: 'feature/clean', ref: '42/merge', base: 'develop', defaultBranch: 'main', allowed: 'false' },
    { name: 'PR from default branch to another branch', head: 'main', ref: '42/merge', base: 'develop', defaultBranch: 'main', allowed: 'false' },
    { name: 'PR to main when default is master', head: 'feature/clean', ref: '42/merge', base: 'main', defaultBranch: 'master', allowed: 'false' },
    { name: 'push on default branch', head: '', ref: 'release/stable', base: '', defaultBranch: 'release/stable', allowed: 'true' },
    { name: 'push on another branch', head: '', ref: 'feature/clean', base: '', defaultBranch: 'main', allowed: 'false' },
    { name: 'unknown default branch', head: '', ref: 'main', base: '', defaultBranch: '', allowed: 'false' }
];

for (const provider of ['repo-baseline-flow', 'portal-afrika-baseline-flow']) {
    for (const scenario of scenarios) {
        test(`${provider} baseline seed eligibility: ${scenario.name}`, { skip: !available }, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-baseline-seed-'));
            try {
                const action = path.resolve(__dirname, '..', provider);
                const output = path.join(dir, 'output');
                const step = seedStep(action, { 'github.head_ref': scenario.head, 'github.ref_name': scenario.ref,
                    'github.base_ref': scenario.base, 'github.event.repository.default_branch': scenario.defaultBranch,
                    'steps.check_baseline.outputs.has_baseline': 'false' });
                const env = { ...process.env,
                    GITHUB_ACTION_PATH: action.replace(/\\/g, '/'), GITHUB_OUTPUT: output.replace(/\\/g, '/'),
                    ...step.env };
                const run = cp.spawnSync(bash, ['-c', step.script], { cwd: dir, env, encoding: 'utf8' });
                assert.equal(run.status, 0, run.stderr);
                const outputs = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n')
                    .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
                assert.equal(outputs.can_seed, scenario.allowed);
                assert.equal(outputs.current_branch, scenario.head || scenario.ref);
                assert.equal(outputs.default_branch, scenario.defaultBranch);
                if (scenario.allowed === 'true') assert.doesNotMatch(run.stdout, /::warning::/);
                else assert.match(run.stdout, /::warning::/);
            } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        });
    }
}
