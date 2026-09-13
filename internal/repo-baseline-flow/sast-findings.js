'use strict';

/**
 * Contagens e markdown SAST a partir do JSON do Pipeline Scan.
 *
 * `filtered_results.json` da action oficial é o recorte de pass/fail
 * (muitas vezes `{"findings":[]}` com baseline), não a lista de novas.
 * Novas = findings de results.json que não estão no baseline.json,
 * identificados por flaw_match (hashes da Veracode).
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
    const counts = { veryHigh: 0, high: 0, medium: 0, low: 0, total: findings.length };
    for (const finding of findings) {
        const severity = severityNumber(finding);
        if (severity === 5) {
            counts.veryHigh += 1;
        } else if (severity === 4) {
            counts.high += 1;
        } else if (severity === 3) {
            counts.medium += 1;
        } else if (severity >= 0 && severity <= 2) {
            counts.low += 1;
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

function resolveNovas(scanFindings, baselineFindings, filteredFindings) {
    if (baselineFindings.length > 0) {
        return splitNovas(scanFindings, baselineFindings);
    }
    if (filteredFindings.length > 0) {
        return filteredFindings;
    }
    return [];
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
        `| 🔵 Low / Very Low | ${counts.low} |`,
        `| **Total** | **${counts.total}** |`,
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
            countTable('Vulnerabilidades', counts),
            detailsTable('📋 Detalhes das vulnerabilidades', scanFindings)
        ].filter(Boolean).join('\n');
    }

    const baselineFindings = loadFindings(baselinePath);
    const filteredFindings = loadFindings(filteredPath);
    const novas = resolveNovas(scanFindings, baselineFindings, filteredFindings);

    return [
        countTable('Novas (pós-baseline)', countBySeverity(novas)),
        countTable('Todas (este scan)', countBySeverity(scanFindings)),
        detailsTable('📋 Novas (não presentes no baseline)', novas),
        detailsTable('📋 Todas as vulnerabilidades do scan', scanFindings)
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
    resolveNovas,
    loadFindings,
    buildSummaryMarkdown
};
