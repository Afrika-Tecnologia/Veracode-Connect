'use strict';

/**
 * Leitura e gravação de arquivos no repositório de baseline.
 *
 * - Leitura pela Contents API, com fallback para o media type raw quando o arquivo
 *   passa de 1 MB (a Contents API devolve `content` vazio entre 1 e 100 MB).
 * - Gravação write-once pela Git Data API (blob → tree → commit → PATCH do ref):
 *   um arquivo existente nunca é sobrescrito, inclusive quando outra execução o grava
 *   entre a consulta e o commit desta.
 */

const fs = require('fs');
const { githubApiBase } = require('./github-auth');
const { message, fail } = require('./messages');

/** Nome default do repositório de store de baseline (override via BASELINE_REPO_NAME). */
const DEFAULT_BASELINE_REPO_NAME = 'Afrika-Veracode-Connect-Baseline';

/** Identidade usada nos commits de seed (Git Data API author/committer). */
const BASELINE_COMMIT_IDENTITY = {
    name: '[BOT] Afrika-Veracode-Connect-Baseline',
    email: 'veracode.connect@afrikatech.com.br'
};

function resolveBaselineRepoName(raw) {
    return String(raw || '').trim() || DEFAULT_BASELINE_REPO_NAME;
}

function resolveRequestedStoreBranch(raw) {
    return String(raw || '').trim();
}

function setOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (out) {
        fs.appendFileSync(out, `${name}=${value}\n`);
    }
}

function encodeContentPath(filePath) {
    return String(filePath)
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function contentsApiUrl(api, baselineOrg, baselineRepoName, contentPath, branch) {
    const base = `${api}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}/contents/${contentPath}`;
    const ref = String(branch || '').trim();
    return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Afrika-Veracode-Connect-Baseline',
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    return { response, json, text };
}

async function githubJson(token, url, options = {}) {
    const method = options.method || 'GET';
    return fetchJson(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
}

function githubErrorDetail(json, text) {
    const msg = json && json.message ? String(json.message) : String(text || '');
    if (json && json.errors) {
        return `${msg} ${JSON.stringify(json.errors)}`.slice(0, 500);
    }
    return msg.slice(0, 500);
}

function isEmptyRepoConflict(detail) {
    return /repository is empty/i.test(String(detail || ''));
}

function isRulesetViolation(detail) {
    return /repository rule violations|must be made through a pull request|protected branch/i.test(
        String(detail || '')
    );
}

function isRetriableRefConflict(status, detail) {
    if (Number(status) === 409) {
        return true;
    }
    const text = String(detail || '');
    return /not a fast forward/i.test(text) || /reference cannot be updated/i.test(text);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function putMaxAttempts() {
    const n = Number(process.env.BASELINE_PUT_MAX_ATTEMPTS || 5);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

function putRetryMs() {
    const n = Number(process.env.BASELINE_PUT_RETRY_MS || 400);
    return Number.isFinite(n) && n >= 0 ? n : 400;
}

async function getDefaultBranch(token, baselineOrg, baselineRepoName) {
    const { response, json } = await fetchJson(
        `${githubApiBase()}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.ok && json?.default_branch) {
        return String(json.default_branch);
    }
    return 'main';
}

async function resolveStoreBranch(token, baselineOrg, baselineRepoName, requested) {
    const explicit = resolveRequestedStoreBranch(requested);
    if (explicit) {
        return explicit;
    }
    return getDefaultBranch(token, baselineOrg, baselineRepoName);
}

async function checkRepoExists(token, baselineOrg, baselineRepoName) {
    const { response, text } = await fetchJson(
        `${githubApiBase()}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const repo = `${baselineOrg}/${baselineRepoName}`;
    if (response.status === 404) {
        throw fail('REPO_NOT_FOUND', { repo });
    }
    if (response.status === 401 || response.status === 403) {
        throw fail('REPO_FORBIDDEN', { repo, status: response.status });
    }
    if (!response.ok) {
        throw fail('REPO_CHECK_FAILED', { repo, status: response.status, detail: text.slice(0, 300) });
    }
    return true;
}

async function getFileExists(token, url) {
    const existing = await githubJson(token, url);
    if (existing.response.status === 200) {
        if (Array.isArray(existing.json) || existing.json?.type === 'dir') {
            throw fail('PATH_IS_DIRECTORY');
        }
        return { exists: true, sha: existing.json?.sha };
    }
    if (existing.response.status === 404) {
        return { exists: false };
    }
    throw fail('EXISTS_CHECK_FAILED', {
        status: existing.response.status,
        detail: existing.text.slice(0, 300)
    });
}

function gitRefPath(branch) {
    return encodeURIComponent(`heads/${branch}`).replace(/%2F/g, '/');
}

async function getGitRefHead(token, api, repoPath, branch) {
    const refPath = gitRefPath(branch);
    const singularUrl = `${api}/repos/${repoPath}/git/ref/${refPath}`;
    const pluralUrl = `${api}/repos/${repoPath}/git/refs/${refPath}`;

    // github.com / GHEC: /git/ref/{ref}. GHES antigo: só /git/refs/{ref}.
    let refRes = await githubJson(token, singularUrl);
    if (refRes.response.status === 404) {
        refRes = await githubJson(token, pluralUrl);
        console.log(message('success', 'GIT_REF_FALLBACK'));
    }
    if (Array.isArray(refRes.json) && refRes.json[0]) {
        refRes = { ...refRes, json: refRes.json[0] };
    }
    return { refRes, patchRefUrl: pluralUrl };
}

async function commitNewFileOnBranch(token, api, baselineOrg, baselineRepoName, branch, relativePath, contentBase64, commitMessage) {
    const repoPath = `${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`;
    const { refRes, patchRefUrl } = await getGitRefHead(token, api, repoPath, branch);
    const refDetail = githubErrorDetail(refRes.json, refRes.text);
    if (refRes.response.status === 409 || isEmptyRepoConflict(refDetail)) {
        throw fail('EMPTY_REPO', { store: `${baselineOrg}/${baselineRepoName}/${relativePath}`, detail: refDetail });
    }
    if (!refRes.response.ok || !refRes.json?.object?.sha) {
        throw fail('READ_HEAD_FAILED', {
            repo: `${baselineOrg}/${baselineRepoName}`,
            branch,
            status: refRes.response.status,
            detail: refDetail
        });
    }
    const headSha = refRes.json.object.sha;

    const commitRes = await githubJson(token, `${api}/repos/${repoPath}/git/commits/${headSha}`);
    if (!commitRes.response.ok || !commitRes.json?.tree?.sha) {
        throw fail('READ_PARENT_COMMIT_FAILED', {
            sha: headSha,
            status: commitRes.response.status,
            detail: githubErrorDetail(commitRes.json, commitRes.text)
        });
    }

    const blobRes = await githubJson(token, `${api}/repos/${repoPath}/git/blobs`, {
        method: 'POST',
        body: { content: contentBase64, encoding: 'base64' }
    });
    if (!blobRes.response.ok || !blobRes.json?.sha) {
        throw fail('CREATE_BLOB_FAILED', {
            status: blobRes.response.status,
            detail: githubErrorDetail(blobRes.json, blobRes.text)
        });
    }

    const treeRes = await githubJson(token, `${api}/repos/${repoPath}/git/trees`, {
        method: 'POST',
        body: {
            base_tree: commitRes.json.tree.sha,
            tree: [{ path: relativePath, mode: '100644', type: 'blob', sha: blobRes.json.sha }]
        }
    });
    if (!treeRes.response.ok || !treeRes.json?.sha) {
        throw fail('CREATE_TREE_FAILED', {
            status: treeRes.response.status,
            detail: githubErrorDetail(treeRes.json, treeRes.text)
        });
    }

    const newCommitRes = await githubJson(token, `${api}/repos/${repoPath}/git/commits`, {
        method: 'POST',
        body: {
            message: commitMessage,
            tree: treeRes.json.sha,
            parents: [headSha],
            author: BASELINE_COMMIT_IDENTITY,
            committer: BASELINE_COMMIT_IDENTITY
        }
    });
    if (!newCommitRes.response.ok || !newCommitRes.json?.sha) {
        throw fail('CREATE_COMMIT_FAILED', {
            status: newCommitRes.response.status,
            detail: githubErrorDetail(newCommitRes.json, newCommitRes.text)
        });
    }

    const updateRef = await githubJson(token, patchRefUrl, {
        method: 'PATCH',
        body: { sha: newCommitRes.json.sha }
    });

    return {
        response: updateRef.response,
        json: updateRef.json,
        text: updateRef.text,
        headSha,
        commitSha: newCommitRes.json.sha
    };
}

/**
 * Lê um arquivo do store. 404 = ausente.
 * @returns {Promise<{exists: boolean, content?: Buffer, sha?: string, branch: string}>}
 */
async function readStoreFile({ token, baselineOrg, baselineRepoName, relativePath, branch }) {
    const api = githubApiBase();
    const targetBranch = await resolveStoreBranch(token, baselineOrg, baselineRepoName, branch);
    const url = contentsApiUrl(api, baselineOrg, baselineRepoName, encodeContentPath(relativePath), targetBranch);
    const store = `${baselineOrg}/${baselineRepoName}/${relativePath}`;

    const { response, json, text } = await githubJson(token, url);
    if (response.status === 404) {
        return { exists: false, branch: targetBranch };
    }
    if (!response.ok) {
        throw fail('GET_BASELINE_FAILED', { status: response.status, store, detail: text.slice(0, 300) });
    }
    if (Array.isArray(json) || json?.type === 'dir') {
        throw fail('PATH_IS_DIRECTORY');
    }

    if (typeof json?.content === 'string' && json.content !== '') {
        const content = Buffer.from(json.content.replace(/\s/g, ''), 'base64');
        return { exists: true, content, sha: json.sha, branch: targetBranch };
    }

    // Arquivos entre 1 e 100 MB: a Contents API não devolve `content`; o media type raw devolve.
    if (json?.type === 'file' && Number(json.size) > 0) {
        const raw = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.raw',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Afrika-Veracode-Connect-Baseline'
            }
        });
        const rawText = await raw.text();
        if (!raw.ok) {
            throw fail('GET_BASELINE_FAILED', { status: raw.status, store, detail: rawText.slice(0, 300) });
        }
        return { exists: true, content: Buffer.from(rawText, 'utf8'), sha: json.sha, branch: targetBranch };
    }

    throw fail('CONTENTS_MISSING');
}

/**
 * Grava um arquivo no store somente se ele ainda não existir (write-once).
 * Escreve baseline_seeded / baseline_already_exists / baseline_repo_branch no GITHUB_OUTPUT.
 * @returns {Promise<{seeded: boolean, alreadyExists: boolean, branch: string, commitSha?: string}>}
 */
async function writeStoreFileOnce({ token, baselineOrg, baselineRepoName, relativePath, branch, content, commitMessage }) {
    const api = githubApiBase();
    const targetBranch = await resolveStoreBranch(token, baselineOrg, baselineRepoName, branch);
    const url = contentsApiUrl(api, baselineOrg, baselineRepoName, encodeContentPath(relativePath), targetBranch);
    const storeLabel = `${baselineOrg}/${baselineRepoName}/${relativePath}`;
    setOutput('baseline_repo_branch', targetBranch);

    const keepExisting = () => {
        setOutput('baseline_seeded', 'false');
        setOutput('baseline_already_exists', 'true');
        console.log(message('success', 'BASELINE_EXISTS_KEPT', { store: storeLabel, branch: targetBranch }));
        return { seeded: false, alreadyExists: true, branch: targetBranch };
    };

    if ((await getFileExists(token, url)).exists) {
        return keepExisting();
    }

    console.log(message('success', 'API', { api }));
    const contentBase64 = Buffer.from(content).toString('base64');
    const maxAttempts = putMaxAttempts();
    const retryMs = putRetryMs();
    let lastDetail = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1 && (await getFileExists(token, url)).exists) {
            return keepExisting();
        }
        const result = await commitNewFileOnBranch(
            token, api, baselineOrg, baselineRepoName, targetBranch, relativePath, contentBase64, commitMessage
        );

        if (result.response.ok) {
            setOutput('baseline_seeded', 'true');
            setOutput('baseline_already_exists', 'false');
            console.log(message('success', 'BASELINE_WRITTEN', {
                store: storeLabel,
                branch: targetBranch,
                sha: result.commitSha
            }));
            return { seeded: true, alreadyExists: false, branch: targetBranch, commitSha: result.commitSha };
        }

        lastDetail = githubErrorDetail(result.json, result.text);

        if (isEmptyRepoConflict(lastDetail)) {
            throw fail('EMPTY_REPO', { store: storeLabel, detail: lastDetail });
        }
        if (isRulesetViolation(lastDetail)) {
            throw fail('RULESET_PR_REQUIRED', { store: storeLabel });
        }
        if (isRetriableRefConflict(result.response.status, lastDetail) && attempt < maxAttempts) {
            console.log(message('warning', 'RETRY', {
                attempt,
                max: maxAttempts,
                status: result.response.status,
                detail: lastDetail
            }));
            await sleep(retryMs * attempt);
            continue;
        }
        throw fail('PUT_FAILED', { status: result.response.status, store: storeLabel, detail: lastDetail });
    }

    throw fail('PUT_RETRIES_EXHAUSTED', { attempts: maxAttempts, store: storeLabel, detail: lastDetail });
}

module.exports = {
    DEFAULT_BASELINE_REPO_NAME,
    BASELINE_COMMIT_IDENTITY,
    resolveBaselineRepoName,
    resolveRequestedStoreBranch,
    setOutput,
    encodeContentPath,
    contentsApiUrl,
    fetchJson,
    githubJson,
    githubErrorDetail,
    isEmptyRepoConflict,
    isRulesetViolation,
    isRetriableRefConflict,
    getDefaultBranch,
    resolveStoreBranch,
    checkRepoExists,
    getFileExists,
    commitNewFileOnBranch,
    readStoreFile,
    writeStoreFileOnce
};
