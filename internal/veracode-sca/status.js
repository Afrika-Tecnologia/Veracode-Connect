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

function resolveScaStatus(outcome, policyFail) {
    if (!hasScanResults()) return 'warning';
    if (outcome === 'success') return 'success';
    if (outcome === 'failure' && policyFail === 'true') return 'failure';
    return 'warning';
}

if (require.main === module) {
    process.stdout.write(`${resolveScaStatus(process.env.SCA_OUTCOME, process.env.POLICY_FAIL)}\n`);
}

module.exports = { resolveScaStatus };
