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

test('buildCommentBody com baseline.json ignora filtered_results vazio', () => {
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
    assert.match(body, /\| 🟠 High \| 1 \|/);
    assert.match(body, /\| 🔴 Very High \| 1 \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*1\*\* \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*2\*\* \|/);
});

test('isActiveStatus ignora skipped', () => {
    assert.equal(isActiveStatus('skipped'), false);
    assert.equal(isActiveStatus('success'), true);
});

test('buildCommentBody coloca o relatório SCA no Resumo Final', () => {
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
            iac_outcome: 'skipped',
            pipeline_outcome: 'skipped',
            baseline_outcome: 'skipped',
            repo_baseline_outcome: 'skipped',
            upload_outcome: 'skipped',
            validate_outcome: 'success',
            baseline_mode: 'none',
            fail_build: 'true'
        }
    });

    const scaIdx = body.indexOf('### 🔍 Veracode SCA');
    const resumoIdx = body.indexOf('## 🛡️ Veracode Connect — Resumo Final');
    const linkIdx = body.indexOf('Relatório completo no Veracode');
    assert.ok(scaIdx >= 0 && resumoIdx > scaIdx);
    assert.ok(linkIdx > resumoIdx);
    assert.match(body, /\| 🔴 Very High \| 2 \|/);
    assert.doesNotMatch(body, /Status interno/);
    assert.doesNotMatch(body, /Issues GitHub: desabilitado/);
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
