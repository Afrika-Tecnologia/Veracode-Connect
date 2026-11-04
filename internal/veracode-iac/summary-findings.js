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

function tableCell(value) {
    return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|');
}

function policyLabel(policyStatus) {
    if (policyStatus === 'passed') return '✅ Passou';
    if (policyStatus === 'failed') return '❌ Não passou';
    if (policyStatus === 'deferred') return '⏸️ Não bloqueia (sem baseline IaC)';
    return '⚠️ Não avaliada';
}

const BASELINE_HEADING = '### 🛡️ Veracode IaC / Secrets (Repo Baseline)';

/** Nota exibida quando o baseline IaC está ativo, mas não foi comparado nesta execução. */
function baselineNote({ baselineStatus, canSeed }) {
    if (baselineStatus === 'seeded') {
        return '> 🆕 Sem baseline IaC: baseline gravado após este scan. A política IaC passa a bloquear findings novos a partir da próxima execução.';
    }
    if (baselineStatus === 'deferred') {
        if (canSeed === 'true') {
            return '> ⚠️ Sem baseline IaC: o baseline não foi gravado (scan sem resultado válido ou falha na gravação). A política IaC não bloqueia nesta execução.';
        }
        if (canSeed === 'false') {
            return '> ⚠️ Sem baseline IaC: o baseline só é gravado na default_branch ou em PR destinado a ela. A política IaC não bloqueia nesta execução.';
        }
        return '> ⚠️ Sem baseline IaC: a política IaC não bloqueia nesta execução.';
    }
    if (baselineStatus === 'error') {
        return '> ⚠️ Baseline IaC indisponível nesta execução (leitura falhou, baseline ilegível ou scan inválido). A política IaC não bloqueia.';
    }
    return '';
}

function policyLine(policyStatus, policyName) {
    if (!policyStatus || policyStatus === 'not_used' || policyStatus === 'skipped') return '';
    const safeName = String(policyName || '').replace(/[\r\n]/g, ' ').replace(/[`|]/g, '\\$&');
    return `**Política IaC${safeName ? ` (${safeName})` : ''}:** ${policyLabel(policyStatus)}`;
}

function headerLines(policyStatus, policyName, baseline = {}) {
    const active = Boolean(baseline.baselineStatus) && baseline.baselineStatus !== 'not_used';
    const lines = [active ? BASELINE_HEADING : '### 🛡️ Veracode IaC / Secrets', ''];
    const note = active ? baselineNote(baseline) : '';
    if (note) lines.push(note, '');
    const policy = policyLine(policyStatus, policyName);
    if (policy) lines.push(policy, '');
    return lines;
}

function renderMarkdown(counts, rows, policyStatus, policyName, baseline = {}) {
    const lines = headerLines(policyStatus, policyName, baseline);
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
        lines.push('| # | Severidade | CVE / ID | Descrição | Biblioteca / Arquivo | Fix |');
        lines.push('|---|---|---|---|---|---|');
        rows.forEach((row, index) => {
            const { icon, label } = bandLabel(row.band);
            lines.push(`| ${index + 1} | ${icon} ${label} | ${tableCell(row.cve)} | ${tableCell(row.desc)} | ${tableCell(row.lib)} | ${tableCell(row.fix)} |`);
        });
        lines.push('');
        lines.push('</details>');
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

function buildSummary({ jsonPath, policyStatus = 'not_used', policyName = '', baselineStatus = 'not_used', diffPath = '', canSeed = '' }) {
    if (baselineStatus === 'compared') {
        const diff = readJson(diffPath);
        if (diff) {
            // Carregado sob demanda: iac-baseline depende deste módulo.
            return require('../iac-baseline/iac-baseline').renderComparedMarkdown(diff);
        }
    }
    const baseline = { baselineStatus, canSeed };
    const filePath = jsonPath || 'iac-results/results.json';
    const data = readJson(filePath);
    if (!data) {
        return [
            ...headerLines(policyStatus, policyName, baseline),
            '> ⚠️ Nenhum arquivo de resultado encontrado.',
            ''
        ].join('\n') + '\n';
    }
    const matches = extractMatches(data);
    const parsed = countFromMatches(matches);
    return renderMarkdown(parsed.counts, parsed.rows, policyStatus, policyName, baseline);
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
            diffPath: process.env.IAC_BASELINE_DIFF || '',
            canSeed: process.env.IAC_BASELINE_CAN_SEED || ''
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
    policyLabel,
    baselineNote,
    emptyCounts
};
