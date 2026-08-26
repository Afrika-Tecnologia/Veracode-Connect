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
    isActiveStatus
} = require('./build-comment');
const { MARKER } = require('./messages');

test('resolvePrNumber extrai número do evento pull_request', () => {
    assert.equal(resolvePrNumber({ pull_request: { number: 99 } }), 99);
    assert.equal(resolvePrNumber({ push: {} }), null);
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
    assert.equal(counts.low, 2);
    assert.equal(counts.total, 5);
});

test('parseScaLog lê contagens do log', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-'));
    fs.writeFileSync(path.join(dir, 'scaResults.txt'), [
        'Critical Risk Vulnerabilities 2',
        'High Risk Vulnerabilities 3',
        'Medium Risk Vulnerabilities 1',
        'Low Risk Vulnerabilities 4',
        'Vulnerable Libraries 5'
    ].join('\n'));
    const counts = parseScaLog(dir);
    assert.equal(counts.critical, 2);
    assert.equal(counts.high, 3);
    assert.equal(counts.total, 10);
    assert.equal(counts.vulnLibs, 5);
});

test('parseIacResults extrai matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-'));
    fs.mkdirSync(path.join(dir, 'iac-results'));
    fs.writeFileSync(path.join(dir, 'iac-results', 'results.json'), JSON.stringify({
        vulnerabilities: {
            matches: [
                { vulnerability: { severity: 'Critical' } },
                { vulnerability: { severity: 'High' } },
                { vulnerability: { severity: 'Low' } }
            ]
        }
    }));
    const counts = parseIacResults(dir);
    assert.equal(counts.critical, 1);
    assert.equal(counts.high, 1);
    assert.equal(counts.low, 1);
    assert.equal(counts.total, 3);
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
    assert.match(body, /### SAST \(Pipeline Scan\)/);
    assert.match(body, /\| High \| 1 \|/);
    assert.match(body, /\[Mais detalhes\]/);
    assert.doesNotMatch(body, /### SCA/);
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

    assert.match(body, /#### Novas \(pós-baseline\)/);
    assert.match(body, /#### Todas \(este scan\)/);
    assert.match(body, /\| High \| 1 \|/);
    assert.match(body, /\| High \| 2 \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*1\*\* \|/);
    assert.match(body, /\| \*\*Total\*\* \| \*\*3\*\* \|/);
});

test('isActiveStatus ignora skipped', () => {
    assert.equal(isActiveStatus('skipped'), false);
    assert.equal(isActiveStatus('success'), true);
});
