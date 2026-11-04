'use strict';

/**
 * Elegibilidade do seed de baseline: a execução precisa ter como destino a
 * default_branch do repositório analisado (push nela ou PR destinado a ela).
 * O seed é write-once; esta regra só decide quem pode criar o arquivo.
 *
 * Env: HEAD_REF, BASE_REF, REF_NAME, DEFAULT_BRANCH, HAS_BASELINE
 * Saídas: current_branch, default_branch, target_branch, can_seed
 */

const fs = require('fs');
const { message } = require('./messages');

function resolveSeedGate({ headRef = '', baseRef = '', refName = '', defaultBranch = '' }) {
    const currentBranch = headRef || refName || 'unknown';
    // github.base_ref é o destino do PR; fora de PR, vale a branch da execução.
    const targetBranch = baseRef || currentBranch;
    const canSeed = Boolean(defaultBranch) && targetBranch === defaultBranch;
    return { currentBranch, defaultBranch, targetBranch, canSeed };
}

if (require.main === module) {
    const gate = resolveSeedGate({
        headRef: process.env.HEAD_REF || '',
        baseRef: process.env.BASE_REF || '',
        refName: process.env.REF_NAME || '',
        defaultBranch: process.env.DEFAULT_BRANCH || ''
    });
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, [
            `current_branch=${gate.currentBranch}`,
            `default_branch=${gate.defaultBranch}`,
            `target_branch=${gate.targetBranch}`,
            `can_seed=${gate.canSeed}`
        ].join('\n') + '\n');
    }
    if (gate.canSeed) {
        console.log(message('success', 'SEED_ELIGIBLE', { branch: gate.currentBranch, target_branch: gate.targetBranch }));
    } else if (process.env.HAS_BASELINE !== 'true') {
        console.log(`::warning::${message('warning', 'SEED_NOT_DEFAULT_BRANCH', {
            branch: gate.currentBranch,
            default_branch: gate.defaultBranch
        })}`);
    }
}

module.exports = { resolveSeedGate };
