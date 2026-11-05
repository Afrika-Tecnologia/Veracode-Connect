'use strict';

/**
 * Autenticação do repositório de baseline: GitHub App (preferencial) ou PAT.
 * Compartilhado por validate-inputs, Repo Baseline (SAST), IaC e SCA.
 */

const crypto = require('crypto');
const { fail } = require('./messages');

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
    // Secrets costumam guardar o PEM com \n literal.
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

/**
 * @param {{failWith?: (key: string, vars?: object) => Error}} [options]
 *   failWith permite que o chamador use o próprio catálogo de mensagens.
 * @returns {Promise<{token: string, source: 'github_app' | 'pat'}>}
 */
async function resolveAccessToken(options = {}) {
    const failWith = options.failWith || fail;
    const appId = (process.env.BASELINE_GITHUB_APP_ID || '').trim();
    const privateKey = normalizePem(process.env.BASELINE_GITHUB_APP_PRIVATE_KEY || '');
    const installationId = (process.env.BASELINE_GITHUB_APP_INSTALLATION_ID || '').trim();
    const pat = (process.env.BASELINE_GITHUB_TOKEN || '').trim();

    if (appId && privateKey && installationId) {
        const jwt = createAppJwt(appId, privateKey);
        const response = await fetch(`${githubApiBase()}/app/installations/${installationId}/access_tokens`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Afrika-Veracode-Connect-Baseline',
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
            throw failWith('APP_TOKEN_FAILED', { status: response.status, detail: String(text).slice(0, 300) });
        }
        return { token: json.token, source: 'github_app' };
    }

    if (pat) {
        return { token: pat, source: 'pat' };
    }

    throw failWith('AUTH_REQUIRED');
}

module.exports = {
    githubApiBase,
    normalizePem,
    createAppJwt,
    resolveAccessToken
};
