'use strict';

/**
 * Contagens e markdown SAST a partir do JSON do Pipeline Scan.
 *
 * Com baseline, os findings são separados em três grupos, como no IaC:
 * - novos que afetam a política: `filtered_results.json` da action oficial
 *   (findings que violam os critérios de pass/fail após o filtro do baseline;
 *   lista vazia = nenhum bloqueante);
 * - novos que não afetam: fora do baseline (por `flaw_match`) e fora do filtrado;
 * - backlog: os demais, já presentes no baseline.
 *
 * Bash: node "$GITHUB_ACTION_PATH/sast-findings.js" summary-md \
 *         --results results.json [--baseline baseline.json] \
 *         [--filtered filtered_results.json] [--split true]
 */

const fs = require('fs');

const SEV_LABEL = {
    5: '🔴 Very High',
    4: '🟠 High',
    3: '🟡 Medium',
    2: '🔵 Low',
    1: '⚪ Very Low'
};

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

function extractFindings(data) {
    if (!data) {
        return [];
    }
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data.findings)) {
        return data.findings;
    }
    if (Array.isArray(data.scanResult?.findings)) {
        return data.scanResult.findings;
    }
    if (Array.isArray(data.scan_result?.findings)) {
        return data.scan_result.findings;
    }
    if (Array.isArray(data.results?.findings)) {
        return data.results.findings;
    }
    if (Array.isArray(data.results?.scanResult?.findings)) {
        return data.results.scanResult.findings;
    }
    return [];
}

function severityNumber(finding) {
    const n = Number(finding?.severity);
    return Number.isFinite(n) ? n : -1;
}

function countBySeverity(findings) {
    const counts = { veryHigh: 0, high: 0, medium: 0, low: 0, veryLow: 0, total: findings.length };
    for (const finding of findings) {
        const severity = severityNumber(finding);
        if (severity === 5) {
            counts.veryHigh += 1;
        } else if (severity === 4) {
            counts.high += 1;
        } else if (severity === 3) {
            counts.medium += 1;
        } else if (severity === 2) {
            counts.low += 1;
        } else if (severity >= 0 && severity <= 1) {
            counts.veryLow += 1;
        }
    }
    return counts;
}

function findingKey(finding) {
    const match = finding?.flaw_match
        || (Array.isArray(finding?.flaw_matches) ? finding.flaw_matches[0] : null)
        || {};
    if (match.flaw_hash != null && String(match.flaw_hash) !== '') {
        return [
            match.procedure_hash ?? '',
            match.prototype_hash ?? '',
            match.flaw_hash,
            match.flaw_hash_ordinal ?? 1,
            match.cause_hash ?? '',
            match.cause_hash_ordinal ?? ''
        ].join(':');
    }
    const source = finding?.files?.source_file || {};
    return [
        finding?.cwe_id ?? '',
        finding?.issue_id ?? '',
        finding?.issue_type_id ?? '',
        source.file ?? '',
        source.line ?? '',
        finding?.title ?? ''
    ].join('|');
}

function splitNovas(scanFindings, baselineFindings) {
    if (!baselineFindings.length) {
        return scanFindings.slice();
    }
    const known = new Set(baselineFindings.map(findingKey));
    return scanFindings.filter((finding) => !known.has(findingKey(finding)));
}

/** Separa o scan em novos que afetam a política, novos que não afetam e backlog. */
function classifyFindings(scanFindings, baselineFindings, filteredFindings) {
    const pending = new Map();
    for (const finding of filteredFindings) {
        const key = findingKey(finding);
        pending.set(key, (pending.get(key) || 0) + 1);
    }
    const newKeys = new Set(splitNovas(scanFindings, baselineFindings).map(findingKey));
    const groups = { newPolicy: filteredFindings.slice(), newOther: [], backlog: [] };
    for (const finding of scanFindings) {
        const key = findingKey(finding);
        if (pending.get(key) > 0) {
            pending.set(key, pending.get(key) - 1);
            continue;
        }
        (newKeys.has(key) ? groups.newOther : groups.backlog).push(finding);
    }
    return groups;
}

function loadFindings(filePath) {
    return extractFindings(readJson(filePath));
}

function cell(value) {
    const text = value == null || value === '' ? 'N/A' : String(value);
    return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function severityLabel(finding) {
    return SEV_LABEL[severityNumber(finding)] || 'ℹ️ Info';
}

function countTable(heading, counts) {
    return [
        `#### ${heading}`,
        '',
        '| Severidade | Quantidade |',
        '|---|---|',
        `| 🔴 Very High | ${counts.veryHigh} |`,
        `| 🟠 High | ${counts.high} |`,
        `| 🟡 Medium | ${counts.medium} |`,
        `| 🔵 Low | ${counts.low} |`,
        `| ⚪ Very Low | ${counts.veryLow} |`,
        `| **Total** | **${counts.total}** |`,
        ''
    ].join('\n');
}

function groupsTable(groups) {
    const row = (label, findings) => {
        const c = countBySeverity(findings);
        return `| ${label} | ${c.veryHigh} | ${c.high} | ${c.medium} | ${c.low} | ${c.veryLow} | **${c.total}** |`;
    };
    return [
        '| Grupo | 🔴 Very High | 🟠 High | 🟡 Medium | 🔵 Low | ⚪ Very Low | Total |',
        '|---|---|---|---|---|---|---|',
        row('❌ Novos (afetam a política)', groups.newPolicy),
        row('🆕 Novos (não afetam)', groups.newOther),
        row('📦 Backlog', groups.backlog),
        ''
    ].join('\n');
}

function detailsTable(heading, findings) {
    if (!findings.length) {
        return '';
    }
    const sorted = findings.slice().sort((a, b) => severityNumber(b) - severityNumber(a));
    const rows = sorted.map((finding, index) => {
        const source = finding?.files?.source_file || {};
        const cwe = finding?.cwe_id != null ? `CWE-${finding.cwe_id}` : 'N/A';
        return `| ${index + 1} | ${severityLabel(finding)} | ${cell(cwe)} | ${cell(finding?.title)} | ${cell(source.file)} | ${cell(source.line)} |`;
    });
    return [
        `<details><summary>${heading} (${findings.length})</summary>`,
        '',
        '| # | Severidade | CWE | Título | Arquivo | Linha |',
        '|---|---|---|---|---|---|',
        ...rows,
        '',
        '</details>',
        ''
    ].join('\n');
}

function buildSummaryMarkdown({ resultsPath, baselinePath, filteredPath, split }) {
    const scanFindings = loadFindings(resultsPath);
    if (!resultsPath || !fs.existsSync(resultsPath)) {
        return '> ⚠️ Arquivo results.json não encontrado.\n';
    }

    if (!split) {
        const counts = countBySeverity(scanFindings);
        return [
            countTable('SAST - Vulnerabilidades', counts),
            detailsTable('Detalhamento de Vulnerabilidades', scanFindings)
        ].filter(Boolean).join('\n');
    }

    const baselineFindings = loadFindings(baselinePath);
    const filteredData = readJson(filteredPath);
    if (!filteredData) {
        return [
            '> ⚠️ Resultado filtrado da política indisponível; não foi possível determinar as vulnerabilidades bloqueantes.\n',
            countTable('SAST - Todas Vulnerabilidades', countBySeverity(scanFindings)),
            detailsTable('Detalhamento de Todas Vulnerabilidades', scanFindings)
        ].filter(Boolean).join('\n');
    }
    const groups = classifyFindings(scanFindings, baselineFindings, extractFindings(filteredData));

    return [
        groupsTable(groups),
        detailsTable('Novos que afetam a política', groups.newPolicy),
        detailsTable('Novos que não afetam a política', groups.newOther),
        detailsTable('Backlog', groups.backlog)
    ].filter(Boolean).join('\n');
}

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token.startsWith('--') && i + 1 < argv.length) {
            args[token.slice(2)] = argv[i + 1];
            i += 1;
        } else {
            args._.push(token);
        }
    }
    return args;
}

if (require.main === module) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const cmd = args._[0];
        if (cmd !== 'summary-md') {
            throw new Error('Uso: node sast-findings.js summary-md --results FILE [--baseline FILE] [--filtered FILE] [--split true]');
        }
        const markdown = buildSummaryMarkdown({
            resultsPath: args.results,
            baselinePath: args.baseline,
            filteredPath: args.filtered,
            split: args.split === 'true'
        });
        process.stdout.write(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    readJson,
    extractFindings,
    severityNumber,
    countBySeverity,
    findingKey,
    splitNovas,
    classifyFindings,
    loadFindings,
    buildSummaryMarkdown
};
