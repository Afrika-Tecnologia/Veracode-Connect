'use strict';

/**
 * Contagens e markdown IaC/Secrets a partir de results.json.
 *
 * Bash: node "$GITHUB_ACTION_PATH/summary-findings.js" summary-md [jsonPath]
 */

const fs = require('fs');
const { message } = require('./messages');

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

function emptyCounts() {
    return {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        very_low: 0,
        total: 0
    };
}

function normalizeSeverity(raw) {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'CRITICAL' || value === 'VERY HIGH' || value === 'VERYHIGH') {
        return 'critical';
    }
    if (value === 'HIGH') {
        return 'high';
    }
    if (value === 'MEDIUM' || value === 'MODERATE') {
        return 'medium';
    }
    if (value === 'LOW') {
        return 'low';
    }
    if (value === 'NEGLIGIBLE' || value === 'VERY LOW' || value === 'VERYLOW' || value === 'INFO') {
        return 'very_low';
    }
    return null;
}

function extractMatches(data) {
    if (!data) {
        return [];
    }
    let matches = [];
    if (Array.isArray(data.vulnerabilities?.matches)) {
        matches = data.vulnerabilities.matches;
    } else if (Array.isArray(data.matches)) {
        matches = data.matches;
    } else if (Array.isArray(data)) {
        matches = data;
    } else if (Array.isArray(data.findings)) {
        matches = data.findings;
    } else if (Array.isArray(data.results)) {
        matches = data.results;
    }
    return matches.concat(
        Array.isArray(data.secrets) ? data.secrets : [],
        Array.isArray(data.configs) ? data.configs : []
    );
}

function countFromMatches(matches) {
    const counts = emptyCounts();
    const rows = [];
    for (const item of matches) {
        const severityRaw = item?.vulnerability?.severity
            || item?.severity
            || item?.Vulnerability?.Severity
            || item?.Severity
            || '';
        const band = normalizeSeverity(severityRaw) || 'very_low';
        counts[band] += 1;

        const related = Array.isArray(item.relatedVulnerabilities) ? item.relatedVulnerabilities : [];
        const cve = related.find((entry) => String(entry?.id || '').startsWith('CVE'))?.id
            || item?.vulnerability?.id
            || item?.RuleID
            || item?.ID
            || 'N/A';
        const desc = String(item?.vulnerability?.description || item?.Title || 'N/A')
            .replace(/\s+/g, ' ')
            .trim();
        const lib = item?.Target
            ? `${item.Target}${item.StartLine ? `:${item.StartLine}` : ''}`
            : `${item?.artifact?.name || 'N/A'}@${item?.artifact?.version || '?'}`;
        const fix = item?.matchDetails?.[0]?.fix?.suggestedVersion
            || item?.vulnerability?.fix?.versions?.[0]
            || '—';

        rows.push({
            band,
            cve,
            desc: desc.length > 80 ? `${desc.slice(0, 77)}...` : desc,
            lib,
            fix
        });
    }
    counts.total = matches.length;
    rows.sort((a, b) => bandLabel(a.band).order - bandLabel(b.band).order);
    return { counts, rows };
}

function bandLabel(band) {
    switch (band) {
        case 'critical': return { icon: '🔴', label: 'Very High', order: 1 };
        case 'high': return { icon: '🟠', label: 'High', order: 2 };
        case 'medium': return { icon: '🟡', label: 'Medium', order: 3 };
        case 'low': return { icon: '🔵', label: 'Low', order: 4 };
        default: return { icon: '⚪', label: 'Very Low', order: 5 };
    }
}

const BASELINE_HEADING = '### 🛡️ Veracode IaC / Secrets (Repo Baseline)';

function policyActive(policyStatus, policyName) {
    const name = String(policyName || '').trim();
    return Boolean(name) && name !== 'none' && !['', 'not_used', 'skipped'].includes(String(policyStatus || ''));
}

/** Findings normalizados ({severity, category, id, title, location, policy}) do results.json. */
function normalizedFindings(data, iacBaseline) {
    if (iacBaseline.isIacResults(data)) return iacBaseline.extractFindings(data);
    return countFromMatches(extractMatches(data)).rows.map((row) => ({
        severity: row.band, category: '', id: row.cve, title: row.desc, location: row.lib, policy: ''
    }));
}

/**
 * Card IaC no padrão único: com baseline comparado, os três grupos; sem baseline,
 * a linha de vulnerabilidades e, com política ativa, a das que afetam a política.
 * @param {{detailsLimit?: number, details?: boolean}} options
 */
function buildSummary({ jsonPath, policyStatus = 'not_used', policyName = '', baselineStatus = 'not_used', diffPath = '', details = true, detailsLimit, groups }) {
    // Carregado sob demanda: iac-baseline depende deste módulo.
    const iacBaseline = require('../iac-baseline/iac-baseline');
    const { ROW, severityTable, countBands } = require('../summary-table/severity-table');
    if (baselineStatus === 'compared') {
        const diff = readJson(diffPath);
        if (diff) return iacBaseline.renderComparedMarkdown(diff, { detailsLimit, groups });
    }
    const active = Boolean(baselineStatus) && baselineStatus !== 'not_used';
    const lines = [active ? BASELINE_HEADING : '### 🛡️ Veracode IaC / Secrets', ''];
    const withPolicy = policyActive(policyStatus, policyName);
    if (withPolicy) {
        lines.push(`**Política IaC:** ${String(policyName).replace(/[\r\n]/g, ' ').replace(/[`|]/g, '\\$&')}`, '');
    }
    const data = readJson(jsonPath || 'iac-results/results.json');
    if (!data) {
        return [...lines, '> ⚠️ Nenhum arquivo de resultado encontrado.', ''].join('\n') + '\n';
    }
    const findings = normalizedFindings(data, iacBaseline);
    const rows = [{ label: ROW.all, counts: countBands(findings) }];
    if (withPolicy) rows.push({ label: ROW.policy, counts: countBands(findings.filter((f) => f.policy === 'failed')) });
    lines.push(...severityTable(rows), '');
    if (details) lines.push(...iacBaseline.detailsBlock('Vulnerabilidades', findings, detailsLimit ?? iacBaseline.DETAILS_LIMIT));
    return `${lines.join('\n')}\n`;
}

if (require.main === module) {
    try {
        const cmd = process.argv[2] || 'summary-md';
        if (cmd !== 'summary-md') {
            throw new Error('Uso: node summary-findings.js summary-md [jsonPath]');
        }
        const md = buildSummary({
            jsonPath: process.argv[3] || process.env.IAC_JSON || 'iac-results/results.json',
            policyStatus: process.env.IAC_POLICY_STATUS || 'not_used',
            policyName: process.env.IAC_POLICY_NAME || '',
            baselineStatus: process.env.IAC_BASELINE_STATUS || 'not_used',
            diffPath: process.env.IAC_BASELINE_DIFF || ''
        });
        process.stdout.write(md);
        process.stderr.write(`${message('success', 'SUMMARY_WRITTEN')}\n`);
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    normalizeSeverity,
    extractMatches,
    countFromMatches,
    buildSummary,
    emptyCounts
};
