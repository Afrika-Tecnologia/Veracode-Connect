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

function resolveScanStatus({ policyName = 'none', scanOutcome = '', scanStatus = '', policyStatus = '' }) {
    if (String(policyName).trim() === 'none') {
        const iacStatus = scanOutcome === 'success' ? 'success'
            : scanOutcome === 'skipped' ? 'skipped' : 'warning';
        return { iac_status: iacStatus, iac_policy_status: 'not_used' };
    }

    if (scanStatus !== 'success') {
        return { iac_status: 'warning', iac_policy_status: 'error' };
    }
    if (policyStatus === 'passed') {
        return { iac_status: 'success', iac_policy_status: 'passed' };
    }
    if (policyStatus === 'failed') {
        return { iac_status: 'failure', iac_policy_status: 'failed' };
    }
    return { iac_status: 'warning', iac_policy_status: 'error' };
}

/**
 * Status final do IaC, considerando o baseline IaC (enable_iac_baseline).
 *
 * - not_used: comportamento sem baseline (política global decide).
 * - compared: só findings novos que violam a política reprovam.
 * - deferred/seeded: sem baseline utilizado nesta execução; a política é exibida, mas fica
 *   "deferred" e não reprova (o bloqueio começa quando um baseline existente é usado).
 * - error: baseline ilegível ou scan inválido; nada reprova por política.
 */
function resolveIacStatus({ baselineStatus = 'not_used', newPolicyCount = 0, ...scan }) {
    const base = resolveScanStatus(scan);
    const evaluated = base.iac_policy_status === 'passed' || base.iac_policy_status === 'failed';

    if (!baselineStatus || baselineStatus === 'not_used') {
        return base;
    }
    if (baselineStatus === 'compared') {
        if (!evaluated) return base;
        return Number(newPolicyCount) > 0
            ? { iac_status: 'failure', iac_policy_status: 'failed' }
            : { iac_status: 'success', iac_policy_status: 'passed' };
    }
    if (baselineStatus === 'deferred' || baselineStatus === 'seeded') {
        return evaluated ? { iac_status: 'success', iac_policy_status: 'deferred' } : base;
    }
    // error
    if (base.iac_policy_status === 'not_used') {
        return { iac_status: 'warning', iac_policy_status: 'not_used' };
    }
    return { iac_status: 'warning', iac_policy_status: 'error' };
}

if (require.main === module) {
    const [, , commandOrFilePath, exitCode] = process.argv;
    if (commandOrFilePath === 'status') {
        const baselineStatus = process.env.IAC_BASELINE_STATUS || 'not_used';
        const output = resolveIacStatus({
            policyName: process.env.IAC_POLICY || 'none',
            scanOutcome: process.env.IAC_SCAN_OUTCOME || '',
            scanStatus: process.env.IAC_SCAN_STATUS || '',
            policyStatus: process.env.IAC_POLICY_STATUS || '',
            baselineStatus,
            newPolicyCount: process.env.IAC_NEW_POLICY_COUNT || '0'
        });
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT,
                `iac_status=${output.iac_status}\niac_policy_status=${output.iac_policy_status}\n`);
        }
        process.stdout.write(`${output.iac_status}\n`);
    } else {
        process.stdout.write(`${evaluatePolicyResult(commandOrFilePath, exitCode)}\n`);
    }
}

module.exports = { normalizePolicyStatus, evaluatePolicyResult, resolveScanStatus, resolveIacStatus };
