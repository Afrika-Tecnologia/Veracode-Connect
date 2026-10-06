'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const bashAvailable = cp.spawnSync(bash, ['--version']).status === 0;

// Extract the actual run blocks so the test executes the shipped composite scripts.
function stepScript(file, stepKey) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const start = lines.findIndex(line => line.trim() === stepKey);
    assert.notEqual(start, -1, `Missing step: ${stepKey}`);
    let run = start;
    while (run < lines.length && lines[run].trim() !== 'run: |') run++;
    assert.ok(run < lines.length, `Missing run block: ${stepKey}`);
    const indent = lines[run].search(/\S/) + 2;
    const script = [];
    for (const line of lines.slice(run + 1)) {
        if (line.trim() && line.search(/\S/) < indent) break;
        script.push(line.slice(indent));
    }
    return script.join('\n');
}

const summaryScript = stepScript(path.join(__dirname, 'action.yml'), 'id: final_summary');
const blockScript = stepScript(path.join(root, 'action.yml'), '- name: Bloquear esteira pelo resultado final dos scans');

function decisionEnv(context) {
    const source = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
    const block = source.split('      id: policy_decision')[1].split('\n    - name:')[0];
    const envBlock = block.split('      env:')[1].split('\n      run:')[0];
    const env = {};
    for (const line of envBlock.trimEnd().split(/\r?\n/)) {
        const pair = line.match(/^        (\w+): (.+)$/);
        if (!pair) continue;
        env[pair[1]] = pair[2].replace(/\$\{\{(.*?)\}\}/g, (_, expression) => {
            // These shipped expressions only use string context values, ==, && and ||.
            const resolved = expression.replace(/\b(?:inputs|steps|github)\.[\w.]+/g,
                key => JSON.stringify(context[key] ?? ''));
            return String(Function(`"use strict"; return (${resolved});`)());
        });
    }
    return env;
}

const scenarios = [
    { name: 'IaC rejected, Pipeline disabled', iac: 'failed', pipeline: false, violations: '0', policyFail: 'true', blocked: 'true', pipelineStatus: 'skipped', banner: /Build travado por policy/ },
    { name: 'SCA failed with policy blocking enabled', sca: 'failure', iac: 'not_used', pipeline: false, violations: '0', policyFail: 'true', blocked: 'true', pipelineStatus: 'skipped', banner: /Build travado por falha do SCA/ },
    { name: 'all three scans rejected', sca: 'failure', iac: 'failed', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por falha do SCA/ },
    { name: 'IaC rejected despite input validation failure', validation: 'failure', iac: 'failed', pipeline: false, violations: '0', policyFail: 'true', blocked: 'true', pipelineStatus: 'skipped', banner: /Build travado por policy/ },
    { name: 'SCA warning with policy blocking disabled', sca: 'warning', iac: 'not_used', pipeline: false, violations: '0', policyFail: 'false', blocked: 'false', pipelineStatus: 'skipped', banner: /esteira preservada/ },
    { name: 'SCA cannot execute with blocking enabled', unavailableSca: true, iac: 'error', pipeline: false, violations: '0', policyFail: 'true', blocked: 'false', pipelineStatus: 'skipped', banner: /esteira preservada/ },
    { name: 'SCA failure with fail_build disabled', sca: 'failure', failBuild: 'false', iac: 'not_used', pipeline: false, violations: '0', policyFail: 'true', blocked: 'false', pipelineStatus: 'skipped', banner: /esteira preservada/ },
    { name: 'IaC rejected, Pipeline passed', iac: 'failed', pipeline: true, violations: '0', policyFail: 'true', blocked: 'true', pipelineStatus: 'success', banner: /Build travado por policy/ },
    { name: 'Pipeline policy/baseline rejected', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por policy/ },
    { name: 'Repo Baseline rejected', mode: 'repo', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por policy/ },
    { name: 'Portal Baseline rejected', mode: 'portal_afrika', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por policy/ },
    { name: 'Repo Baseline findings survive provider failure', mode: 'repo', errors: '1', planned: '2', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por policy/ },
    { name: 'Portal Baseline findings survive provider failure', mode: 'portal_afrika', errors: '1', planned: '2', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por policy/ },
    { name: 'confirmed Pipeline violation and another scan error', errors: '1', planned: '2', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'true', blocked: 'true', pipelineStatus: 'failure', banner: /Build travado por policy/ },
    { name: 'Pipeline technical error without policy violations', errors: '1', planned: '2', iac: 'not_used', pipeline: true, violations: '0', policyFail: 'true', blocked: 'false', pipelineStatus: 'warning', banner: /esteira preservada/ },
    { name: 'IaC rejection with blocking disabled', iac: 'failed', pipeline: false, violations: '0', policyFail: 'false', blocked: 'false', pipelineStatus: 'skipped', banner: /esteira preservada/ },
    { name: 'Pipeline findings with blocking disabled', iac: 'not_used', pipeline: true, violations: '1', policyFail: 'false', blocked: 'false', pipelineStatus: 'failure', banner: /esteira preservada/ },
    { name: 'IaC policy evaluation unavailable', iac: 'error', pipeline: false, violations: '0', policyFail: 'true', blocked: 'false', pipelineStatus: 'skipped', banner: /esteira preservada/ },
    { name: 'all policies passed', iac: 'passed', pipeline: true, violations: '0', policyFail: 'true', blocked: 'false', pipelineStatus: 'success', banner: /Todos os checks ativos passaram/ }
];

for (const scenario of scenarios) {
    test(`final policy flow: ${scenario.name}`, { skip: !bashAvailable && 'Bash is required for composite-action scripts' }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-policy-flow-'));
        try {
            let scaStatus = scenario.sca || 'success';
            if (scenario.unavailableSca) {
                const scaPath = path.join(root, 'internal/veracode-sca');
                const output = path.join(dir, 'sca-output');
                const run = cp.spawnSync(bash, ['-c', stepScript(path.join(scaPath, 'action.yml'), 'id: run_sca')], {
                    cwd: dir, env: { ...process.env, GITHUB_ACTION_PATH: scaPath.replace(/\\/g, '/'),
                        GITHUB_OUTPUT: output.replace(/\\/g, '/'), SCA_OUTCOME: 'failure', POLICY_FAIL: 'true' }, encoding: 'utf8'
                });
                assert.equal(run.status, 0, run.stderr);
                scaStatus = fs.readFileSync(output, 'utf8').trim().split('=')[1];
                assert.equal(scaStatus, 'warning');
                const summary = cp.spawnSync(process.execPath, [path.join(scaPath, 'summary-findings.js'),
                    'summary-md', path.join(dir, 'scaResults.json'), path.join(dir, 'scaResults.txt')], { cwd: dir, encoding: 'utf8' });
                assert.equal(summary.status, 0, summary.stderr);
                const fragments = path.join(dir, 'veracode-connect-summary');
                fs.mkdirSync(fragments);
                fs.writeFileSync(path.join(fragments, 'sca.md'), summary.stdout);
            }
            const marker = path.join(dir, 'started');
            const result = path.join(dir, 'results.json');
            const output = path.join(dir, 'output');
            const summary = path.join(dir, 'summary.md');
            fs.writeFileSync(marker, '');
            if (scenario.pipeline) fs.writeFileSync(result, '{"findings":[]}');
            const provider = scenario.mode === 'repo' ? 'repo_baseline_flow'
                : scenario.mode === 'portal_afrika' ? 'baseline_flow' : 'pipeline_only';
            const context = {
                'inputs.fail_build': scenario.failBuild || 'true', 'inputs.policy_fail': scenario.policyFail,
                'steps.veracode_sca.outputs.sca_status': scaStatus,
                'steps.veracode_iac.outputs.iac_policy_status': scenario.iac,
                'steps.validate.outputs.baseline_mode': scenario.mode || 'none',
                'steps.error_log_init.outputs.start_marker': marker, 'github.workspace': dir,
                'steps.baseline_flow.outcome': 'skipped', 'steps.repo_baseline_flow.outcome': 'skipped',
                'steps.pipeline_only.outcome': 'skipped',
                [`steps.${provider}.outcome`]: scenario.errors ? 'failure' : scenario.pipeline ? 'success' : 'skipped',
                [`steps.${provider}.outputs.planned_count`]: scenario.planned || (scenario.pipeline ? '1' : '0'),
                [`steps.${provider}.outputs.scanned_count`]: scenario.pipeline ? '1' : '0',
                [`steps.${provider}.outputs.scan_error_count`]: scenario.errors || '0',
                [`steps.${provider}.outputs.policy_violations`]: scenario.violations
            };
            const env = { ...process.env, ...decisionEnv(context), GITHUB_OUTPUT: output };
            const decision = cp.spawnSync(process.execPath, [path.join(__dirname, 'policy-decision.js')], { env, encoding: 'utf8' });
            assert.equal(decision.status, 0, decision.stderr); // Scan results do not fail before the summary.
            const outputs = Object.fromEntries(fs.readFileSync(output, 'utf8').trimEnd().split('\n').map(line => line.split('=')));
            assert.equal(outputs.blocked, scenario.blocked);
            const pipelineStatus = outputs.scan_status || (scenario.pipeline ? 'success' : 'skipped');
            assert.equal(pipelineStatus, scenario.pipelineStatus);

            const summaryEnv = {
                ...env, FAIL_BUILD: outputs.blocked, GITHUB_ACTION_PATH: __dirname.replace(/\\/g, '/'),
                RUNNER_TEMP: dir.replace(/\\/g, '/'), GITHUB_STEP_SUMMARY: summary.replace(/\\/g, '/'),
                VALIDATE_OUTCOME: scenario.validation || 'success', SCA_STATUS: scaStatus, UPLOAD_OUTCOME: 'success',
                IAC_OUTCOME: scenario.iac === 'error' ? 'warning' : scenario.iac === 'failed' ? 'failure' : 'success',
                IAC_POLICY_NAME: 'Container IaC Policy - N2',
                BASELINE_OUTCOME: scenario.mode === 'portal_afrika' ? pipelineStatus : 'skipped',
                REPO_BASELINE_OUTCOME: scenario.mode === 'repo' ? pipelineStatus : 'skipped',
                PIPELINE_OUTCOME: scenario.mode ? 'skipped' : pipelineStatus, SCA_SCAN_URL: ''
            };
            const summaryRun = cp.spawnSync(bash, ['-c', summaryScript], { env: summaryEnv, encoding: 'utf8' });
            assert.equal(summaryRun.status, 0, summaryRun.stderr);
            assert.equal(fs.existsSync(summary), true, 'Every result must reach Resumo Final');
            const text = fs.readFileSync(summary, 'utf8');
            assert.match(text, /Resumo Final/);
            assert.match(text, scenario.banner);
            if (scaStatus === 'failure') assert.match(text, /\| Veracode SCA \| ❌ Failed \|/);
            else if (scaStatus === 'warning') assert.match(text, /\| Veracode SCA \| ⚠️ Warning \|/);
            else assert.match(text, /\| Veracode SCA \| ✅ Success \|/);
            assert.match(text, /\| Upload & Scan \| ✅ Success \|/);
            if (scenario.iac === 'failed') assert.match(text, /\| Política IaC \| ❌ Failed \|/);
            if (scenario.unavailableSca) {
                assert.match(text, /⚠️ Nenhum artefato de resultado SCA encontrado\./);
                assert.match(text, /\| Veracode IaC\/Secrets \| ⚠️ Warning \|/);
                assert.doesNotMatch(text, /❌ Failed|Build travado/);
            }
            if (scenario.pipelineStatus === 'success') assert.match(text, /\| Pipeline Scan \| ✅ Success \|/);
            if (scenario.pipelineStatus === 'failure' && !scenario.mode) assert.match(text, /\| Pipeline Scan \| ❌ Failed \|/);
            if (scenario.validation === 'failure') assert.match(text, /\| Validação de Inputs \| ❌ Failed \|/);
            if (scenario.pipelineStatus === 'skipped') assert.doesNotMatch(text, /\| Pipeline Scan \|/);
            if (scenario.mode === 'repo') assert.match(text, /\| Pipeline Scan \(Repo Baseline\) \| ❌ Failed \|/);
            if (scenario.mode === 'portal_afrika') assert.match(text, /\| Pipeline Scan \(Portal Afrika Baseline\) \| ❌ Failed \|/);

            // The orchestrator runs this final step only when blocked=true.
            if (outputs.blocked === 'true') {
                const block = cp.spawnSync(bash, ['-c', blockScript], { env: summaryEnv, encoding: 'utf8' });
                assert.equal(block.status, 1);
                assert.match(block.stdout, /::error::/);
                assert.equal(fs.readFileSync(summary, 'utf8'), text);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
