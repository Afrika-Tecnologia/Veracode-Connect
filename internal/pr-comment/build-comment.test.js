const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    countPipelineFindings,
    parseScaLog,
    parseIacResults,
    buildCommentBody,
    resolvePrNumber,
    isActiveStatus,
    resolveBanner
} = require('./build-comment');
const { MARKER } = require('./messages');

test('saved SCA/IaC fragments do not expand the consolidated PR beyond its compact sections', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pr-compact-'));
    try {
        const context = { RUNNER_TEMP: dir, GITHUB_REPOSITORY: 'example/repo', GITHUB_RUN_ID: '1',
            GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'security', GITHUB_WORKSPACE: dir };
        const fragmentDir = path.join(dir, 'veracode-connect-summary');
        fs.mkdirSync(fragmentDir);
        fs.writeFileSync(path.join(fragmentDir, 'job-state.json'), JSON.stringify({
            scope: JSON.stringify(['example/repo', '1', '1', 'security', dir]),
            inputs: { sca_status: 'success', iac_outcome: 'success' },
            fragments: { sca: 'VERBOSE SCA '.repeat(10000), iac: 'VERBOSE IAC '.repeat(10000) }
        }));
        fs.writeFileSync(path.join(dir, 'scaResults.txt'), 'High Risk Vulnerabilities 1\nTotal Libraries 1\n');
        const body = buildCommentBody({ workspace: dir, summaryContext: context, workflowRunUrl: 'https://github.com/example/repo/actions/runs/1',
            inputs: { sca_status: 'success', iac_outcome: 'success' } });
        assert.ok(body.length < 65536, 'PR should keep SCA/IaC sections compact');
        assert.doesNotMatch(body, /VERBOSE SCA|VERBOSE IAC/);
        assert.match(body, /High \| 1/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PR comment includes custom secret and configuration findings in IaC totals', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pr-iac-custom-'));
    try {
        fs.mkdirSync(path.join(dir, 'iac-results'));
        fs.writeFileSync(path.join(dir, 'iac-results', 'results.json'), JSON.stringify({
            vulnerabilities: { matches: [] },
            secrets: [{ Severity: 'HIGH', RuleID: 'custom-secret', Title: 'Secret finding', Target: 'config.yml' }],
            configs: [{ Severity: 'MEDIUM', ID: 'CONFIG-001', Title: 'Configuration issue', Target: 'infra/main.tf' }]
        }));
        const body = buildCommentBody({ workspace: dir, workflowRunUrl: 'https://github.com/example/repo/actions/runs/1',
            inputs: { iac_outcome: 'failure', iac_policy_status: 'failed', iac_policy_name: 'Team policy', fail_build: 'true' } });
        assert.match(body, /High \| 1/);
        assert.match(body, /Medium \| 1/);
        assert.match(body, /Total Findings\*\* \| \*\*2\*\*/);
        assert.match(body, /Não passou/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('resolvePrNumber extrai número do evento pull_request', () => {
    assert.equal(resolvePrNumber({ pull_request: { number: 99 } }), 99);
    assert.equal(resolvePrNumber({ push: {} }), null);
});

test('technical failure banner does not claim the caller disabled fail_build', () => {
    const banner = resolveBanner({
        fail_build: 'false',
        validate_outcome: 'failure'
    });
    assert.match(banner, /esteira preservada/i);
    assert.doesNotMatch(banner, /fail_build=false/);
});

test('a nonblocking policy warning is not presented as all checks passed', () => {
    const banner = resolveBanner({ fail_build: 'false', pipeline_outcome: 'warning' });
    assert.match(banner, /esteira preservada/i);
});

test('IaC policy failure cannot produce a green summary even if scan outcome is success', () => {
    const banner = resolveBanner({
        fail_build: 'false',
        iac_outcome: 'success',
        iac_policy_status: 'failed'
    });
    assert.match(banner, /esteira preservada/i);
    assert.doesNotMatch(banner, /Todos os checks ativos passaram/i);
});

test('countPipelineFindings agrega severidades', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pr-'));
    const file = path.join(dir, 'results.json');
    fs.writeFileSync(file, JSON.stringify({
        findings: [
            { severity: 5 },
            { severity: 4 },
            { severity: 3 },
            { severity: 2 },
            { severity: 1 }
        ]
    }));
    const counts = countPipelineFindings(file);
    assert.equal(counts.veryHigh, 1);
    assert.equal(counts.high, 1);
    assert.equal(counts.medium, 1);
    assert.equal(counts.low, 1);
    assert.equal(counts.veryLow, 1);
    assert.equal(counts.total, 5);
});

test('parseScaLog lê contagens do log', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-'));
    fs.writeFileSync(path.join(dir, 'scaResults.txt'), [
        'Critical Risk Vulnerabilities 2',
        'High Risk Vulnerabilities 3',
        'Medium Risk Vulnerabilities 1',
        'Low Risk Vulnerabilities 4',
        'Vulnerable Libraries 5',
        'Total Libraries 20',
        'Direct Libraries 8'
    ].join('\n'));
    const counts = parseScaLog(dir);
    assert.equal(counts.veryHigh, 2);
    assert.equal(counts.high, 3);
    assert.equal(counts.total, 10);
    assert.equal(counts.vulnLibs, 5);
    assert.equal(counts.libTotal, 20);
    assert.equal(counts.directLibs, 8);
    assert.equal(counts.transitiveLibs, 12);
});

test('parseIacResults extrai matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-'));
    fs.mkdirSync(path.join(dir, 'iac-results'));
    fs.writeFileSync(path.join(dir, 'iac-results', 'results.json'), JSON.stringify({
        vulnerabilities: {
            matches: [
                { vulnerability: { severity: 'Critical' } },
                { vulnerability: { severity: 'High' } },
                { vulnerability: { severity: 'Low' } },
                { vulnerability: { severity: 'Negligible' } }
            ]
        }
    }));
    const counts = parseIacResults(dir);
    assert.equal(counts.veryHigh, 1);
    assert.equal(counts.high, 1);
    assert.equal(counts.low, 1);
    assert.equal(counts.veryLow, 1);
    assert.equal(counts.total, 4);
});

test('comentário do PR conta severidades UPPERCASE do results.json de IaC', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-uppercase-'));
    fs.mkdirSync(path.join(dir, 'iac-results'));
    fs.writeFileSync(path.join(dir, 'iac-results', 'results.json'), JSON.stringify({
        vulnerabilities: {
            matches: [
                { vulnerability: { severity: 'CRITICAL' } },
                { vulnerability: { severity: 'HIGH' } },
                { vulnerability: { severity: 'MEDIUM' } },
                { vulnerability: { severity: 'LOW' } }
            ]
        }
    }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: { iac_outcome: 'success' }
    });

    assert.match(body, /Very High \| 1 \|/);
    assert.match(body, /High \| 1 \|/);
    assert.match(body, /Medium \| 1 \|/);
    assert.match(body, /Low \| 1 \|/);
    assert.match(body, /Total Findings\*\* \| \*\*4\*\*/);
});

test('comentário do PR identifica a política IaC reprovada pelo nome', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-comment-'));
    fs.mkdirSync(path.join(dir, 'iac-results'));
    fs.writeFileSync(path.join(dir, 'iac-results', 'results.json'), JSON.stringify({ findings: [] }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            iac_outcome: 'failure',
            iac_policy_status: 'failed',
            iac_policy_name: 'Team IaC'
        }
    });

    assert.match(body, /Política IaC \(Team IaC\):/);
    assert.match(body, /Não passou/);
    assert.match(body, /Veracode IaC\/Secrets \| ❌ Failed/);
});

test('resumo do PR mantém política IaC reprovada vermelha se o scan terminou tecnicamente com sucesso', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-comment-success-'));
    fs.mkdirSync(path.join(dir, 'iac-results'));
    fs.writeFileSync(path.join(dir, 'iac-results', 'results.json'), JSON.stringify({ findings: [] }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            iac_outcome: 'success',
            iac_policy_status: 'failed',
            iac_policy_name: 'Team IaC',
            fail_build: 'false'
        }
    });

    assert.match(body, /esteira preservada/i);
    assert.match(body, /Política IaC — Team IaC \| ❌ Failed/);
    assert.doesNotMatch(body, /Todos os checks ativos passaram/i);
});

test('buildCommentBody inclui marker e seções ativas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-body-'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
        findings: [{ severity: 4 }]
    }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            sca_status: 'skipped',
            iac_outcome: 'skipped',
            pipeline_outcome: 'success',
            baseline_outcome: 'skipped',
            repo_baseline_outcome: 'skipped',
            upload_outcome: 'skipped',
            validate_outcome: 'success',
            baseline_mode: 'none'
        }
    });

    assert.match(body, new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(body, /### 🔬 Veracode Pipeline Scan/);
    assert.match(body, /\| 🟠 High \| 1 \|/);
    assert.match(body, /## 🛡️ Veracode Connect — Resumo Final/);
    assert.match(body, /\[Mais detalhes no Step Summary\]/);
    assert.doesNotMatch(body, /### 🔍 Veracode SCA/);
    assert.doesNotMatch(body, /Artefatos analisados/);
});

test('buildCommentBody com baseline destaca tabela de novas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-base-'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
        findings: [{ severity: 4 }, { severity: 4 }, { severity: 3 }]
    }));
    fs.writeFileSync(path.join(dir, 'filtered_results.json'), JSON.stringify({
        findings: [{ severity: 4 }]
    }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            sca_status: 'skipped',
            iac_outcome: 'skipped',
            pipeline_outcome: 'skipped',
            baseline_outcome: 'success',
            repo_baseline_outcome: 'skipped',
            upload_outcome: 'skipped',
            validate_outcome: 'success',
            baseline_mode: 'repo'
        }
    });

    assert.match(body, /### 🔬 Veracode Pipeline Scan \(Repo Baseline\)/);
    assert.match(body, /#### SAST - Vulnerabilidades Bloqueantes de Esteira/);
    assert.match(body, /#### SAST - Todas Vulnerabilidades/);
    assert.match(body, /\| 🟠 High \| 1 \|/);
    assert.match(body, /\| 🟠 High \| 2 \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*1\*\* \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*3\*\* \|/);
});

test('buildCommentBody com baseline.json respeita filtered_results vazio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-base-split-'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
        findings: [
            {
                severity: 5,
                flaw_match: { flaw_hash: 'old', procedure_hash: 'a', prototype_hash: 'b', flaw_hash_ordinal: 1 }
            },
            {
                severity: 4,
                flaw_match: { flaw_hash: 'new', procedure_hash: 'c', prototype_hash: 'd', flaw_hash_ordinal: 1 }
            }
        ]
    }));
    fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({
        findings: [
            {
                severity: 5,
                flaw_match: { flaw_hash: 'old', procedure_hash: 'a', prototype_hash: 'b', flaw_hash_ordinal: 1 }
            }
        ]
    }));
    fs.writeFileSync(path.join(dir, 'filtered_results.json'), JSON.stringify({ findings: [] }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            sca_status: 'skipped',
            iac_outcome: 'skipped',
            pipeline_outcome: 'skipped',
            baseline_outcome: 'success',
            repo_baseline_outcome: 'skipped',
            upload_outcome: 'skipped',
            validate_outcome: 'success',
            baseline_mode: 'portal_afrika'
        }
    });

    assert.match(body, /### 🔬 Veracode Pipeline Scan \(Portal Afrika Baseline\)/);
    assert.match(body, /#### SAST - Vulnerabilidades Bloqueantes de Esteira/);
    const [blocking] = body.split('#### SAST - Todas Vulnerabilidades');
    assert.match(blocking, /\| \*\*Total\*\* \| \*\*0\*\* \|/);
    assert.doesNotMatch(blocking, /Detalhamento de Vulnerabilidades Bloqueantes/);
    assert.match(body, /\| 🟠 High \| 1 \|/);
    assert.match(body, /\| 🔴 Very High \| 1 \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*2\*\* \|/);
});

test('isActiveStatus ignora skipped', () => {
    assert.equal(isActiveStatus('skipped'), false);
    assert.equal(isActiveStatus('success'), true);
});

test('PR shows only the configured Veracode access link immediately below the final-summary title', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-link-'));
    fs.writeFileSync(path.join(dir, 'scaResults.txt'), [
        'Critical Risk Vulnerabilities 2',
        'High Risk Vulnerabilities 3',
        'Medium Risk Vulnerabilities 1',
        'Low Risk Vulnerabilities 4'
    ].join('\n'));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            sca_status: 'success',
            sca_scan_url: 'https://example.veracode.com/scan/1',
            veracode_url: 'https://analysiscenter.veracode.eu/custom/login?team=example',
            upload_platform_url: 'https://analysiscenter.veracode.com/old-upload',
            iac_outcome: 'skipped',
            pipeline_outcome: 'skipped',
            baseline_outcome: 'skipped',
            repo_baseline_outcome: 'skipped',
            upload_outcome: 'success',
            validate_outcome: 'success',
            baseline_mode: 'none',
            fail_build: 'true'
        }
    });

    const scaIdx = body.indexOf('### 🔍 Veracode SCA');
    const resumoIdx = body.indexOf('## 🛡️ Veracode Connect — Resumo Final');
    assert.ok(scaIdx >= 0 && resumoIdx > scaIdx);
    assert.match(body, /## 🛡️ Veracode Connect — Resumo Final\n\nLink de acesso para Veracode: \[Acesse Aqui\]\(https:\/\/analysiscenter\.veracode\.eu\/custom\/login\?team=example\)\n/);
    assert.doesNotMatch(body, /example\.veracode\.com\/scan\/1|old-upload|Relatório completo no Veracode|\| Plataforma \|/);
    assert.equal((body.match(/Link de acesso para Veracode:/g) || []).length, 1);
    assert.match(body, /Mais detalhes no Step Summary/);
    assert.match(body, /\| 🔴 Very High \| 2 \|/);
    assert.doesNotMatch(body, /Status interno/);
    assert.doesNotMatch(body, /Issues GitHub: desabilitado/);
});

test('PR uses the platform login when veracode_url is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-login-default-'));
    try {
        const body = buildCommentBody({ workspace: dir, workflowRunUrl: 'https://github.com/example/repo/actions/runs/1', inputs: {} });
        assert.match(body, /Link de acesso para Veracode: \[Acesse Aqui\]\(https:\/\/analysiscenter\.veracode\.com\/\)/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PR access URL cannot inject Markdown or an executable link scheme', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-login-escape-'));
    try {
        for (const value of ['javascript:alert(1)', 'https://example.veracode.com/\n\n# injected']) {
            const body = buildCommentBody({ workspace: dir, inputs: { veracode_url: value } });
            assert.doesNotMatch(body, /javascript:|# injected/);
            assert.match(body, /\[Acesse Aqui\]\(https:\/\/analysiscenter\.veracode\.com\/\)/);
        }
        const body = buildCommentBody({ workspace: dir, inputs: { veracode_url: 'https://example.veracode.com/login(a)?next=b' } });
        assert.match(body, /\[Acesse Aqui\]\(https:\/\/example\.veracode\.com\/login%28a%29\?next=b\)/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('buildCommentBody não lista artefatos do manifesto de scans', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-arts-'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
        findings: [{ severity: 4 }]
    }));
    fs.mkdirSync(path.join(dir, '.veracode-connect', 'scans'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.veracode-connect', 'scans', 'manifest.json'), JSON.stringify({
        scans: [
            {
                slot: 1,
                artifact: 'veracode-auto-pack-app-java.zip',
                scan_id: 'abc',
                findings: 1,
                classification: 'policy'
            }
        ]
    }));

    const body = buildCommentBody({
        workspace: dir,
        workflowRunUrl: 'https://github.com/example-org/exemplo-app/actions/runs/1',
        inputs: {
            sca_status: 'skipped',
            iac_outcome: 'skipped',
            pipeline_outcome: 'success',
            baseline_outcome: 'skipped',
            repo_baseline_outcome: 'skipped',
            upload_outcome: 'skipped',
            validate_outcome: 'success',
            baseline_mode: 'none'
        }
    });

    assert.doesNotMatch(body, /Artefatos analisados/);
    assert.doesNotMatch(body, /veracode-auto-pack-app-java\.zip/);
    assert.match(body, /\| 🟠 High \| 1 \|/);
});
