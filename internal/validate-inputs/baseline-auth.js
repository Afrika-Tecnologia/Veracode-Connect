'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { message, fail } = require('./messages');

function githubApiBase() {
    if (process.env.GITHUB_API_URL) {
        return process.env.GITHUB_API_URL.replace(/\/$/, '');
    }
    const serverUrl = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    return serverUrl === 'https://github.com'
        ? 'https://api.github.com'
        : `${serverUrl}/api/v3`;
}

function normalizePem(raw) {
    if (!raw) return '';
    let key = String(raw).trim();
    if (key.includes('\\n') && !key.includes('\n')) {
        key = key.replace(/\\n/g, '\n');
    }
    return key;
}

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function createAppJwt(appId, privateKeyPem) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iat: now - 60,
        exp: now + 9 * 60,
        iss: String(appId)
    };
    const segments = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(segments);
    sign.end();
    const signature = sign.sign(privateKeyPem)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${segments}.${signature}`;
}

async function resolveAccessToken() {
    const appId = (process.env.BASELINE_GITHUB_APP_ID || '').trim();
    const privateKey = normalizePem(process.env.BASELINE_GITHUB_APP_PRIVATE_KEY || '');
    const installationId = (process.env.BASELINE_GITHUB_APP_INSTALLATION_ID || '').trim();
    const pat = (process.env.BASELINE_GITHUB_TOKEN || '').trim();

    if (appId && privateKey && installationId) {
        const jwt = createAppJwt(appId, privateKey);
        const api = githubApiBase();
        const response = await fetch(`${api}/app/installations/${installationId}/access_tokens`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: '{}'
        });
        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        if (!response.ok || !json?.token) {
            throw fail('APP_TOKEN_FAILED', { status: response.status, detail: String(text).slice(0, 300) });
        }
        return json.token;
    }

    if (pat) {
        return pat;
    }

    throw fail('AUTH_REQUIRED');
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
