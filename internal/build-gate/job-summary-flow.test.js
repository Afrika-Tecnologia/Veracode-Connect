'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCommentBody } = require('../pr-comment/build-comment');

const root = path.resolve(__dirname, '../..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const bashAvailable = cp.spawnSync(bash, ['--version']).status === 0;

function stepScript(file, id) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let index = lines.findIndex(line => line.trim() === `id: ${id}`);
    assert.notEqual(index, -1);
    while (lines[index].trim() !== 'run: |') index++;
    const indent = lines[index].search(/\S/) + 2;
    const result = [];
    for (const line of lines.slice(index + 1)) {
        if (line.trim() && line.search(/\S/) < indent) break;
        result.push(line.slice(indent));
    }
    return result.join('\n');
}

const initialize = stepScript(path.join(root, 'action.yml'), 'error_log_init');
const summarize = stepScript(path.join(__dirname, 'action.yml'), 'final_summary');

function run(script, env) {
    const result = cp.spawnSync(bash, ['-c', script], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
}

function envFor(dir) {
    return { ...process.env,
        RUNNER_TEMP: dir.replace(/\\/g, '/'), GITHUB_WORKSPACE: dir.replace(/\\/g, '/'),
        GITHUB_REPOSITORY: 'example/repo', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'security',
        GITHUB_ACTION_PATH: root.replace(/\\/g, '/'), GITHUB_ENV: path.join(dir, 'env').replace(/\\/g, '/'),
        GITHUB_OUTPUT: path.join(dir, 'outputs').replace(/\\/g, '/'),
        ENABLE_ERROR_LOGS: 'false', ENABLE_PIPELINESCAN: 'false', ENABLE_SCA: 'false', ENABLE_IAC: 'false',
        ENABLE_UPLOAD_SCAN: 'false', ENABLE_AUTO_PACKAGER: 'false',
        FAIL_BUILD: 'false', SCA_STATUS: 'skipped', IAC_OUTCOME: 'skipped', IAC_POLICY_STATUS: 'not_used',
        IAC_POLICY_NAME: '', BASELINE_OUTCOME: 'skipped', REPO_BASELINE_OUTCOME: 'skipped',
        PIPELINE_OUTCOME: 'skipped', UPLOAD_OUTCOME: 'skipped', VALIDATE_OUTCOME: 'success',
        BASELINE_MODE: 'none', SCA_SCAN_URL: '' };
}

function finalSummary(env, filename) {
    const summary = path.join(env.RUNNER_TEMP, filename);
    run(summarize, { ...env, GITHUB_ACTION_PATH: __dirname.replace(/\\/g, '/'),
        GITHUB_STEP_SUMMARY: summary.replace(/\\/g, '/') });
    return fs.readFileSync(summary, 'utf8');
}

function writeFragment(env, name, markdown) {
    const dir = path.join(env.RUNNER_TEMP, 'veracode-connect-summary');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), markdown);
}

test('last summary and PR retain an earlier Pipeline Scan after the IaC scan replaces results.json',
    { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-job-summary-'));
        try {
            const env = envFor(dir);
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            const pipeline = '### Veracode Pipeline Scan (Repo Baseline)\n\nSAST policy: zero blocking findings; 98 total findings.\n';
            writeFragment(env, 'pipeline', pipeline);
            finalSummary({ ...env, REPO_BASELINE_OUTCOME: 'success', BASELINE_MODE: 'repo' }, 'first.md');

            run(initialize, { ...env, ENABLE_SCA: 'true', ENABLE_IAC: 'true' });
            fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ 'policy-passed': 'failed', vulnerabilities: { matches: [] } }));
            writeFragment(env, 'sca', '### SCA current results\n');
            writeFragment(env, 'iac', '### IaC current results\n');
            const current = { ...env, FAIL_BUILD: 'true', SCA_STATUS: 'success', IAC_OUTCOME: 'failure',
                IAC_POLICY_STATUS: 'failed', IAC_POLICY_NAME: 'Team IaC' };
            const md = finalSummary(current, 'last.md');
            const [, final] = md.split('Resumo Final');
            assert.match(final, /\| Pipeline Scan \(Repo Baseline\) \| ✅ Success \|/);
            assert.match(final, /\| Veracode SCA \| ✅ Success \|/);
            assert.match(final, /\| Política IaC \| ❌ Failed \|/);
            assert.ok(md.includes(pipeline));

            const body = buildCommentBody({ workspace: dir, workflowRunUrl: 'https://github.com/example/repo/actions/runs/123',
                summaryContext: current, inputs: { fail_build: 'true', sca_status: 'success', iac_outcome: 'failure',
                    iac_policy_status: 'failed', iac_policy_name: 'Team IaC', baseline_mode: 'none',
                    pipeline_outcome: 'skipped', baseline_outcome: 'skipped', repo_baseline_outcome: 'skipped' } });
            assert.ok(body.includes(pipeline), 'PR must use the saved Pipeline fragment, not the overwritten IaC results.json');
            assert.match(body, /\| Pipeline Scan \(Repo Baseline\) \| ✅ Success \|/);
            assert.match(body, /Política IaC — Team IaC \| ❌ Failed/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

for (const field of ['GITHUB_JOB', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_WORKSPACE']) {
    test(`summaries never inherit scans from another ${field}`, { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-summary-scope-'));
        try {
            const env = envFor(dir);
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            writeFragment(env, 'pipeline', 'OLD PIPELINE FINDINGS\n');
            finalSummary({ ...env, REPO_BASELINE_OUTCOME: 'failure', BASELINE_MODE: 'repo', FAIL_BUILD: 'true' }, 'old.md');
            const other = { ...env, [field]: `${env[field]}-other`, ENABLE_SCA: 'true' };
            run(initialize, other);
            writeFragment(other, 'sca', 'CURRENT SCA\n');
            const md = finalSummary({ ...other, SCA_STATUS: 'success' }, 'other.md');
            assert.doesNotMatch(md, /OLD PIPELINE FINDINGS|Repo Baseline|Build travado/);
            assert.match(md, /Veracode SCA \| ✅ Success/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}

test('a previously rejected Pipeline remains red in the last summary even when the later scans pass',
    { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-job-failure-'));
        try {
            const env = envFor(dir);
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            writeFragment(env, 'pipeline', 'Pipeline rejected by policy\n');
            finalSummary({ ...env, BASELINE_OUTCOME: 'failure', BASELINE_MODE: 'portal_afrika', FAIL_BUILD: 'true' }, 'first.md');
            run(initialize, { ...env, ENABLE_SCA: 'true' });
            writeFragment(env, 'sca', 'SCA passed\n');
            const md = finalSummary({ ...env, SCA_STATUS: 'success' }, 'last.md');
            assert.match(md, /Pipeline Scan \(Portal Afrika Baseline\) \| ❌ Failed/);
            assert.match(md, /Build travado/);
            assert.doesNotMatch(md, /Todos os checks ativos passaram/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

test('a failed new Pipeline attempt cannot reuse details from the earlier successful scan',
    { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-job-retry-'));
        try {
            const env = envFor(dir);
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            writeFragment(env, 'pipeline', 'OLD SUCCESSFUL FINDINGS\n');
            finalSummary({ ...env, REPO_BASELINE_OUTCOME: 'success', BASELINE_MODE: 'repo' }, 'first.md');
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            const current = { ...env, REPO_BASELINE_OUTCOME: 'warning', BASELINE_MODE: 'repo' };
            const md = finalSummary(current, 'last.md');
            assert.doesNotMatch(md, /OLD SUCCESSFUL FINDINGS/);
            assert.match(md, /Pipeline Scan \(Repo Baseline\) \| ⚠️ Warning/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

test('a later scan replaces its own Pipeline provider without retaining an obsolete status row',
    { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-job-provider-'));
        try {
            const env = envFor(dir);
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            writeFragment(env, 'pipeline', 'OLD REPO DETAILS\n');
            finalSummary({ ...env, REPO_BASELINE_OUTCOME: 'success', BASELINE_MODE: 'repo' }, 'first.md');
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            writeFragment(env, 'pipeline', 'CURRENT PORTAL DETAILS\n');
            const md = finalSummary({ ...env, BASELINE_OUTCOME: 'success', BASELINE_MODE: 'portal_afrika' }, 'last.md');
            assert.match(md, /Pipeline Scan \(Portal Afrika Baseline\) \| ✅ Success/);
            assert.match(md, /CURRENT PORTAL DETAILS/);
            assert.doesNotMatch(md, /Repo Baseline|OLD REPO DETAILS/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

test('a previous nonblocking policy rejection stays visible without claiming the job was blocked',
    { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-job-nonblocking-'));
        try {
            const env = envFor(dir);
            run(initialize, { ...env, ENABLE_PIPELINESCAN: 'true' });
            writeFragment(env, 'pipeline', 'Known policy findings\n');
            finalSummary({ ...env, REPO_BASELINE_OUTCOME: 'failure', BASELINE_MODE: 'repo' }, 'first.md');
            run(initialize, { ...env, ENABLE_SCA: 'true' });
            const md = finalSummary({ ...env, SCA_STATUS: 'success' }, 'last.md');
            assert.match(md, /Pipeline Scan \(Repo Baseline\) \| ❌ Failed/);
            assert.match(md, /esteira preservada/);
            assert.doesNotMatch(md, /Build travado|Todos os checks ativos passaram/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

for (const [mode, statusKey] of [['repo', 'REPO_BASELINE_OUTCOME'], ['portal_afrika', 'BASELINE_OUTCOME']]) {
    test(`${mode} rerun clears stale Pipeline details with enable_pipelinescan=false`, { skip: !bashAvailable }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-baseline-rerun-'));
        try {
            const env = { ...envFor(dir), BASELINE_MODE: mode };
            run(initialize, env);
            writeFragment(env, 'pipeline', 'STALE BASELINE FINDINGS\n');
            finalSummary({ ...env, [statusKey]: 'success' }, 'first.md');
            run(initialize, env);
            const md = finalSummary({ ...env, [statusKey]: 'warning' }, 'last.md');
            assert.doesNotMatch(md, /STALE BASELINE FINDINGS/);
            assert.match(md, /Warning/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}
