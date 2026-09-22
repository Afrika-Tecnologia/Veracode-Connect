'use strict';

/**
 * Planeja slots, classifica outcome e une results-K.json.
 *
 * Bash: node "$GITHUB_ACTION_PATH/merge-results.js" plan|retry-plan|merge
 */

const fs = require('fs');
const path = require('path');
const { message, fail } = require('./messages');

const MAX_SLOTS = 6;

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

function parseScanFiles(raw, fallback) {
    const files = [];
    const text = String(raw || '').trim();
    if (text) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item) {
                        files.push(String(item));
                    }
                }
            }
        } catch (_) {
            for (const item of text.split(/[\n,]/)) {
                const trimmed = item.trim();
                if (trimmed) {
                    files.push(trimmed);
                }
            }
        }
    }
    if (files.length === 0 && fallback) {
        files.push(String(fallback));
    }
    return files.filter(Boolean);
}

function parseMax(value) {
    const n = Number.parseInt(String(value == null || value === '' ? MAX_SLOTS : value), 10);
    if (!Number.isFinite(n) || n < 1) {
        return MAX_SLOTS;
    }
    return Math.min(n, MAX_SLOTS);
}

function appendOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        return;
    }
    fs.appendFileSync(out, `${name}=${value}\n`);
}

function appendMultilineOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        return;
    }
    const delimiter = `EOF_${name}`;
    fs.appendFileSync(out, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function planSlots({ scanFilesRaw, scanFile, maxArtifacts }) {
    const all = parseScanFiles(scanFilesRaw, scanFile);
    if (all.length === 0) {
        throw fail('NO_SCAN_FILES');
    }
    const limit = parseMax(maxArtifacts);
    const planned = all.slice(0, limit);
    for (let i = 1; i <= MAX_SLOTS; i++) {
        const file = planned[i - 1] || '';
        appendOutput(`file_${i}`, file);
        appendOutput(`label_${i}`, file ? path.basename(file) : '');
    }
    appendOutput('planned_count', String(planned.length));
    appendOutput('skipped_count', String(Math.max(0, all.length - planned.length)));
    return planned;
}

function resultsPath(workspace, slot) {
    return path.join(workspace, `results-${slot}.json`);
}

function filteredPath(workspace, slot) {
    return path.join(workspace, `filtered-${slot}.json`);
}

function summaryPath(workspace, slot) {
    return path.join(workspace, `results-${slot}.txt`);
}

const UNSCANNABLE_PATTERNS = [
    /no files found for scanning/i,
    /there are no results to analyze/i
];

function isUnscannableText(text) {
    const value = String(text || '');
    if (!value) {
        return false;
    }
    return UNSCANNABLE_PATTERNS.some((pattern) => pattern.test(value));
}

function scanMessageFromResults(results) {
    if (!results || typeof results !== 'object') {
        return '';
    }
    return [
        results.scan_message,
        results.scanMessage,
        results.message,
        results.scan_status_message,
        results.scanStatusMessage
    ].filter(Boolean).map(String).join('\n');
}

function readSummaryText(workspace, slot) {
    const filePath = summaryPath(workspace, slot);
    try {
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (_) {
        /* ignore */
    }
    return '';
}

function isUnscannableSlot(results, workspace, slot) {
    if (isUnscannableText(scanMessageFromResults(results))) {
        return true;
    }
    return isUnscannableText(readSummaryText(workspace, slot));
}

function isValidResults(data) {
    return Boolean(data) && data.scan_status === 'SUCCESS';
}

function emptySuccessResults() {
    return {
        scan_status: 'SUCCESS',
        findings: [],
        modules: [],
        modules_count: 0
    };
}

function classifySlot(workspace, slot) {
    const results = readJson(resultsPath(workspace, slot));
    const filtered = readJson(filteredPath(workspace, slot));
    if (!isValidResults(results)) {
        if (isUnscannableSlot(results, workspace, slot)) {
            return {
                classification: 'unscannable',
                results,
                filtered,
                scanId: results?.scan_id || '',
                scanStatus: results?.scan_status || 'UNSCANNABLE'
            };
        }
        return {
            classification: 'scan_error',
            results,
            filtered,
            scanId: results?.scan_id || '',
            scanStatus: results?.scan_status || 'MISSING'
        };
    }
    const filteredFindings = extractFindings(filtered);
    return {
        classification: filteredFindings.length > 0 ? 'policy' : 'sem_findings',
        results,
        filtered,
        scanId: results.scan_id || '',
        scanStatus: results.scan_status
    };
}

function retryPlan({ workspace, files }) {
    const retries = [];
    for (let i = 1; i <= MAX_SLOTS; i++) {
        const file = files[i - 1] || '';
        if (!file) {
            appendOutput(`retry_${i}`, '');
            continue;
        }
        const classified = classifySlot(workspace, i);
        if (classified.classification === 'scan_error') {
            appendOutput(`retry_${i}`, file);
            retries.push({ slot: i, file });
        } else {
            appendOutput(`retry_${i}`, '');
        }
    }
    appendOutput('needs_retry', retries.length > 0 ? 'true' : 'false');
    appendOutput('retry_count', String(retries.length));
    return retries;
}

function mergeScanDocuments(documents) {
    if (documents.length === 0) {
        return null;
    }
    const base = { ...documents[0] };
    const seen = new Set();
    const findings = [];
    const modules = [];
    const moduleSeen = new Set();
    for (const data of documents) {
        for (const finding of extractFindings(data)) {
            const key = findingKey(finding);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            findings.push(finding);
        }
        const list = Array.isArray(data.modules) ? data.modules : [];
        for (const mod of list) {
            if (moduleSeen.has(mod)) {
                continue;
            }
            moduleSeen.add(mod);
            modules.push(mod);
        }
    }
    base.findings = findings;
    base.modules = modules;
    base.modules_count = modules.length;
    return base;
}

function mergeSlots({ workspace, files, manifestPath }) {
    const scans = [];
    const validResults = [];
    const validFiltered = [];
    for (let i = 1; i <= MAX_SLOTS; i++) {
        const file = files[i - 1] || '';
        if (!file) {
            continue;
        }
        const classified = classifySlot(workspace, i);
        const attempt = fs.existsSync(resultsPath(workspace, i)) ? 1 : 0;
        scans.push({
            slot: i,
            artifact: path.basename(file),
            file,
            scan_id: classified.scanId,
            scan_status: classified.scanStatus,
            attempt: classified.classification === 'scan_error' ? attempt : Math.max(attempt, 1),
            findings: extractFindings(classified.results).length,
            classification: classified.classification
        });
        if (classified.classification === 'scan_error') {
            process.stdout.write(`::warning::${message('warning', 'SCAN_ERROR', { file: path.basename(file) })}\n`);
            continue;
        }
        if (classified.classification === 'unscannable') {
            process.stdout.write(`::warning::${message('warning', 'UNSCANNABLE', { file: path.basename(file) })}\n`);
            continue;
        }
        validResults.push(classified.results);
        if (classified.filtered) {
            validFiltered.push(classified.filtered);
        }
    }

    let mergedResults = mergeScanDocuments(validResults);
    const mergedFiltered = mergeScanDocuments(validFiltered) || { findings: [] };

    const scanErrorCount = scans.filter((item) => item.classification === 'scan_error').length;
    const unscannableCount = scans.filter((item) => item.classification === 'unscannable').length;
    const policyViolations = scans.filter((item) => item.classification === 'policy').length;
    const scannedCount = scans.filter((item) => (
        item.classification !== 'scan_error' && item.classification !== 'unscannable'
    )).length;
    const scanOutcome = scanErrorCount === 0 ? 'success' : 'failure';

    if (!mergedResults && scans.length > 0 && scanErrorCount === 0 && unscannableCount === scans.length) {
        mergedResults = emptySuccessResults();
        process.stdout.write(`::warning::${message('warning', 'ALL_UNSCANNABLE')}\n`);
    }

    if (mergedResults) {
        fs.writeFileSync(path.join(workspace, 'results.json'), `${JSON.stringify(mergedResults)}\n`);
    }
    fs.writeFileSync(path.join(workspace, 'filtered_results.json'), `${JSON.stringify(mergedFiltered)}\n`);

    const manifest = { scans };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const artifactsMd = scans.map((item) => {
        let mark = item.classification;
        if (item.classification === 'scan_error') {
            mark = 'erro';
        }
        return `- \`${item.artifact}\` — ${mark} (${item.findings} finding(s), scan_id=${item.scan_id || '—'})`;
    }).join('\n');

    appendOutput('scan_outcome', scanOutcome);
    appendOutput('scanned_count', String(scannedCount));
    appendOutput('scan_error_count', String(scanErrorCount));
    appendOutput('policy_violations', String(policyViolations));
    appendOutput('planned_count', String(scans.length));
    appendMultilineOutput('artifacts_md', artifactsMd);

    return {
        scanOutcome,
        scannedCount,
        scanErrorCount,
        unscannableCount,
        policyViolations,
        scans,
        mergedResults,
        mergedFiltered
    };
}

function slotFilesFromEnv() {
    const files = [];
    for (let i = 1; i <= MAX_SLOTS; i++) {
        files.push(process.env[`FILE_${i}`] || '');
    }
    return files;
}

if (require.main === module) {
    try {
        const cmd = process.argv[2];
        const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
        if (cmd === 'plan') {
            const planned = planSlots({
                scanFilesRaw: process.env.SCAN_FILES || '',
                scanFile: process.env.SCAN_FILE || '',
                maxArtifacts: process.env.MAX_ARTIFACTS || ''
            });
            process.stdout.write(message('success', 'PLAN_OK', { count: String(planned.length) }) + '\n');
        } else if (cmd === 'retry-plan') {
            const retries = retryPlan({
                workspace,
                files: slotFilesFromEnv()
            });
            if (retries.length === 0) {
                process.stdout.write(message('success', 'NO_RETRY') + '\n');
            } else {
                process.stdout.write(`::warning::${message('warning', 'RETRY_WAIT', {
                    seconds: '60',
                    count: String(retries.length)
                })}\n`);
            }
        } else if (cmd === 'merge') {
            const result = mergeSlots({
                workspace,
                files: slotFilesFromEnv(),
                manifestPath: process.env.MANIFEST_PATH
                    || path.join(workspace, '.veracode-connect', 'scans', 'manifest.json')
            });
            process.stdout.write(message('success', 'MERGE_OK', {
                scanned: String(result.scannedCount),
                errors: String(result.scanErrorCount),
                policy: String(result.policyViolations)
            }) + '\n');
        } else {
            throw fail('CLI_USAGE');
        }
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    MAX_SLOTS,
    readJson,
    extractFindings,
    findingKey,
    parseScanFiles,
    planSlots,
    classifySlot,
    isValidResults,
    isUnscannableText,
    retryPlan,
    mergeScanDocuments,
    mergeSlots
};
