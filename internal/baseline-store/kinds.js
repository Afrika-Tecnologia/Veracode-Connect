'use strict';

/**
 * Tipos de baseline guardados no store. Todos ficam na mesma pasta do app:
 * <org>/<repo>/<arquivo>.
 */

const { fail } = require('./messages');

const KINDS = {
    sast: { file: 'baseline.json', label: 'Baseline' },
    iac: { file: 'iac-baseline.json', label: 'Baseline IaC' },
    sca: { file: 'sca-baseline.json', label: 'Baseline SCA' }
};

function kindSpec(kind) {
    const spec = KINDS[String(kind || '').trim()];
    if (!spec) {
        throw fail('UNKNOWN_KIND', { kind });
    }
    return spec;
}

function splitRepository(scanRepository) {
    const parts = String(scanRepository || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw fail('INVALID_REPOSITORY', { scanRepository });
    }
    return parts;
}

function baselineContentPath(scanRepository, kind = 'sast') {
    const [org, repo] = splitRepository(scanRepository);
    return `${org}/${repo}/${kindSpec(kind).file}`;
}

function seedCommitMessage(scanRepository, kind = 'sast') {
    const appName = String(scanRepository).split('/')[1] || scanRepository;
    return `${kindSpec(kind).label} criado para a aplicação "${appName}" (${scanRepository})`;
}

module.exports = { KINDS, kindSpec, baselineContentPath, seedCommitMessage };
