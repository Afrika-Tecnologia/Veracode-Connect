'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    normalizeSeverity,
    countFromMatches,
    buildSummary
} = require('./summary-findings.js');

test('normalizeSeverity aceita UPPERCASE e Title Case', () => {
    assert.equal(normalizeSeverity('CRITICAL'), 'critical');
    assert.equal(normalizeSeverity('High'), 'high');
    assert.equal(normalizeSeverity('medium'), 'medium');
    assert.equal(normalizeSeverity('Negligible'), 'very_low');
    assert.equal(normalizeSeverity('nope'), null);
});

test('countFromMatches conta severidades case-insensitive', () => {
    const matches = [
        { vulnerability: { severity: 'CRITICAL', id: 'GHSA-1', description: 'a' }, artifact: { name: 'a', version: '1' } },
        { vulnerability: { severity: 'HIGH', id: 'GHSA-2', description: 'b' }, artifact: { name: 'b', version: '2' } },
        { vulnerability: { severity: 'MEDIUM', id: 'GHSA-3', description: 'c' }, artifact: { name: 'c', version: '3' } },
        { vulnerability: { severity: 'LOW', id: 'GHSA-4', description: 'd' }, artifact: { name: 'd', version: '4' } },
        { vulnerability: { severity: 'Critical', id: 'GHSA-5', description: 'e' }, artifact: { name: 'e', version: '5' } }
    ];
    const { counts, rows } = countFromMatches(matches);
    assert.equal(counts.critical, 2);
    assert.equal(counts.high, 1);
    assert.equal(counts.medium, 1);
    assert.equal(counts.low, 1);
    assert.equal(counts.total, 5);
    assert.equal(rows[0].band, 'critical');
});

test('buildSummary lê vulnerabilities.matches com severity UPPERCASE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-sum-'));
    const jsonPath = path.join(dir, 'results.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
        vulnerabilities: {
            matches: [
                {
                    vulnerability: {
                        severity: 'HIGH',
                        id: 'GHSA-qwcr-r2fm-qrc7',
                        description: 'body-parser DoS',
                        fix: { versions: ['1.20.3'] }
                    },
                    relatedVulnerabilities: [{ id: 'CVE-2024-45590' }],
                    artifact: { name: 'body-parser', version: '1.18.3' },
                    matchDetails: [{ fix: { suggestedVersion: '1.20.3' } }]
                },
                {
                    vulnerability: {
                        severity: 'CRITICAL',
                        id: 'GHSA-x',
                        description: 'proto pollution'
                    },
                    artifact: { name: 'minimist', version: '1.2.0' }
                }
            ]
        }
    }));
    const md = buildSummary({ jsonPath });
    assert.match(md, /\| Grupo \| 🔴 Very High \| 🟠 High \| 🟡 Medium \| 🔵 Low \| ⚪ Very Low \| Total \|/);
    assert.match(md, /\| 🔎 Vulnerabilidades \| 1 \| 1 \| 0 \| 0 \| 0 \| \*\*2\*\* \|/);
    assert.doesNotMatch(md, /Afetam a política/);
    assert.match(md, /CVE-2024-45590/);
    assert.match(md, /body-parser@1\.18\.3/);
});

test('buildSummary mostra só o nome da política, sem veredito', () => {
    const md = buildSummary({
        jsonPath: path.join(os.tmpdir(), 'vc-iac-results-ausente.json'),
        policyStatus: 'failed',
        policyName: 'Time IaC'
    });
    assert.match(md, /\*\*Política IaC:\*\* Time IaC/);
    assert.doesNotMatch(md, /Não passou/);
    assert.match(md, /Nenhum arquivo de resultado encontrado/);
});

test('buildSummary não apresenta política como aprovada se a avaliação falha', () => {
    const md = buildSummary({
        jsonPath: path.join(os.tmpdir(), 'vc-iac-results-ausente.json'),
        policyStatus: 'error',
        policyName: 'Time IaC'
    });
    assert.match(md, /\*\*Política IaC:\*\* Time IaC/);
    assert.doesNotMatch(md, /Passou|Não avaliada/);
});

test('summary includes dependency, custom secret and configuration findings without exposing matched values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-all-findings-'));
    const jsonPath = path.join(dir, 'results.json');
    try {
        fs.writeFileSync(jsonPath, JSON.stringify({
            vulnerabilities: { matches: [{ vulnerability: { severity: 'HIGH', id: 'GHSA-example' }, artifact: { name: 'dependency', version: '1' } }] },
            secrets: [
                { Severity: 'HIGH', RuleID: 'custom-sensitive-property', Title: 'Sensitive literal', Target: 'src/config.js', StartLine: 12, Code: 'private-match-value', Match: 'private-match-value' },
                { Severity: 'MEDIUM', RuleID: 'custom-username', Title: 'Credential identifier', Target: 'config.yml', StartLine: 3 }
            ],
            configs: [{ Severity: 'LOW', ID: 'CONFIG-001', Title: 'Configuration issue', Target: 'infra/main.tf', StartLine: 8 }]
        }));
        const md = buildSummary({ jsonPath, policyStatus: 'failed', policyName: 'Team policy' });
        assert.match(md, /\| 🔎 Vulnerabilidades \| 0 \| 2 \| 1 \| 1 \| 0 \| \*\*4\*\* \|/);
        assert.match(md, /\| ❌ Afetam a política \| 0 \| 0 \| 0 \| 0 \| 0 \| \*\*0\*\* \|/);
        assert.match(md, /custom-sensitive-property/);
        assert.match(md, /src\/config\.js:12/);
        assert.match(md, /CONFIG-001/);
        assert.doesNotMatch(md, /private-match-value/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('summary counts custom findings when there are no dependency findings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-secrets-only-'));
    try {
        const jsonPath = path.join(dir, 'results.json');
        fs.writeFileSync(jsonPath, JSON.stringify({ secrets: [{ Severity: 'CRITICAL', RuleID: 'custom-secret', Title: 'Secret finding', Target: 'config.yml' }], configs: [] }));
        const md = buildSummary({ jsonPath });
        assert.match(md, /\| 🔎 Vulnerabilidades \| 1 \| 0 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('custom finding metadata cannot create extra markdown table rows or columns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-metadata-'));
    try {
        const jsonPath = path.join(dir, 'results.json');
        fs.writeFileSync(jsonPath, JSON.stringify({ secrets: [{ Severity: 'HIGH',
            RuleID: 'custom|rule', Title: 'Finding | title\ncontinued', Target: 'src/config|extra\nrow.js', StartLine: 2 }] }));
        const md = buildSummary({ jsonPath });
        assert.ok(md.includes('custom\\|rule'));
        assert.ok(md.includes('Finding \\| title continued'));
        assert.ok(md.includes('src/config\\|extra row.js:2'));
        assert.doesNotMatch(md, /\nrow\.js/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('com política ativa conta os findings reprovados pela política, sem nota de baseline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-policy-row-'));
    try {
        const jsonPath = path.join(dir, 'results.json');
        fs.writeFileSync(jsonPath, JSON.stringify({ configs: [
            { Severity: 'HIGH', ID: 'A', Title: 'a', Target: 'a.tf', customerPolicyResult: { Status: 'failed' } },
            { Severity: 'LOW', ID: 'B', Title: 'b', Target: 'b.tf', customerPolicyResult: { Status: 'passed' } }
        ] }));
        const md = buildSummary({ jsonPath, policyStatus: 'deferred', policyName: 'N2', baselineStatus: 'seeded' });
        assert.match(md, /### 🛡️ Veracode IaC \/ Secrets \(Repo Baseline\)/);
        assert.match(md, /\| 🔎 Vulnerabilidades \| 0 \| 1 \| 0 \| 1 \| 0 \| \*\*2\*\* \|/);
        assert.match(md, /\| ❌ Afetam a política \| 0 \| 1 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
        assert.doesNotMatch(md, /Sem baseline IaC|baseline gravado/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
