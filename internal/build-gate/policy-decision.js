'use strict';

const fs = require('node:fs');

function count(raw) {
    if (!/^\d+$/.test(String(raw))) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : null;
}

function isCurrentScanResult(resultPath, markerPath) {
    if (!resultPath || !markerPath) return false;
    try {
        const marker = fs.statSync(markerPath);
        const result = fs.statSync(resultPath);
        if (!marker.isFile() || !result.isFile() || result.mtimeMs < marker.mtimeMs || result.size > 64 * 1024 * 1024) return false;
        const document = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        return document !== null && typeof document === 'object' && !Array.isArray(document) && Array.isArray(document.findings);
    } catch {
        return false;
    }
}

function hasPolicyFailure({ policyFail, scanErrorCount, policyViolations, plannedCount, scannedCount, flowOutcome, resultAvailable }) {
    const violations = count(policyViolations);
    const planned = count(plannedCount);
    return policyFail === 'true'
        && resultAvailable === true
        && flowOutcome === 'success'
        && count(scanErrorCount) === 0
        && planned !== null && planned > 0 && count(scannedCount) === planned
        && violations !== null
        && violations > 0;
}

function shouldBlockPolicy(decision) {
    return decision.failBuild === 'true' && hasPolicyFailure(decision);
}

if (require.main === module) {
    const decision = {
        failBuild: process.env.FAIL_BUILD,
        policyFail: process.env.POLICY_FAIL,
        scanErrorCount: process.env.SCAN_ERROR_COUNT,
        policyViolations: process.env.POLICY_VIOLATIONS,
        plannedCount: process.env.PLANNED_COUNT,
        scannedCount: process.env.SCANNED_COUNT,
        flowOutcome: process.env.FLOW_OUTCOME,
        resultAvailable: isCurrentScanResult(process.env.PIPELINE_RESULT, process.env.START_MARKER)
    };
    const blocked = shouldBlockPolicy(decision);
    const policyPresent = hasPolicyFailure(decision);
    const scanErrors = count(decision.scanErrorCount);
    const planned = count(decision.plannedCount);
    const scanned = count(decision.scannedCount);
    const incomplete = planned !== null && planned > 0 && scanned !== planned;
    const technical = (scanErrors !== null && scanErrors > 0)
        || incomplete
        || decision.flowOutcome === 'failure'
        || (planned !== null && planned > 0 && !decision.resultAvailable);
    const scanStatus = blocked ? 'failure'
        : policyPresent || technical ? 'warning' : '';
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT,
            `blocked=${blocked}\npolicy_present=${policyPresent}\nscan_status=${scanStatus}\n`);
    }
    process.stdout.write(`policy_blocked=${blocked}; policy_present=${policyPresent}\n`);
}

module.exports = { hasPolicyFailure, isCurrentScanResult, shouldBlockPolicy };
