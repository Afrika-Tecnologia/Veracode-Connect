'use strict';

/**
 * Baseline IaC/Secrets do Veracode Connect (modo repo, write-once).
 *
 * A Veracode não oferece baseline para Container/IaC/Secrets. Aqui o Connect:
 *   1. normaliza o results.json da CLI em findings com identidade estável (fingerprint);
 *   2. grava esse conjunto, sanitizado, como iac-baseline.json na primeira execução elegível;
 *   3. nas execuções seguintes classifica cada finding atual em novo que afeta a política,
 *      novo que não afeta a política ou backlog. Corrigidos só entram na contagem.
 *
 * "Afeta a política" vem de customerPolicyResult.Status = "failed", que a CLI grava em cada
 * finding quando o scan roda com --policy.
 *
 * Identidade em duas camadas, casadas em duas passadas:
 *   - fingerprint: o que identifica o problema e não muda com edições vizinhas
 *       vulnerabilidade = id + tipo + pacote (sem versão) + manifestos
 *       secret          = regra + arquivo
 *       configuração    = regra + arquivo + recurso (Terraform etc.)
 *   - detail: o que distingue repetições do mesmo fingerprint
 *       vulnerabilidade = versão; secret = hash do trecho mascarado; configuração = hash das linhas causa
 *   Passada 1 casa fingerprint + detail; passada 2 casa só o fingerprint. Assim, deslocar linhas,
 *   editar o recurso ou subir a versão sem corrigir a CVE continua sendo backlog.
 *
 * CLI:
 *   node iac-baseline.js build    --results R --out F
 *   node iac-baseline.js evaluate                       (env, ver evaluateFromEnv)
 *   node iac-baseline.js summary-md --diff D [--policy NOME]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeSeverity } = require('../veracode-iac/summary-findings');
const { message, fail } = require('./messages');

const SCHEMA_VERSION = 1;
const FINGERPRINT_VERSION = 1;
const DETAILS_LIMIT = 200;

function sha256(value, length = 24) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function readJson(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (_) {
        /* ignore */
    }
    return null;
}

function isIacResults(data) {
    return Boolean(data) && typeof data === 'object' && !Array.isArray(data)
        && ('vulnerabilities' in data || 'secrets' in data || 'configs' in data);
}

function policyStatusOf(item) {
    const raw = item?.customerPolicyResult;
    const status = typeof raw === 'string' ? raw : raw?.Status;
    return String(status || '').trim().toLowerCase();
}

function band(severity) {
    return normalizeSeverity(severity) || 'very_low';
}

function causeContent(config) {
    const lines = config?.CauseMetadata?.Code?.Lines;
    if (!Array.isArray(lines)) return '';
    return lines
        .filter((line) => line?.IsCause !== false)
        .map((line) => String(line?.Content ?? '').trim())
        .join('\n');
}

function vulnerabilityFinding(match) {
    const vuln = match?.vulnerability || {};
    const artifact = match?.artifact || {};
    const locations = (Array.isArray(artifact.locations) ? artifact.locations : [])
        .map((loc) => String(loc?.path || ''))
        .filter(Boolean)
        .sort();
    const cve = (Array.isArray(match?.relatedVulnerabilities) ? match.relatedVulnerabilities : [])
        .map((entry) => String(entry?.id || ''))
        .find((id) => id.startsWith('CVE-'));
    const name = String(artifact.name || '');
    const version = String(artifact.version || '');
    return {
        category: 'vulnerability',
        fingerprint: sha256(['vulnerability', vuln.id || '', artifact.type || '', name, locations.join(',')].join('|')),
        detail: sha256(version || artifact.purl || '', 16),
        id: String(vuln.id || cve || 'N/A'),
        cve: cve || '',
        severity: band(vuln.severity),
        title: `${name}@${version || '?'}`,
        location: locations[0] || '',
        policy: policyStatusOf(match)
    };
}

function secretFinding(secret) {
    const target = String(secret?.Target || '');
    return {
        category: 'secret',
        fingerprint: sha256(['secret', secret?.RuleID || '', target].join('|')),
        // Match já vem mascarado pela CLI; mesmo assim só o hash é guardado.
        detail: sha256(String(secret?.Match ?? ''), 16),
        id: String(secret?.RuleID || 'N/A'),
        severity: band(secret?.Severity),
        title: String(secret?.Title || 'N/A'),
        location: secret?.StartLine ? `${target}:${secret.StartLine}` : target,
        policy: policyStatusOf(secret)
    };
}

function configFinding(config) {
    const meta = config?.CauseMetadata || {};
    const target = String(config?.Target || '');
    const resource = String(meta.Resource || '');
    return {
        category: 'config',
        fingerprint: sha256(['config', config?.ID || '', target, resource].join('|')),
        detail: sha256(`${resource}\n${causeContent(config)}`, 16),
        id: String(config?.ID || 'N/A'),
        severity: band(config?.Severity),
        title: String(config?.Title || config?.Message || 'N/A'),
        location: `${target}${meta.StartLine ? `:${meta.StartLine}` : ''}${resource ? ` (${resource})` : ''}`,
        policy: policyStatusOf(config)
    };
}

/** Normaliza o results.json da CLI. Nunca devolve Code/Match dos secrets. */
function extractFindings(results) {
    if (!isIacResults(results)) return [];
    const matches = Array.isArray(results.vulnerabilities?.matches) ? results.vulnerabilities.matches : [];
    const secrets = Array.isArray(results.secrets) ? results.secrets : [];
    const configs = (Array.isArray(results.configs) ? results.configs : [])
        .filter((config) => String(config?.Status || '').toUpperCase() !== 'PASS');
    return [
        ...matches.map(vulnerabilityFinding),
        ...secrets.map(secretFinding),
        ...configs.map(configFinding)
    ];
}

function stripPolicy({ policy, ...rest }) {
    return rest;
}

function buildBaseline(results, meta = {}) {
    const findings = extractFindings(results).map(stripPolicy);
    findings.sort((a, b) => (a.fingerprint + a.detail).localeCompare(b.fingerprint + b.detail));
    return {
        schema_version: SCHEMA_VERSION,
        kind: 'iac',
        fingerprint_version: FINGERPRINT_VERSION,
        repository: meta.repository || '',
        commit: meta.commit || '',
        ref: meta.ref || '',
        generated_at: meta.generatedAt || new Date().toISOString(),
        findings
    };
}

function isBaselineDocument(doc) {
    return Boolean(doc) && typeof doc === 'object' && Array.isArray(doc.findings)
        && Number.isInteger(doc.fingerprint_version);
}

/**
 * Classifica os findings atuais contra o baseline (multiconjunto, duas passadas).
 * @returns {{newPolicy: object[], newOther: object[], backlog: object[], fixedCount: number}}
 */
function compareFindings(baselineFindings, currentFindings) {
    const used = new Array(baselineFindings.length).fill(false);
    const byExact = new Map();
    const byFingerprint = new Map();
    baselineFindings.forEach((finding, index) => {
        const exact = `${finding.fingerprint}:${finding.detail}`;
        if (!byExact.has(exact)) byExact.set(exact, []);
        byExact.get(exact).push(index);
        if (!byFingerprint.has(finding.fingerprint)) byFingerprint.set(finding.fingerprint, []);
        byFingerprint.get(finding.fingerprint).push(index);
    });

    const take = (indexes) => {
        if (!indexes) return false;
        const index = indexes.find((i) => !used[i]);
        if (index === undefined) return false;
        used[index] = true;
        return true;
    };

    const matched = new Array(currentFindings.length).fill(false);
    currentFindings.forEach((finding, i) => {
        matched[i] = take(byExact.get(`${finding.fingerprint}:${finding.detail}`));
    });
    currentFindings.forEach((finding, i) => {
        if (!matched[i]) matched[i] = take(byFingerprint.get(finding.fingerprint));
    });

    const result = { newPolicy: [], newOther: [], backlog: [], fixedCount: used.filter((u) => !u).length };
    currentFindings.forEach((finding, i) => {
        if (matched[i]) result.backlog.push(finding);
        else if (finding.policy === 'failed') result.newPolicy.push(finding);
        else result.newOther.push(finding);
    });
    return result;
}

function emptyCounts() {
    return { critical: 0, high: 0, medium: 0, low: 0, very_low: 0, total: 0 };
}

function countBands(findings) {
    const counts = emptyCounts();
    for (const finding of findings) {
        counts[finding.severity in counts ? finding.severity : 'very_low'] += 1;
        counts.total += 1;
    }
    return counts;
}

function buildDiff(baselineDoc, results, policyName = '') {
    const comparison = compareFindings(baselineDoc.findings, extractFindings(results));
    const order = { critical: 0, high: 1, medium: 2, low: 3, very_low: 4 };
    const sort = (list) => list.slice().sort((a, b) => order[a.severity] - order[b.severity]
        || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    return {
        schema_version: SCHEMA_VERSION,
        fingerprint_version: FINGERPRINT_VERSION,
        policy_name: policyName,
        baseline: {
            commit: baselineDoc.commit || '',
            generated_at: baselineDoc.generated_at || ''
        },
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

const BAND_LABEL = {
    critical: '🔴 Very High',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🔵 Low',
    very_low: '⚪ Very Low'
};
const CATEGORY_LABEL = { vulnerability: 'Vulnerabilidade', secret: 'Secret', config: 'Configuração' };

function cell(value) {
    const text = value == null || value === '' ? 'N/A' : String(value);
    return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function safeName(value) {
    return String(value || '').replace(/[\r\n]/g, ' ').replace(/[`|]/g, '\\$&');
}

function groupRow(label, findings) {
    const c = countBands(findings);
    return `| ${label} | ${c.critical} | ${c.high} | ${c.medium} | ${c.low} | ${c.very_low} | **${c.total}** |`;
}

function detailsBlock(heading, findings, limit) {
    if (!findings.length) return [];
    const shown = findings.slice(0, limit);
    const lines = [
        `<details><summary>${heading} (${findings.length})</summary>`,
        '',
        '| # | Severidade | Tipo | ID | Descrição | Local |',
        '|---|---|---|---|---|---|',
        ...shown.map((f, i) => `| ${i + 1} | ${BAND_LABEL[f.severity] || BAND_LABEL.very_low} | ${CATEGORY_LABEL[f.category] || f.category} | ${cell(f.cve || f.id)} | ${cell(f.title)} | ${cell(f.location)} |`)
    ];
    if (findings.length > shown.length) {
        lines.push('', `> Exibindo ${shown.length} de ${findings.length}. A lista completa está em \`iac-results/iac-baseline-diff.json\` no artefato do IaC.`);
    }
    lines.push('', '</details>', '');
    return lines;
}

/**
 * Card IaC com baseline comparado: uma tabela com os três grupos e o detalhamento de cada um.
 * @param {{detailsLimit?: number, groups?: string[]}} [options]
 */
function renderComparedMarkdown(diff, options = {}) {
    const limit = options.detailsLimit ?? DETAILS_LIMIT;
    const groups = options.groups || ['new_policy', 'new_other', 'backlog'];
    const policyName = safeName(diff.policy_name);
    const hasPolicy = Boolean(policyName) && policyName !== 'none';
    const lines = ['### 🛡️ Veracode IaC / Secrets (Repo Baseline)', ''];

    if (hasPolicy) {
        const verdict = diff.counts.new_policy > 0 ? '❌ Não passou' : '✅ Passou';
        lines.push(`**Política IaC (${policyName}) — findings novos:** ${verdict}`, '');
    } else {
        lines.push('> ℹ️ Sem política IaC (`iac_policy: none`): nenhum finding novo bloqueia.', '');
    }
    lines.push('| Grupo | 🔴 Very High | 🟠 High | 🟡 Medium | 🔵 Low | ⚪ Very Low | Total |');
    lines.push('|---|---|---|---|---|---|---|');
    lines.push(groupRow('❌ Novos que afetam a política', diff.new_policy));
    lines.push(groupRow('🆕 Novos que não afetam a política', diff.new_other));
    lines.push(groupRow('📦 Backlog (já no baseline)', diff.backlog));
    lines.push('');

    const headings = {
        new_policy: 'Novos que afetam a política',
        new_other: 'Novos que não afetam a política',
        backlog: 'Backlog'
    };
    for (const group of groups) {
        lines.push(...detailsBlock(headings[group], diff[group] || [], limit));
    }
    return `${lines.join('\n')}\n`;
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
function evaluate({ getOutcome, hasBaseline, scanOk, resultsPath, baselinePath, diffPath, policyName, storeFile }) {
    if (getOutcome !== 'success') {
        console.log(`::warning::${message('warning', 'BASELINE_READ_FAILED')}`);
        return { status: 'error' };
    }
    if (hasBaseline !== 'true') {
        console.log(message('success', 'BASELINE_DEFERRED'));
        return { status: 'deferred' };
    }
    const results = readJson(resultsPath);
    if (scanOk !== 'true' || !isIacResults(results)) {
        console.log(`::warning::${message('warning', 'SCAN_NOT_VALID')}`);
        return { status: 'error' };
    }
    const baselineDoc = readJson(baselinePath);
    if (!isBaselineDocument(baselineDoc)) {
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
    const diff = buildDiff(baselineDoc, results, policyName);
    fs.mkdirSync(path.dirname(path.resolve(diffPath)), { recursive: true });
    fs.writeFileSync(diffPath, `${JSON.stringify(diff, null, 2)}\n`);
    console.log(message('success', 'COMPARED', diff.counts));
    if (diff.counts.new_policy > 0 && policyName && policyName !== 'none') {
        console.log(`::warning::${message('warning', 'NEW_POLICY_FINDINGS', { count: diff.counts.new_policy, policy: policyName })}`);
    }
    return { status: 'compared', counts: diff.counts };
}

function evaluateFromEnv(env = process.env) {
    const scanRepository = env.SCAN_REPOSITORY || env.GITHUB_REPOSITORY || 'org/repo';
    const result = evaluate({
        getOutcome: env.GET_OUTCOME || '',
        hasBaseline: env.HAS_BASELINE || '',
        scanOk: env.SCAN_OK || '',
        resultsPath: env.RESULTS_FILE,
        baselinePath: env.BASELINE_FILE,
        diffPath: env.DIFF_FILE,
        policyName: env.IAC_POLICY || 'none',
        storeFile: `${scanRepository}/iac-baseline.json`
    });
    const counts = result.counts || {};
    writeOutputs({
        iac_baseline_status: result.status,
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
            if (!isIacResults(results)) throw fail('RESULTS_INVALID', { file: args.results });
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
    readJson,
    isIacResults,
    extractFindings,
    buildBaseline,
    isBaselineDocument,
    compareFindings,
    countBands,
    buildDiff,
    renderComparedMarkdown,
    evaluate,
    evaluateFromEnv
};
