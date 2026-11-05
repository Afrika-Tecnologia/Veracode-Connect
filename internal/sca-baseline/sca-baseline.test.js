'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    FINGERPRINT_VERSION,
    parseSeverities,
    extractFindings,
    buildBaseline,
    buildDiff,
    renderComparedMarkdown,
    evaluate
} = require('./sca-baseline');
const { buildSummary } = require('../veracode-sca/summary-findings');

/** scaResults.json no formato do agente (records[0].libraries/vulnerabilities). */
function results({ libraries, vulnerabilities }) {
    return { records: [{ libraries, vulnerabilities, graphs: [] }] };
}

function library(name, versions) {
    return { name, coordinateType: 'NPM', coordinate1: name, versions: versions.map((version) => ({ version })) };
}

function vuln(cve, score, title, refs) {
    return {
        cve: cve ? cve.replace(/^CVE-/, '') : undefined,
        title,
        cvss3Score: score,
        libraries: refs.map((ref) => ({ _links: { ref } }))
    };
}

const MARKED = library('marked', ['0.3.5', '0.3.9']);
const LODASH = library('lodash', ['4.17.4']);
const MONGO = library('mongodb', ['2.2.36']);

function scan({ lodash = false, markedVersion = 0 } = {}) {
    const libraries = [MARKED, MONGO, ...(lodash ? [LODASH] : [])];
    const vulnerabilities = [
        vuln('CVE-2022-21681', 7.5, 'Regular Expression Denial Of Service (ReDoS)', [`/records/0/libraries/0/versions/${markedVersion}`]),
        vuln('', 5.3, 'Denial Of Service (DoS)', ['/records/0/libraries/1/versions/0'])
    ];
    if (lodash) {
        vulnerabilities.push(
            vuln('CVE-2019-10744', 9.1, 'Prototype Pollution', ['/records/0/libraries/2/versions/0']),
            vuln('CVE-2020-8203', 7.4, 'Prototype Pollution', ['/records/0/libraries/2/versions/0']),
            vuln('CVE-2018-16487', 5.6, 'Prototype Pollution', ['/records/0/libraries/2/versions/0'])
        );
    }
    return results({ libraries, vulnerabilities });
}

test('parseSeverities aceita as severidades SCA e rejeita o resto', () => {
    assert.equal(parseSeverities(''), null);
    assert.deepEqual([...parseSeverities('Very High, high')], ['critical', 'high']);
    assert.throws(() => parseSeverities('High, Critical'), /severidade inválida: 'Critical'/);
});

test('extractFindings gera um finding por vulnerabilidade x biblioteca, com banda por CVSS', () => {
    const findings = extractFindings(scan({ lodash: true }));
    assert.equal(findings.length, 5);
    const redos = findings.find((f) => f.id === 'CVE-2022-21681');
    assert.equal(redos.severity, 'high');
    assert.equal(redos.library, 'marked@0.3.5');
    assert.equal(redos.location, 'NPM:marked');
    const noCve = findings.find((f) => f.library === 'mongodb@2.2.36');
    assert.match(noCve.id, /^TITLE-/);
    assert.equal(noCve.cve, '');
});

test('o fingerprint ignora a versão: subir a biblioteca sem corrigir continua backlog', () => {
    const baseline = buildBaseline(scan());
    const diff = buildDiff(baseline, scan({ markedVersion: 1 }));
    assert.deepEqual(diff.counts, { new_policy: 0, new_other: 0, backlog: 2, fixed: 0 });
});

test('baseline não guarda o campo de política', () => {
    const doc = buildBaseline(scan());
    assert.equal(doc.kind, 'sca');
    assert.equal(doc.fingerprint_version, FINGERPRINT_VERSION);
    assert.ok(doc.findings.every((f) => !('policy' in f)));
});

test('classifica novos pela severidade de sca_fail_on_severity e pelos CVEs de fail_on_cve', () => {
    const baseline = buildBaseline(scan());
    const criteria = { severities: parseSeverities('Very High, High'), cves: new Set(['CVE-2018-16487']) };
    const diff = buildDiff(baseline, scan({ lodash: true }), criteria);
    assert.deepEqual(diff.counts, { new_policy: 3, new_other: 0, backlog: 2, fixed: 0 });
    assert.deepEqual(diff.new_policy.map((f) => f.id), ['CVE-2019-10744', 'CVE-2020-8203', 'CVE-2018-16487']);

    const onlySeverity = buildDiff(baseline, scan({ lodash: true }), { severities: parseSeverities('Very High, High') });
    assert.deepEqual(onlySeverity.new_other.map((f) => f.id), ['CVE-2018-16487']);
    assert.match(onlySeverity.criteria, /severidade Very High, High/);
});

test('sem sca_fail_on_severity todo finding novo afeta a política', () => {
    const diff = buildDiff(buildBaseline(scan()), scan({ lodash: true }), {});
    assert.equal(diff.counts.new_policy, 3);
    assert.equal(diff.counts.new_other, 0);
    assert.equal(diff.criteria, 'qualquer severidade');
});

test('corrigidos entram só na contagem', () => {
    const diff = buildDiff(buildBaseline(scan({ lodash: true })), scan(), {});
    assert.deepEqual(diff.counts, { new_policy: 0, new_other: 0, backlog: 2, fixed: 3 });
});

test('o card mostra a política e a tabela de três grupos', () => {
    const diff = buildDiff(buildBaseline(scan()), scan({ lodash: true }), { severities: parseSeverities('Very High, High') });
    const md = renderComparedMarkdown(diff);
    assert.match(md, /### 🔍 Veracode SCA \(Repo Baseline\)/);
    assert.match(md, /\*\*Política SCA:\*\* severidade Very High, High/);
    assert.match(md, /\| ❌ Novos \(afetam a política\) \| 1 \| 1 \| 0 \| 0 \| 0 \| \*\*2\*\* \|/);
    assert.match(md, /\| 🆕 Novos \(não afetam\) \| 0 \| 0 \| 1 \| 0 \| 0 \| \*\*1\*\* \|/);
    assert.match(md, /\| 📦 Backlog \| 0 \| 1 \| 1 \| 0 \| 0 \| \*\*2\*\* \|/);
    assert.match(md, /<summary>Novos que afetam a política \(2\)<\/summary>/);
    assert.match(md, /\| 1 \| 🔴 Very High \| CVE-2019-10744 \| Prototype Pollution \| lodash@4\.17\.4 \|/);
});

function tmp(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-baseline-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('evaluate: sem baseline adia; com baseline compara e grava o diff', (t) => {
    const dir = tmp(t);
    const resultsPath = path.join(dir, 'scaResults.json');
    const baselinePath = path.join(dir, 'sca-baseline.json');
    const diffPath = path.join(dir, 'sca-results', 'sca-baseline-diff.json');
    fs.writeFileSync(resultsPath, JSON.stringify(scan({ lodash: true })));
    const base = { getOutcome: 'success', resultsPath, baselinePath, diffPath, criteria: {}, storeFile: 'Org/app/sca-baseline.json' };

    assert.equal(evaluate({ ...base, hasBaseline: 'false' }).status, 'deferred');
    assert.equal(evaluate({ ...base, getOutcome: 'failure', hasBaseline: 'true' }).status, 'error');

    fs.writeFileSync(baselinePath, JSON.stringify(buildBaseline(scan())));
    const compared = evaluate({ ...base, hasBaseline: 'true' });
    assert.equal(compared.status, 'compared');
    assert.equal(compared.counts.new_policy, 3);
    assert.ok(fs.existsSync(diffPath));

    fs.writeFileSync(resultsPath, 'não é json');
    assert.equal(evaluate({ ...base, hasBaseline: 'true' }).status, 'error');
});

test('summary SCA: comparado usa a tabela de grupos e mantém os CVEs bloqueados acima', (t) => {
    const dir = tmp(t);
    const diffPath = path.join(dir, 'diff.json');
    fs.writeFileSync(diffPath, JSON.stringify(buildDiff(buildBaseline(scan()), scan({ lodash: true }), {})));
    const blocked = { requested: ['CVE-2019-10744'], matched: ['CVE-2019-10744'], missing: [],
        findings: [{ band: 'critical', cve: 'CVE-2019-10744', title: 'Prototype Pollution', library: 'lodash@4.17.4' }] };
    const md = buildSummary({ jsonPath: path.join(dir, 'none.json'), txtPath: path.join(dir, 'none.txt'),
        baselineStatus: 'compared', diffPath, blocked });
    assert.ok(md.indexOf('Findings bloqueados por CVE (1)') < md.indexOf('| Grupo |'));
    assert.match(md, /### 🔍 Veracode SCA \(Repo Baseline\)/);
    assert.doesNotMatch(md, /Bibliotecas transitivas/);
});

test('summary SCA sem baseline comparado: mesma tabela, só a linha de vulnerabilidades', (t) => {
    const dir = tmp(t);
    const jsonPath = path.join(dir, 'scaResults.json');
    fs.writeFileSync(jsonPath, JSON.stringify(scan()));
    const seeded = buildSummary({ jsonPath, txtPath: path.join(dir, 'x.txt'), baselineStatus: 'seeded' });
    assert.match(seeded, /### 🔍 Veracode SCA \(Repo Baseline\)/);
    assert.match(seeded, /\| 🔎 Vulnerabilidades \| 0 \| 1 \| 1 \| 0 \| 0 \| \*\*2\*\* \|/);
    assert.doesNotMatch(seeded, /baseline gravado|Findings do SCA|Afetam a política/);
    const off = buildSummary({ jsonPath, txtPath: path.join(dir, 'x.txt') });
    assert.match(off, /### 🔍 Veracode SCA \(Software Composition Analysis\)/);
    assert.match(off, /\| 🔎 Vulnerabilidades \|/);
});
