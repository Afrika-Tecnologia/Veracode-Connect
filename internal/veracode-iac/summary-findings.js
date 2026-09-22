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
    if (Array.isArray(data.vulnerabilities?.matches)) {
        return data.vulnerabilities.matches;
    }
    if (Array.isArray(data.matches)) {
        return data.matches;
    }
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data.findings)) {
        return data.findings;
    }
    if (Array.isArray(data.results)) {
        return data.results;
    }
    return [];
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

function countFromMatches(matches) {
    const counts = emptyCounts();
    const rows = [];
    for (const item of matches) {
        const severityRaw = item?.vulnerability?.severity
            || item?.severity
            || item?.Vulnerability?.Severity
            || '';
        const band = normalizeSeverity(severityRaw) || 'very_low';
        counts[band] += 1;

        const related = Array.isArray(item.relatedVulnerabilities) ? item.relatedVulnerabilities : [];
        const cve = related.find((entry) => String(entry?.id || '').startsWith('CVE'))?.id
            || item?.vulnerability?.id
            || 'N/A';
        const desc = String(item?.vulnerability?.description || 'N/A')
            .replace(/\s+/g, ' ')
            .trim();
        const lib = `${item?.artifact?.name || 'N/A'}@${item?.artifact?.version || '?'}`;
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

function renderMarkdown(counts, rows) {
    const lines = [];
    lines.push('### 🛡️ Veracode IaC / Secrets');
    lines.push('');
    lines.push('| Severidade | Quantidade |');
    lines.push('|---|---|');
    lines.push(`| 🔴 Very High | ${counts.critical} |`);
    lines.push(`| 🟠 High | ${counts.high} |`);
    lines.push(`| 🟡 Medium | ${counts.medium} |`);
    lines.push(`| 🔵 Low | ${counts.low} |`);
    lines.push(`| ⚪ Very Low | ${counts.very_low} |`);
    lines.push(`| **Total Findings** | **${counts.total}** |`);
    lines.push('');

    if (rows.length > 0) {
        lines.push(`<details><summary>Detalhamento de IaC / Secrets (${rows.length})</summary>`);
        lines.push('');
        lines.push('| # | Severidade | CVE / ID | Descrição | Biblioteca | Fix |');
        lines.push('|---|---|---|---|---|---|');
        rows.forEach((row, index) => {
            const { icon, label } = bandLabel(row.band);
            lines.push(`| ${index + 1} | ${icon} ${label} | ${row.cve} | ${row.desc} | ${row.lib} | ${row.fix} |`);
        });
        lines.push('');
        lines.push('</details>');
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

function buildSummary({ jsonPath }) {
    const filePath = jsonPath || 'iac-results/results.json';
    const data = readJson(filePath);
    if (!data) {
        return [
            '### 🛡️ Veracode IaC / Secrets',
            '',
            '> ⚠️ Nenhum arquivo de resultado encontrado.',
            ''
        ].join('\n') + '\n';
    }
    const matches = extractMatches(data);
    const parsed = countFromMatches(matches);
    return renderMarkdown(parsed.counts, parsed.rows);
}

if (require.main === module) {
    try {
        const cmd = process.argv[2] || 'summary-md';
        if (cmd !== 'summary-md') {
            throw new Error('Uso: node summary-findings.js summary-md [jsonPath]');
        }
        const md = buildSummary({
            jsonPath: process.argv[3] || process.env.IAC_JSON || 'iac-results/results.json'
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
