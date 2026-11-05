'use strict';

const fs = require('node:fs');

// The official action can fail before scanning, or write only a technical error.
// Require analyzed libraries before treating its failure as a blocking SCA result.
function hasScanResults() {
    for (const file of ['scaResults.json', 'scaResults.txt']) {
        try {
            const text = fs.readFileSync(file, 'utf8');
            try {
                const data = JSON.parse(text);
                if (Array.isArray(data?.records) && data.records.some(record =>
                    Array.isArray(record?.libraries) && record.libraries.length > 0)) return true;
            } catch {
                if (/Total\s+Libraries\s+[1-9]\d*\b/i.test(text)
                    && /Risk\s+Vulnerabilities\s+\d+\b/i.test(text)) return true;
            }
        } catch {
            // Missing/unreadable artifacts do not establish a completed scan.
        }
    }
    return false;
}

/**
 * @param {{status?: string, newPolicyCount?: number|string}} baseline estado do baseline SCA
 *   compared: só vulnerabilidades novas que afetam a política bloqueiam (o break-build do agente
 *             avalia todas e não é repassado); deferred/seeded/error: a política não bloqueia.
 *   fail_on_cve continua absoluto em todos os casos.
 */
function resolveScaStatus(outcome, policyFail, cveBlockedCount = 0, baseline = {}) {
    const blocked = Number(cveBlockedCount) > 0;
    if (!hasScanResults()) return 'warning';
    if (blocked) {
        return policyFail === 'true' ? 'failure' : 'warning';
    }
    if (baseline.status === 'compared') {
        if (Number(baseline.newPolicyCount) > 0) return policyFail === 'true' ? 'failure' : 'warning';
        return 'success';
    }
    if (baseline.status === 'deferred' || baseline.status === 'seeded') {
        return outcome === 'success' ? 'success' : 'warning';
    }
    if (baseline.status === 'error') return 'warning';
    if (outcome === 'success') return 'success';
    if (outcome === 'failure' && policyFail === 'true') return 'failure';
    return 'warning';
}

if (require.main === module) {
    process.stdout.write(`${resolveScaStatus(
        process.env.SCA_OUTCOME,
        process.env.POLICY_FAIL,
        process.env.CVE_BLOCKED_COUNT || '0',
        { status: process.env.SCA_BASELINE_STATUS || '', newPolicyCount: process.env.SCA_NEW_POLICY_COUNT || '0' }
    )}\n`);
}

module.exports = { resolveScaStatus };
