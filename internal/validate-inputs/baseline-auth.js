'use strict';

const { message, fail } = require('./messages');
const sharedAuth = require('../baseline-store/github-auth');

const { githubApiBase, normalizePem, createAppJwt } = sharedAuth;

/** Token do repositório de baseline (GitHub App ou PAT), com as mensagens da validação. */
async function resolveAccessToken() {
    const { token } = await sharedAuth.resolveAccessToken({ failWith: fail });
    return token;
}

async function assertBaselineRepoExists(token, baselineOrg, baselineRepoName) {
    const api = githubApiBase();
    const response = await fetch(
        `${api}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        }
    );

    if (response.status === 404) {
        throw fail('BASELINE_REPO_NOT_FOUND', { repo: `${baselineOrg}/${baselineRepoName}` });
    }
    if (response.status === 401 || response.status === 403) {
        throw fail('BASELINE_REPO_FORBIDDEN', { repo: `${baselineOrg}/${baselineRepoName}`, status: response.status });
    }
    if (!response.ok) {
        const text = await response.text();
        throw fail('BASELINE_REPO_CHECK_FAILED', { repo: `${baselineOrg}/${baselineRepoName}`, status: response.status, detail: text.slice(0, 300) });
    }
}

function resolveBaselineMode(env) {
    const rawMode = (env.BASELINE_MODE || 'none').trim().toLowerCase() || 'none';

    if (!['none', 'portal_afrika', 'repo'].includes(rawMode)) {
        return { error: message('error', 'BASELINE_MODE_INVALID', { mode: env.BASELINE_MODE }) };
    }

    return { mode: rawMode };
}

module.exports = {
    resolveAccessToken,
    assertBaselineRepoExists,
    resolveBaselineMode,
    githubApiBase,
    normalizePem,
    createAppJwt
};
