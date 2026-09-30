'use strict';

const fs = require('node:fs');

function normalizePolicyStatus(value) {
    if (value === false || value === 'failed' || value === 'false') return 'failed';
    if (value === true || value === 'passed' || value === 'true') return 'passed';
    return 'error';
}

function evaluatePolicyResult(filePath, scanExitCode) {
    try {
        const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const rawStatus = result['policy-passed'] ?? result.policyPassed;
        const status = normalizePolicyStatus(rawStatus);
        if (status === 'error') return status;
        if (Number(scanExitCode) !== 0 && !(Number(scanExitCode) === 3 && status === 'failed')) return 'error';
        return status;
    } catch {
        return 'error';
    }
}

function resolveIacStatus({ policyName = 'none', scanOutcome = '', scanStatus = '', policyStatus = '' }) {
    if (String(policyName).trim() === 'none') {
        const iacStatus = scanOutcome === 'success' ? 'success'
            : scanOutcome === 'skipped' ? 'skipped' : 'failure';
        return { iac_status: iacStatus, iac_policy_status: 'not_used' };
    }

    if (scanStatus !== 'success') {
        return { iac_status: 'failure', iac_policy_status: 'error' };
    }
    if (policyStatus === 'passed') {
        return { iac_status: 'success', iac_policy_status: 'passed' };
    }
    if (policyStatus === 'failed') {
        return { iac_status: 'failure', iac_policy_status: 'failed' };
    }
    return { iac_status: 'failure', iac_policy_status: 'error' };
}

if (require.main === module) {
    const [, , command, ...args] = process.argv;
    if (command === 'status') {
        const output = resolveIacStatus({
            policyName: process.env.IAC_POLICY || 'none',
            scanOutcome: process.env.IAC_SCAN_OUTCOME || '',
            scanStatus: process.env.IAC_SCAN_STATUS || '',
            policyStatus: process.env.IAC_POLICY_STATUS || ''
        });
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT,
                `iac_status=${output.iac_status}\niac_policy_status=${output.iac_policy_status}\n`);
        }
        process.stdout.write(`${output.iac_status}\n`);
    } else {
        const [filePath, exitCode] = args;
        process.stdout.write(`${evaluatePolicyResult(filePath, exitCode)}\n`);
    }
}

module.exports = { normalizePolicyStatus, evaluatePolicyResult, resolveIacStatus };
