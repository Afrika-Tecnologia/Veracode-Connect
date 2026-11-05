'use strict';

/**
 * Baseline SCA do Veracode Connect (modo repo, write-once).
 *
 * Mesmo modelo do baseline IaC:
 *   1. normaliza o scaResults.json do agente em findings (vulnerabilidade x biblioteca);
 *   2. grava esse conjunto como sca-baseline.json na primeira execução elegível;
 *   3. nas seguintes classifica cada finding em novo que afeta a política, novo que não afeta
 *      ou backlog. Corrigidos só entram na contagem.
 *
 * O resultado do agente não diz, por finding, se ele viola a política do workspace SCA.
 * "Afeta a política" é explícito: severidade em sca_fail_on_severity (vazio = todas) ou
 * CVE listado em fail_on_cve.
 *
 * Identidade (casada em duas passadas por iac-baseline.compareFindings):
 *   - fingerprint = vulnerabilidade (CVE ou id do banco SCA) + biblioteca sem versão
 *   - detail      = versão da biblioteca
 *   Subir a versão sem corrigir a vulnerabilidade continua sendo backlog.
 *
 * CLI:
 *   node sca-baseline.js build --results R --out F
 *   node sca-baseline.js evaluate                     (env, ver evaluateFromEnv)
 *   node sca-baseline.js summary-md --diff D
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const iac = require('../iac-baseline/iac-baseline');
const { cvssBand } = require('../veracode-sca/summary-findings');
const { message, fail } = require('./messages');

const SCHEMA_VERSION = 1;
const FINGERPRINT_VERSION = 1;
const DETAILS_LIMIT = 200;
const SEVERITY_BANDS = {
    'very high': 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    'very low': 'very_low'
};
const BAND_NAME = { critical: 'Very High', high: 'High', medium: 'Medium', low: 'Low', very_low: 'Very Low' };

function sha256(value, length = 24) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

const readJson = iac.readJson;

function scaRecord(data) {
    const record = Array.isArray(data?.records) ? data.records[0] : null;
    return record && typeof record === 'object' ? record : null;
}

function isScaResults(data) {
    const record = scaRecord(data);
    return Boolean(record) && Array.isArray(record.libraries) && Array.isArray(record.vulnerabilities);
}

/** "Very High, High" -> Set(['critical','high']); vazio -> null (todas as severidades). */
function parseSeverities(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const bands = new Set();
    for (const token of text.split(',')) {
        const key = token.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!key) continue;
        if (!SEVERITY_BANDS[key]) throw fail('SEVERITY_INVALID', { severity: token.trim() });
        bands.add(SEVERITY_BANDS[key]);
    }
    return bands.size ? bands : null;
}

function parseCves(raw) {
    return new Set(String(raw || '').split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean));
}

/** Texto do critério para o card e logs. */
function criteriaLabel({ severities, cves }) {
    const parts = [];
    parts.push(severities
        ? `severidade ${[...Object.keys(BAND_NAME)].filter((b) => severities.has(b)).map((b) => BAND_NAME[b]).join(', ')}`
        : 'qualquer severidade');
    if (cves && cves.size) parts.push(`CVEs de fail_on_cve: ${[...cves].join(', ')}`);
    return parts.join(' · ');
}

function vulnerabilityId(vuln) {
    const cve = vuln?.exploitability?.cveFull || (vuln?.cve ? `CVE-${String(vuln.cve).replace(/^CVE-/i, '')}` : '');
    if (cve) return { id: cve.toUpperCase(), cve: cve.toUpperCase() };
    const html = String(vuln?._links?.html || '');
    const sid = html.match(/vulnerabilities\/(\d+)/);
    if (sid) return { id: `SID-${sid[1]}`, cve: '' };
    return { id: `TITLE-${sha256(vuln?.title || vuln?.overview || '', 12)}`, cve: '' };
}

function libraryOf(record, ref) {
    const match = String(ref || '').match(/libraries\/(\d+)(?:\/versions\/(\d+))?/);
    const library = match ? record.libraries[Number(match[1])] : null;
    const version = library?.versions?.[match && match[2] ? Number(match[2]) : 0]?.version || '';
    const coordinate = [library?.coordinateType, library?.coordinate1, library?.coordinate2]
        .filter((part) => part != null && part !== '').join(':');
    const name = library?.name || library?.coordinate2 || library?.coordinate1 || '';
    return { name, version, coordinate: coordinate || name };
}

/**
 * Um finding por par vulnerabilidade x biblioteca, como na saída texto do agente.
 * @param {object} results scaResults.json
 * @param {{severities?: Set<string>|null, cves?: Set<string>}} criteria
 */
function extractFindings(results, criteria = {}) {
    if (!isScaResults(results)) return [];
    const record = scaRecord(results);
    const severities = criteria.severities ?? null;
    const cves = criteria.cves || new Set();
    const findings = [];
    for (const vuln of record.vulnerabilities) {
        const { id, cve } = vulnerabilityId(vuln);
        const score = Number(vuln.cvss3Score ?? vuln.cvssScore);
        const severity = cvssBand(score) || 'very_low';
        const libraries = Array.isArray(vuln.libraries) && vuln.libraries.length ? vuln.libraries : [{}];
        for (const entry of libraries) {
            const library = libraryOf(record, entry?._links?.ref);
            const affects = (severities ? severities.has(severity) : true) || (cve && cves.has(cve));
            findings.push({
                category: 'library',
                fingerprint: sha256(JSON.stringify(['sca', id, library.coordinate])),
                detail: library.version,
                id,
                cve,
                severity,
                score: Number.isFinite(score) ? score : 0,
                title: String(vuln.title || vuln.overview || '').replace(/\s+/g, ' ').trim(),
                library: library.version ? `${library.name}@${library.version}` : library.name,
                location: library.coordinate,
                policy: affects ? 'failed' : 'passed'
            });
        }
    }
    return findings;
}

function stripPolicy({ policy, ...rest }) {
    return rest;
}

function buildBaseline(results, meta = {}) {
    const findings = extractFindings(results).map(stripPolicy);
    findings.sort((a, b) => (a.fingerprint + a.detail).localeCompare(b.fingerprint + b.detail));
    return {
        schema_version: SCHEMA_VERSION,
        kind: 'sca',
        fingerprint_version: FINGERPRINT_VERSION,
        repository: meta.repository || '',
        commit: meta.commit || '',
        ref: meta.ref || '',
        generated_at: meta.generatedAt || new Date().toISOString(),
        findings
    };
}

function buildDiff(baselineDoc, results, criteria = {}) {
    const comparison = iac.compareFindings(baselineDoc.findings, extractFindings(results, criteria));
    const order = { critical: 0, high: 1, medium: 2, low: 3, very_low: 4 };
    const sort = (list) => list.slice().sort((a, b) => order[a.severity] - order[b.severity]
        || b.score - a.score || a.id.localeCompare(b.id));
    return {
        schema_version: SCHEMA_VERSION,
        fingerprint_version: FINGERPRINT_VERSION,
        criteria: criteriaLabel(criteria),
        baseline: { commit: baselineDoc.commit || '', generated_at: baselineDoc.generated_at || '' },
        counts: {
            new_policy: comparison.newPolicy.length,
            new_other: comparison.newOther.length,
            backlog: comparison.backlog.length,
            fixed: comparison.fixedCount
        },
        new_policy: sort(comparison.newPolicy),
        new_other: sort(comparison.newOther),
        backlog: sort(comparison.backlog)
    };
}

// ── Markdown ─────────────────────────────────────────────────────────────────

const HEADING = '### 🔍 Veracode SCA (Repo Baseline)';

function detailsBlock(heading, findings, limit) {
    if (!findings.length) return [];
    const shown = findings.slice(0, limit);
    const lines = [
        `<details><summary>${heading} (${findings.length})</summary>`,
        '',
        '| # | Severidade | CVE / ID | Descrição | Biblioteca |',
        '|---|---|---|---|---|',
        ...shown.map((f, i) => {
            const title = f.title.length > 80 ? `${f.title.slice(0, 77)}...` : f.title;
            return `| ${i + 1} | ${iac.BAND_LABEL[f.severity] || iac.BAND_LABEL.very_low} | ${iac.cell(f.id)} | ${iac.cell(title)} | ${iac.cell(f.library)} |`;
        })
    ];
    if (findings.length > shown.length) {
        lines.push('', `> Exibindo ${shown.length} de ${findings.length}. A lista completa está em \`sca-results/sca-baseline-diff.json\` no artefato do SCA.`);
    }
    lines.push('', '</details>', '');
    return lines;
}

/**
 * Tabela de três grupos e o detalhamento de cada um (sem o cabeçalho do card).
 * @param {{detailsLimit?: number, groups?: string[]}} [options]
 */
function renderComparedBody(diff, options = {}) {
    const limit = options.detailsLimit ?? DETAILS_LIMIT;
    const groups = options.groups || ['new_policy', 'new_other', 'backlog'];
    const lines = [`**Política SCA:** ${iac.cell(diff.criteria || 'qualquer severidade')}`, ''];
    lines.push(...iac.groupsTable(diff), '');
    const headings = {
        new_policy: 'Novos que afetam a política',
        new_other: 'Novos que não afetam a política',
        backlog: 'Backlog'
    };
    for (const group of groups) {
        lines.push(...detailsBlock(headings[group], diff[group] || [], limit));
    }
    return lines;
}

function renderComparedMarkdown(diff, options = {}) {
    return `${[HEADING, '', ...renderComparedBody(diff, options)].join('\n')}\n`;
}

// ── Avaliação na action ─────────────────────────────────────────────────────

function writeOutputs(outputs) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) return;
    fs.appendFileSync(out, Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

/**
 * Decide o estado do baseline e, quando possível, compara.
 * @returns {{status: 'compared'|'deferred'|'error', counts?: object}}
 */
function evaluate({ getOutcome, hasBaseline, resultsPath, baselinePath, diffPath, criteria, storeFile }) {
    if (getOutcome !== 'success') {
        console.log(`::warning::${message('warning', 'BASELINE_READ_FAILED')}`);
        return { status: 'error' };
    }
    if (hasBaseline !== 'true') {
        console.log(message('success', 'BASELINE_DEFERRED'));
        return { status: 'deferred' };
    }
    const results = readJson(resultsPath);
    if (!isScaResults(results)) {
        console.log(`::warning::${message('warning', 'SCAN_NOT_VALID')}`);
        return { status: 'error' };
    }
    const baselineDoc = readJson(baselinePath);
    if (!iac.isBaselineDocument(baselineDoc)) {
        console.log(`::warning::${message('warning', 'BASELINE_PARSE_FAILED', { file: storeFile })}`);
        return { status: 'error' };
    }
    if (baselineDoc.fingerprint_version !== FINGERPRINT_VERSION) {
        console.log(`::warning::${message('warning', 'FINGERPRINT_VERSION_MISMATCH', {
            stored: baselineDoc.fingerprint_version,
            current: FINGERPRINT_VERSION,
            file: storeFile
        })}`);
        return { status: 'error' };
    }
    const diff = buildDiff(baselineDoc, results, criteria);
    fs.mkdirSync(path.dirname(path.resolve(diffPath)), { recursive: true });
    fs.writeFileSync(diffPath, `${JSON.stringify(diff, null, 2)}\n`);
    console.log(message('success', 'COMPARED', diff.counts));
    if (diff.counts.new_policy > 0) {
        console.log(`::warning::${message('warning', 'NEW_POLICY_FINDINGS', { count: diff.counts.new_policy, criteria: diff.criteria })}`);
    }
    return { status: 'compared', counts: diff.counts };
}

function criteriaFromEnv(env = process.env) {
    return { severities: parseSeverities(env.SCA_FAIL_ON_SEVERITY), cves: parseCves(env.FAIL_ON_CVE) };
}

function evaluateFromEnv(env = process.env) {
    const scanRepository = env.SCAN_REPOSITORY || env.GITHUB_REPOSITORY || 'org/repo';
    const result = evaluate({
        getOutcome: env.GET_OUTCOME || '',
        hasBaseline: env.HAS_BASELINE || '',
        resultsPath: env.RESULTS_FILE,
        baselinePath: env.BASELINE_FILE,
        diffPath: env.DIFF_FILE,
        criteria: criteriaFromEnv(env),
        storeFile: `${scanRepository}/sca-baseline.json`
    });
    const counts = result.counts || {};
    writeOutputs({
        sca_baseline_status: result.status,
        new_policy_count: counts.new_policy ?? 0,
        new_count: (counts.new_policy ?? 0) + (counts.new_other ?? 0),
        backlog_count: counts.backlog ?? 0,
        fixed_count: counts.fixed ?? 0
    });
    return result;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            args[argv[i].slice(2)] = argv[i + 1];
            i += 1;
        }
    }
    return args;
}

if (require.main === module) {
    try {
        const [command, ...rest] = process.argv.slice(2);
        const args = parseArgs(rest);
        if (command === 'build' && args.results && args.out) {
            const results = readJson(args.results);
            if (!isScaResults(results)) throw fail('RESULTS_INVALID', { file: args.results });
            const doc = buildBaseline(results, {
                repository: process.env.SCAN_REPOSITORY || process.env.GITHUB_REPOSITORY || '',
                commit: process.env.GITHUB_SHA || '',
                ref: process.env.GITHUB_REF || ''
            });
            fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
            fs.writeFileSync(args.out, `${JSON.stringify(doc, null, 2)}\n`);
            console.log(message('success', 'BUILT', { count: doc.findings.length, file: args.out }));
        } else if (command === 'evaluate') {
            evaluateFromEnv();
        } else if (command === 'summary-md' && args.diff) {
            const diff = readJson(args.diff);
            if (!diff) throw fail('RESULTS_INVALID', { file: args.diff });
            process.stdout.write(renderComparedMarkdown(diff));
        } else {
            throw fail('CLI_USAGE');
        }
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    SCHEMA_VERSION,
    FINGERPRINT_VERSION,
    DETAILS_LIMIT,
    HEADING,
    readJson,
    isScaResults,
    parseSeverities,
    parseCves,
    criteriaLabel,
    extractFindings,
    buildBaseline,
    buildDiff,
    detailsBlock,
    renderComparedBody,
    renderComparedMarkdown,
    evaluate,
    evaluateFromEnv
};
