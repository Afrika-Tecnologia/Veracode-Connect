'use strict';

/**
 * Contagens e markdown SCA a partir de scaResults.json ou scaResults.txt.
 *
 * Bash: node "$GITHUB_ACTION_PATH/summary-findings.js" summary-md [jsonPath] [txtPath]
 */

const fs = require('fs');
const path = require('path');
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

function cvssBand(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) {
        return null;
    }
    if (n >= 9) {
        return 'critical';
    }
    if (n >= 7) {
        return 'high';
    }
    if (n >= 4) {
        return 'medium';
    }
    if (n >= 0.1) {
        return 'low';
    }
    return 'very_low';
}

function emptyCounts() {
    return {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        very_low: 0,
        total: 0,
        libraries: 0,
        direct: 0,
        vulnerable_libraries: 0
    };
}

function countFromJson(data) {
    const counts = emptyCounts();
    const record = Array.isArray(data?.records) ? data.records[0] : null;
    if (!record) {
        return { counts, vulns: [] };
    }

    const libraries = Array.isArray(record.libraries) ? record.libraries : [];
    const vulns = Array.isArray(record.vulnerabilities) ? record.vulnerabilities : [];
    const vulnLibIds = new Set();
    const detailRows = [];

    for (const vuln of vulns) {
        const band = cvssBand(vuln.cvss3Score ?? vuln.cvssScore);
        if (band) {
            counts[band] += 1;
        }
        const libLabels = [];
        for (const lib of vuln.libraries || []) {
            const ref = lib?._links?.ref || '';
            const match = String(ref).match(/libraries\/(\d+)/);
            let label = '';
            if (match) {
                vulnLibIds.add(match[1]);
                const idx = Number.parseInt(match[1], 10);
                const named = libraries[idx];
                if (named?.name) {
                    const verMatch = String(ref).match(/versions\/(\d+)/);
                    const verIdx = verMatch ? Number.parseInt(verMatch[1], 10) : 0;
                    const version = named.versions?.[verIdx]?.version;
                    label = version ? `${named.name}@${version}` : named.name;
                }
            }
            const details = Array.isArray(lib.details) ? lib.details[0] : null;
            if (!label && details?.versionRange) {
                label = details.versionRange;
            }
            if (label) {
                libLabels.push(label);
            }
        }
        const score = vuln.cvss3Score ?? vuln.cvssScore;
        const cve = vuln.exploitability?.cveFull
            || (vuln.cve ? `CVE-${String(vuln.cve).replace(/^CVE-/i, '')}` : 'NO-CVE');
        detailRows.push({
            band: band || 'very_low',
            score: Number(score) || 0,
            cve,
            title: String(vuln.title || vuln.overview || '').replace(/\s+/g, ' ').trim(),
            library: libLabels.join(', ') || '—'
        });
    }

    counts.total = counts.critical + counts.high + counts.medium + counts.low + counts.very_low;
    counts.libraries = Array.isArray(record.libraries) ? record.libraries.length : 0;
    counts.vulnerable_libraries = vulnLibIds.size;

    let direct = 0;
    for (const graph of record.graphs || []) {
        direct += Array.isArray(graph.directs) ? graph.directs.length : 0;
    }
    counts.direct = direct;

    detailRows.sort((a, b) => {
        const order = { critical: 1, high: 2, medium: 3, low: 4, very_low: 5 };
        return (order[a.band] - order[b.band]) || (b.score - a.score);
    });

    return { counts, vulns: detailRows };
}

function grepCount(text, pattern) {
    const match = text.match(pattern);
    return match ? Number.parseInt(match[1], 10) || 0 : 0;
}

function countFromText(text) {
    const counts = emptyCounts();
    counts.critical = grepCount(text, /Critical\s+Risk\s+Vulnerabilities\s+(\d+)/i);
    counts.high = grepCount(text, /High\s+Risk\s+Vulnerabilities\s+(\d+)/i);
    counts.medium = grepCount(text, /Medium\s+Risk\s+Vulnerabilities\s+(\d+)/i);
    counts.low = grepCount(text, /(?<!Very )Low\s+Risk\s+Vulnerabilities\s+(\d+)/i);
    counts.very_low = grepCount(text, /Very Low\s+Risk\s+Vulnerabilities\s+(\d+)/i);
    counts.total = counts.critical + counts.high + counts.medium + counts.low + counts.very_low;
    counts.libraries = grepCount(text, /Total\s+Libraries\s+(\d+)/i);
    counts.direct = grepCount(text, /Direct\s+Libraries\s+(\d+)/i);
    counts.vulnerable_libraries = grepCount(text, /Vulnerable\s+Libraries\s+(\d+)/i);

    const detailRows = [];
    for (const line of String(text).split(/\r?\n/)) {
        const trimmed = line.trim();
        const match = trimmed.match(/^(CVE-\S+|NO-CVE)\s+(\S+(?:\s+\S+)?)\s+(.*?)\s{2,}(\S.*)?$/i)
            || trimmed.match(/^(CVE-\S+|NO-CVE)\s+(Critical|High|Medium|Very Low|Low)\s+(.*)$/i);
        if (!match) {
            continue;
        }
        const sev = match[2] || '';
        let band = 'very_low';
        if (/Critical/i.test(sev)) {
            band = 'critical';
        } else if (/High/i.test(sev)) {
            band = 'high';
        } else if (/Medium/i.test(sev)) {
            band = 'medium';
        } else if (/Very\s*Low/i.test(sev)) {
            band = 'very_low';
        } else if (/Low/i.test(sev)) {
            band = 'low';
        }
        detailRows.push({
            band,
            score: 0,
            cve: match[1],
            title: String(match[3] || '').trim(),
            library: String(match[4] || '—').trim()
        });
    }
    return { counts, vulns: detailRows };
}

function bandLabel(band) {
    switch (band) {
        case 'critical': return { icon: '🔴', label: 'Very High' };
        case 'high': return { icon: '🟠', label: 'High' };
        case 'medium': return { icon: '🟡', label: 'Medium' };
        case 'low': return { icon: '🔵', label: 'Low' };
        default: return { icon: '⚪', label: 'Very Low' };
    }
}

function renderMarkdown(counts, vulns, { createIssues }) {
    const lines = [];
    lines.push('### 🔍 Veracode SCA (Software Composition Analysis)');
    lines.push('');
    if (createIssues) {
        lines.push('> 📝 Issues GitHub: **habilitado** (`create_issues: true`)');
        lines.push('');
    }
    lines.push('| Severidade | Quantidade |');
    lines.push('|---|---|');
    lines.push(`| 🔴 Very High | ${counts.critical} |`);
    lines.push(`| 🟠 High | ${counts.high} |`);
    lines.push(`| 🟡 Medium | ${counts.medium} |`);
    lines.push(`| 🔵 Low | ${counts.low} |`);
    lines.push(`| ⚪ Very Low | ${counts.very_low} |`);
    lines.push(`| **Total Vulnerabilidades** | **${counts.total}** |`);
    lines.push(`| Bibliotecas vulneráveis | ${counts.vulnerable_libraries} |`);
    lines.push(`| Total de bibliotecas analisadas | ${counts.libraries} |`);
    lines.push(`| Bibliotecas diretas | ${counts.direct} |`);
    const transitive = Math.max(0, (counts.libraries || 0) - (counts.direct || 0));
    lines.push(`| Bibliotecas transitivas | ${transitive} |`);
    lines.push('');

    if (vulns.length > 0) {
        lines.push(`<details><summary>Detalhamento de SCA (${vulns.length})</summary>`);
        lines.push('');
        lines.push('| # | Severidade | CVE | Descrição | Biblioteca |');
        lines.push('|---|---|---|---|---|');
        vulns.forEach((row, index) => {
            const { icon, label } = bandLabel(row.band);
            const desc = row.title.length > 80 ? `${row.title.slice(0, 77)}...` : row.title;
            lines.push(`| ${index + 1} | ${icon} ${label} | ${row.cve} | ${desc || '—'} | ${row.library || '—'} |`);
        });
        lines.push('');
        lines.push('</details>');
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

function resolveInputs(jsonPath, txtPath) {
    const json = jsonPath || 'scaResults.json';
    const txt = txtPath || 'scaResults.txt';
    const log = 'veracode_sca.log';
    return { json, txt, log };
}

function buildSummary({ jsonPath, txtPath, createIssues }) {
    const paths = resolveInputs(jsonPath, txtPath);
    const jsonData = readJson(paths.json);
    if (jsonData?.records) {
        const parsed = countFromJson(jsonData);
        return renderMarkdown(parsed.counts, parsed.vulns, { createIssues });
    }

    let text = '';
    for (const candidate of [paths.txt, paths.log]) {
        if (candidate && fs.existsSync(candidate)) {
            text = fs.readFileSync(candidate, 'utf8');
            if (text.trim().startsWith('{')) {
                const parsedJson = readJson(candidate);
                if (parsedJson?.records) {
                    const parsed = countFromJson(parsedJson);
                    return renderMarkdown(parsed.counts, parsed.vulns, { createIssues });
                }
                continue;
            }
            if (/Risk\s+Vulnerabilities/i.test(text) || /^\s*(CVE-\S+|NO-CVE)\s+/m.test(text)) {
                const parsed = countFromText(text);
                return renderMarkdown(parsed.counts, parsed.vulns, { createIssues });
            }
        }
    }

    const lines = [
        '### 🔍 Veracode SCA (Software Composition Analysis)',
        '',
        '> ⚠️ Nenhum artefato de resultado SCA encontrado.',
        ''
    ];
    return `${lines.join('\n')}\n`;
}

if (require.main === module) {
    try {
        const cmd = process.argv[2] || 'summary-md';
        if (cmd !== 'summary-md') {
            throw new Error('Uso: node summary-findings.js summary-md [jsonPath] [txtPath]');
        }
        const md = buildSummary({
            jsonPath: process.argv[3] || process.env.SCA_JSON || 'scaResults.json',
            txtPath: process.argv[4] || process.env.SCA_TXT || 'scaResults.txt',
            createIssues: String(process.env.CREATE_ISSUES || '').toLowerCase() === 'true'
        });
        process.stdout.write(md);
        process.stderr.write(`${message('success', 'SUMMARY_WRITTEN')}\n`);
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    cvssBand,
    countFromJson,
    countFromText,
    buildSummary,
    renderMarkdown,
    emptyCounts
};
