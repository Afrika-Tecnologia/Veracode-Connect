'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const INCIDENT_CODES = new Set([
    'STEP_FAILED', 'SCAN_ERROR', 'RATE_LIMIT', 'UNSCANNABLE', 'RESULT_MISSING', 'NO_LIBRARIES_ANALYZED'
]);

function safeId(value, fallback = 'unknown') {
    const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    return clean || fallback;
}

function storageDir(env) {
    const id = safeId(env.VERACODE_CONNECT_LOG_ID, 'unknown-run');
    return path.join(env.RUNNER_TEMP || process.cwd(), 'veracode-connect-error-logs', id);
}

function isCurrentFile(filePath, startMarker, maxBytes = MAX_TEXT_BYTES) {
    const file = fs.statSync(filePath);
    return file.size <= maxBytes
        && (!startMarker || file.mtimeMs >= fs.statSync(startMarker).mtimeMs);
}

function readJson(filePath, startMarker) {
    try {
        if (!filePath) return null;
        if (fs.statSync(filePath).size > MAX_JSON_BYTES) return undefined;
        if (!isCurrentFile(filePath, startMarker, MAX_JSON_BYTES)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function failedSteps(component, raw) {
    const incidents = [];
    for (const line of String(raw || '').split(/\r?\n/)) {
        const [stage, outcome] = line.trim().split('=');
        if (outcome !== 'failure' || /^(slot|retry)_[1-6]$/.test(stage)) continue;
        incidents.push({ component, stage: safeId(stage), code: 'STEP_FAILED' });
    }
    return incidents;
}

function stepOutcome(raw, stage) {
    return String(raw || '').split(/\r?\n/)
        .find((line) => line.startsWith(`${stage}=`))?.slice(stage.length + 1);
}

function pipelineIncidents(filePath, workspace, startMarker, steps) {
    const manifest = readJson(filePath, startMarker);
    if (!manifest || !Array.isArray(manifest.scans)) return [];
    return manifest.scans.flatMap((scan) => {
        let code = scan.classification === 'scan_error' ? 'SCAN_ERROR'
            : scan.classification === 'unscannable' ? 'UNSCANNABLE' : null;
        const slot = Number(scan.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 6) return [];
        if (!code) {
            const retryOutcome = stepOutcome(steps, `retry_${slot}`);
            const finalStage = retryOutcome && retryOutcome !== 'skipped' ? `retry_${slot}` : `slot_${slot}`;
            return stepOutcome(steps, finalStage) === 'failure'
                ? [{ component: 'pipeline_scan_set', stage: finalStage, code: 'STEP_FAILED' }]
                : [];
        }
        if (code === 'SCAN_ERROR' && workspace) {
            try {
                const summaryPath = path.join(workspace, `results-${slot}.txt`);
                if (isCurrentFile(summaryPath, startMarker)) {
                    const summary = fs.readFileSync(summaryPath, 'utf8');
                    if (/\b429\b|rate.?limit|too many requests/i.test(summary)) code = 'RATE_LIMIT';
                }
            } catch {
                // The scan may fail before producing a summary file.
            }
        }
        return [{ component: 'pipeline_scan_set', stage: `slot_${slot}`, code }];
    });
}

function scaIncidents(filePath, textPath, startMarker) {
    const result = readJson(filePath, startMarker);
    if (result === undefined) return [];
    if (result && Array.isArray(result.records) && result.records.length > 0) {
        if (!result.records.some((record) => Array.isArray(record?.libraries) && record.libraries.length > 0)) {
            return [{ component: 'sca', stage: 'analysis', code: 'NO_LIBRARIES_ANALYZED' }];
        }
        return [];
    }
    try {
        if (textPath && isCurrentFile(textPath, startMarker)) {
            const text = fs.readFileSync(textPath, 'utf8');
            const match = text.match(/Total\s+Libraries\s+(\d+)/i);
            if (match) {
                return Number(match[1]) === 0
                    ? [{ component: 'sca', stage: 'analysis', code: 'NO_LIBRARIES_ANALYZED' }]
                    : [];
            }
        }
    } catch {
        // The JSON result is optional when the text result is available.
    }
    return [{ component: 'sca', stage: 'results', code: 'RESULT_MISSING' }];
}

function iacIncidents(filePath, startMarker) {
    const result = readJson(filePath, startMarker);
    if (result === undefined) return [];
    if (!result || typeof result !== 'object' || Array.isArray(result)
        || !(
            Array.isArray(result.vulnerabilities?.matches)
            || Array.isArray(result.matches)
            || Array.isArray(result.findings)
            || Array.isArray(result.results)
        )) {
        return [{ component: 'iac', stage: 'results', code: 'RESULT_MISSING' }];
    }
    return [];
}

function capture(env = process.env) {
    if (env.VERACODE_CONNECT_ERROR_LOGS !== 'true') return 0;
    const component = safeId(env.VC_COMPONENT);
    const incidents = failedSteps(component, env.VC_STEPS);
    const mergeOutcome = stepOutcome(env.VC_STEPS, 'merge');
    if (env.VC_SCAN_MANIFEST && (!mergeOutcome || mergeOutcome === 'success')) {
        incidents.push(...pipelineIncidents(env.VC_SCAN_MANIFEST, env.GITHUB_WORKSPACE, env.VERACODE_CONNECT_START_MARKER, env.VC_STEPS));
    }
    if (env.VC_SCA_RESULT) {
        incidents.push(...scaIncidents(env.VC_SCA_RESULT, env.VC_SCA_TEXT, env.VERACODE_CONNECT_START_MARKER));
    }
    if (env.VC_IAC_RESULT) incidents.push(...iacIncidents(env.VC_IAC_RESULT, env.VERACODE_CONNECT_START_MARKER));
    if (env.VC_PIPELINE_RESULT && stepOutcome(env.VC_STEPS, 'pipeline_set') === 'success'
        && env.VC_SCAN_ERROR_COUNT === '0') {
        const result = readJson(env.VC_PIPELINE_RESULT, env.VERACODE_CONNECT_START_MARKER);
        if (result === null || (result !== undefined && !Array.isArray(result.findings))) {
            incidents.push({ component, stage: 'results', code: 'RESULT_MISSING' });
        }
    }
    if (incidents.length === 0) return 0;
    const dir = storageDir(env);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'incidents.jsonl'), incidents.map((item) => JSON.stringify(item)).join('\n') + '\n');
    return incidents.length;
}

function finalize(env = process.env) {
    if (env.VERACODE_CONNECT_ERROR_LOGS !== 'true') return null;
    const dir = storageDir(env);
    const eventsPath = path.join(dir, 'incidents.jsonl');
    if (!fs.existsSync(eventsPath)) return null;
    if (fs.statSync(eventsPath).size > 2 * 1024 * 1024) return null;
    const seen = new Set();
    const incidents = [];
    for (const line of fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/)) {
        if (!line) continue;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (!event || typeof event !== 'object'
            || typeof event.component !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(event.component)
            || typeof event.stage !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(event.stage)
            || !INCIDENT_CODES.has(event.code)) continue;
        const key = `${event.component}/${event.stage}/${event.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        incidents.push({ component: event.component, stage: event.stage, code: event.code });
    }
    if (incidents.length === 0) return null;
    const outputPath = path.join(dir, 'diagnostic.json');
    fs.writeFileSync(outputPath, JSON.stringify({
        schema_version: SCHEMA_VERSION,
        repository: String(env.GITHUB_REPOSITORY || ''),
        run_id: String(env.GITHUB_RUN_ID || ''),
        run_attempt: String(env.GITHUB_RUN_ATTEMPT || ''),
        job: String(env.GITHUB_JOB || ''),
        commit: String(env.GITHUB_SHA || ''),
        incidents
    }, null, 2) + '\n');
    return outputPath;
}

if (require.main === module) {
    try {
        const command = process.argv[2];
        if (command === 'capture') {
            capture();
        } else if (command === 'finalize') {
            const filePath = finalize();
            if (filePath && process.env.GITHUB_OUTPUT) {
                fs.appendFileSync(process.env.GITHUB_OUTPUT, `path=${filePath}\n`);
            }
        } else {
            throw new Error('Expected capture or finalize');
        }
    } catch (error) {
        process.stderr.write(`::warning::Veracode Connect error diagnostics failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { capture, finalize, failedSteps, pipelineIncidents, scaIncidents, iacIncidents };
