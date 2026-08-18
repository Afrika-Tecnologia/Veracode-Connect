'use strict';

/**
 * GitHub App / PAT helpers for Veracode Connect repo baseline.
 * CLI:
 *   node github-baseline.js resolve-token
 *   node github-baseline.js check-repo
 *   node github-baseline.js get-baseline
 *   node github-baseline.js put-baseline
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Nome fixo do repositório de baseline (não configurável pelo consumidor). */
const FIXED_BASELINE_REPO_NAME = 'Afrika-Veracode-Connect-Baseline';

/** Identidade usada nos commits de seed (Contents API author/committer). */
const BASELINE_COMMIT_IDENTITY = {
    name: '[BOT] Afrika-Veracode-Connect-Baseline',
    email: 'veracode.connect@afrikatech.com.br'
};

function setOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (out) {
        fs.appendFileSync(out, `${name}=${value}\n`);
    }
}

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
    // Secrets often store PEM with literal \n
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

async function resolveAccessToken() {
    const appId = (process.env.BASELINE_GITHUB_APP_ID || '').trim();
    const privateKey = normalizePem(process.env.BASELINE_GITHUB_APP_PRIVATE_KEY || '');
    const installationId = (process.env.BASELINE_GITHUB_APP_INSTALLATION_ID || '').trim();
    const pat = (process.env.BASELINE_GITHUB_TOKEN || '').trim();

    if (appId && privateKey && installationId) {
        const jwt = createAppJwt(appId, privateKey);
        const api = githubApiBase();
        const { response, json, text } = await fetchJson(
            `${api}/app/installations/${installationId}/access_tokens`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${jwt}`,
                    'Content-Type': 'application/json'
                },
                body: '{}'
            }
        );
        if (!response.ok || !json?.token) {
            throw new Error(
                `Falha ao obter installation token do GitHub App (HTTP ${response.status}): ${text.slice(0, 300)}`
            );
        }
        return { token: json.token, source: 'github_app' };
    }

    if (pat) {
        return { token: pat, source: 'pat' };
    }

    throw new Error(
        'baseline_mode=repo requer GitHub App (baseline_github_app_id + baseline_github_app_private_key + baseline_github_app_installation_id) ou baseline_github_token (PAT).'
    );
}

function baselineContentPath(scanRepository) {
    const parts = String(scanRepository || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`repository_full_name inválido (esperado org/repo): '${scanRepository}'`);
    }
    return `${parts[0]}/${parts[1]}/baseline.json`;
}

function encodeContentPath(filePath) {
    return filePath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
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

async function githubJson(token, url, options = {}) {
    const method = options.method || 'GET';
    const { response, json, text } = await fetchJson(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    return { response, json, text };
}

async function getFileExists(token, url) {
    const existing = await githubJson(token, url);
    if (existing.response.status === 200) {
        if (Array.isArray(existing.json) || existing.json?.type === 'dir') {
            throw new Error(
                'O caminho do baseline aponta para um diretório, não para um arquivo baseline.json.'
            );
        }
        return { exists: true, sha: existing.json?.sha };
    }
    if (existing.response.status === 404) {
        return { exists: false };
    }
    throw new Error(
        `Falha ao verificar existência do baseline (HTTP ${existing.response.status}): ${existing.text.slice(0, 300)}`
    );
}

function emptyRepoError(storeLabel, detail) {
    return new Error(
        `Falha ao gravar baseline em ${storeLabel}: o repositório está vazio. ` +
        'A Contents/Git Data API exige pelo menos um commit inicial (README.md na raiz). ' +
        `O README NÃO bloqueia o seed — ele é o commit pai. Detalhe GitHub: ${detail}`
    );
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
    let usedGetUrl = singularUrl;
    if (refRes.response.status === 404) {
        refRes = await githubJson(token, pluralUrl);
        usedGetUrl = pluralUrl;
        console.log(
            `HEAD não encontrado em /git/ref (HTTP 404); usando /git/refs (compatível com GHES e github.com).`
        );
    }
    if (Array.isArray(refRes.json) && refRes.json[0]) {
        refRes = { ...refRes, json: refRes.json[0] };
    }
    return { refRes, patchRefUrl: pluralUrl, usedGetUrl };
}

async function commitNewFileOnBranch(token, api, baselineOrg, baselineRepoName, branch, relativePath, contentBase64, message) {
    const repoPath = `${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`;
    const { refRes, patchRefUrl } = await getGitRefHead(token, api, repoPath, branch);
    const refDetail = githubErrorDetail(refRes.json, refRes.text);
    if (refRes.response.status === 409 || isEmptyRepoConflict(refDetail)) {
        throw emptyRepoError(`${baselineOrg}/${baselineRepoName}/${relativePath}`, refDetail);
    }
    if (!refRes.response.ok || !refRes.json?.object?.sha) {
        throw new Error(
            `Falha ao ler HEAD de ${baselineOrg}/${baselineRepoName}@${branch} (HTTP ${refRes.response.status}): ${refDetail}`
        );
    }
    const headSha = refRes.json.object.sha;

    const commitRes = await githubJson(token, `${api}/repos/${repoPath}/git/commits/${headSha}`);
    if (!commitRes.response.ok || !commitRes.json?.tree?.sha) {
        throw new Error(
            `Falha ao ler commit pai ${headSha} (HTTP ${commitRes.response.status}): ${githubErrorDetail(commitRes.json, commitRes.text)}`
        );
    }
    const baseTreeSha = commitRes.json.tree.sha;

    const blobRes = await githubJson(token, `${api}/repos/${repoPath}/git/blobs`, {
        method: 'POST',
        body: { content: contentBase64, encoding: 'base64' }
    });
    if (!blobRes.response.ok || !blobRes.json?.sha) {
        throw new Error(
            `Falha ao criar blob do baseline (HTTP ${blobRes.response.status}): ${githubErrorDetail(blobRes.json, blobRes.text)}`
        );
    }

    const treeRes = await githubJson(token, `${api}/repos/${repoPath}/git/trees`, {
        method: 'POST',
        body: {
            base_tree: baseTreeSha,
            tree: [
                {
                    path: relativePath,
                    mode: '100644',
                    type: 'blob',
                    sha: blobRes.json.sha
                }
            ]
        }
    });
    if (!treeRes.response.ok || !treeRes.json?.sha) {
        throw new Error(
            `Falha ao criar tree do baseline (HTTP ${treeRes.response.status}): ${githubErrorDetail(treeRes.json, treeRes.text)}`
        );
    }

    const newCommitRes = await githubJson(token, `${api}/repos/${repoPath}/git/commits`, {
        method: 'POST',
        body: {
            message,
            tree: treeRes.json.sha,
            parents: [headSha],
            author: BASELINE_COMMIT_IDENTITY,
            committer: BASELINE_COMMIT_IDENTITY
        }
    });
    if (!newCommitRes.response.ok || !newCommitRes.json?.sha) {
        throw new Error(
            `Falha ao criar commit do baseline (HTTP ${newCommitRes.response.status}): ${githubErrorDetail(newCommitRes.json, newCommitRes.text)}`
        );
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

async function getDefaultBranch(token, baselineOrg, baselineRepoName) {
    const api = githubApiBase();
    const { response, json } = await fetchJson(
        `${api}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`,
        {
            headers: { Authorization: `Bearer ${token}` }
        }
    );
    if (response.ok && json?.default_branch) {
        return String(json.default_branch);
    }
    return 'main';
}

async function checkRepoExists(token, baselineOrg, baselineRepoName) {
    const api = githubApiBase();
    const { response, text } = await fetchJson(
        `${api}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}`,
        {
            headers: { Authorization: `Bearer ${token}` }
        }
    );

    if (response.status === 404) {
        throw new Error(
            `Repositório de baseline '${baselineOrg}/${baselineRepoName}' não existe. ` +
            'Crie o repositório privado antes de usar baseline_mode=repo.'
        );
    }
    if (response.status === 401 || response.status === 403) {
        throw new Error(
            `Sem acesso ao repositório de baseline '${baselineOrg}/${baselineRepoName}' (HTTP ${response.status}). ` +
            'Verifique o GitHub App/PAT (contents: read/write) e a instalação na org correta.'
        );
    }
    if (!response.ok) {
        throw new Error(
            `Falha ao verificar repositório de baseline '${baselineOrg}/${baselineRepoName}' (HTTP ${response.status}): ${text.slice(0, 300)}`
        );
    }
    return true;
}

async function getBaseline(token, baselineOrg, baselineRepoName, scanRepository, outFile) {
    const api = githubApiBase();
    const contentPath = encodeContentPath(baselineContentPath(scanRepository));
    const url = `${api}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}/contents/${contentPath}`;

    const { response, json, text } = await fetchJson(url, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 404) {
        setOutput('has_baseline', 'false');
        console.log(
            `Consulta de baseline concluída: baseline não encontrado em ${baselineOrg}/${baselineRepoName}/${baselineContentPath(scanRepository)}.`
        );
        return { hasBaseline: false };
    }
    if (!response.ok) {
        throw new Error(
            `Falha ao obter baseline (HTTP ${response.status}) em ${baselineOrg}/${baselineRepoName}/${baselineContentPath(scanRepository)}: ${text.slice(0, 300)}`
        );
    }

    if (!json?.content) {
        throw new Error('Resposta da Contents API sem campo content.');
    }

    const decoded = Buffer.from(String(json.content).replace(/\n/g, ''), 'base64').toString('utf8');
    fs.writeFileSync(outFile, decoded, 'utf8');
    setOutput('has_baseline', 'true');
    console.log(
        `Consulta de baseline concluída com sucesso: baseline encontrado em ${baselineOrg}/${baselineRepoName}/${baselineContentPath(scanRepository)}.`
    );
    console.log(`Arquivo local gravado: "${outFile}"`);
    return { hasBaseline: true, sha: json.sha };
}

async function putBaseline(token, baselineOrg, baselineRepoName, scanRepository, resultsFile) {
    if (!fs.existsSync(resultsFile)) {
        throw new Error(`Arquivo de resultados não encontrado: ${resultsFile}`);
    }

    const api = githubApiBase();
    const relativePath = baselineContentPath(scanRepository);
    const contentPath = encodeContentPath(relativePath);
    const url = `${api}/repos/${encodeURIComponent(baselineOrg)}/${encodeURIComponent(baselineRepoName)}/contents/${contentPath}`;
    const storeLabel = `${baselineOrg}/${baselineRepoName}/${relativePath}`;

    // Write-once: if already exists, do not overwrite
    const existing = await getFileExists(token, url);
    if (existing.exists) {
        console.log(
            `::warning::Baseline já existe em ${storeLabel}. Write-once: não será sobrescrito.`
        );
        setOutput('baseline_seeded', 'false');
        setOutput('baseline_already_exists', 'true');
        console.log(
            `Gravação de baseline ignorada com sucesso (write-once): arquivo já existia em ${storeLabel}.`
        );
        return { seeded: false, alreadyExists: true };
    }

    const defaultBranch = await getDefaultBranch(token, baselineOrg, baselineRepoName);
    console.log(`API GitHub: "${api}" (mesmo fluxo em github.com, GHEC e GHES).`);
    const appName = String(scanRepository).split('/')[1] || scanRepository;
    const raw = fs.readFileSync(resultsFile);
    const message = `Baseline criado para a aplicação "${appName}" (${scanRepository})`;
    const contentBase64 = raw.toString('base64');

    const maxAttempts = putMaxAttempts();
    const retryMs = putRetryMs();
    let lastDetail = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await commitNewFileOnBranch(
            token,
            api,
            baselineOrg,
            baselineRepoName,
            defaultBranch,
            relativePath,
            contentBase64,
            message
        );

        if (result.response.ok) {
            setOutput('baseline_seeded', 'true');
            setOutput('baseline_already_exists', 'false');
            console.log(`Baseline gravado com sucesso (write-once): ${storeLabel}`);
            console.log(
                `Commit em cima do HEAD existente (README e demais arquivos preservados). ` +
                `Branch: "${defaultBranch}". Pai: ${result.headSha}. Novo commit: ${result.commitSha}.`
            );
            console.log(
                `Commit autor/committer: "${BASELINE_COMMIT_IDENTITY.name}" <${BASELINE_COMMIT_IDENTITY.email}>`
            );
            return { seeded: true, alreadyExists: false };
        }

        lastDetail = githubErrorDetail(result.json, result.text);

        if (isEmptyRepoConflict(lastDetail)) {
            throw emptyRepoError(storeLabel, lastDetail);
        }

        const verified = await getFileExists(token, url);
        if (verified.exists) {
            console.log(
                `::warning::Baseline já existia no momento do seed (HTTP ${result.response.status}). Write-once: mantido o arquivo existente.`
            );
            setOutput('baseline_seeded', 'false');
            setOutput('baseline_already_exists', 'true');
            console.log(
                `Gravação de baseline ignorada (corrida write-once): mantido o arquivo existente em ${storeLabel}.`
            );
            return { seeded: false, alreadyExists: true };
        }

        const retriable = result.response.status === 409
            || result.response.status === 422
            || /not a fast forward/i.test(lastDetail);

        if (retriable && attempt < maxAttempts) {
            const wait = retryMs * attempt;
            console.log(
                `Conflito ao atualizar ${defaultBranch} (HTTP ${result.response.status}): ${lastDetail}. ` +
                `O arquivo ${relativePath} ainda não existe — retry ${attempt}/${maxAttempts} em ${wait}ms ` +
                '(HEAD avançou; o seed será refeito em cima do commit mais recente, sem apagar o README).'
            );
            await sleep(wait);
            continue;
        }

        throw new Error(
            `Falha ao gravar baseline (HTTP ${result.response.status}) em ${storeLabel}: ${lastDetail}. ` +
            'O README.md na raiz não precisa ser removido — o seed adiciona {org}/{repo}/baseline.json em um commit filho.'
        );
    }

    throw new Error(
        `Falha ao gravar baseline após ${maxAttempts} tentativas em ${storeLabel}: ${lastDetail}. ` +
        'O arquivo não foi encontrado após o conflito; o seed NÃO foi gravado.'
    );
}

async function main() {
    const command = process.argv[2];
    const baselineOrg = (process.env.BASELINE_ORG || '').trim();
    const baselineRepoName = FIXED_BASELINE_REPO_NAME;
    const scanRepository = (process.env.SCAN_REPOSITORY || process.env.GITHUB_REPOSITORY || '').trim();
    const resultsFile = (process.env.RESULTS_FILE || 'results.json').trim();
    const outFile = (process.env.BASELINE_OUT_FILE || 'baseline.json').trim();

    if (!command) {
        throw new Error('Uso: node github-baseline.js <resolve-token|check-repo|get-baseline|put-baseline>');
    }

    if (command === 'resolve-token') {
        const { token, source } = await resolveAccessToken();
        // Do not print the token to stdout (would leak in logs). Only GITHUB_OUTPUT / env file.
        const out = process.env.GITHUB_OUTPUT;
        if (out) {
            fs.appendFileSync(out, `token=${token}\n`);
            fs.appendFileSync(out, `token_source=${source}\n`);
        }
        // For composite steps that need the token in env without logging: write to a local file
        const tokenFile = process.env.TOKEN_FILE || path.join(process.cwd(), '.baseline-github-token');
        fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 });
        process.stdout.write(`Autenticação resolvida com sucesso via: "${source}"\n`);
        process.stdout.write(`Arquivo de token escrito em: "${tokenFile}"\n`);
        if (out) {
            fs.appendFileSync(out, `token_file=${tokenFile}\n`);
        }
        return;
    }

    const { token, source } = await resolveAccessToken();
    console.log(`Autenticação no GitHub concluída com sucesso via: "${source}"`);

    if (!baselineOrg) {
        throw new Error(
            "baseline_org é obrigatório. A organização deve conter o repositório fixo 'Afrika-Veracode-Connect-Baseline'."
        );
    }

    if (command === 'check-repo') {
        await checkRepoExists(token, baselineOrg, baselineRepoName);
        console.log(
            `Repositório de baseline confirmado com sucesso: "${baselineOrg}/${baselineRepoName}"`
        );
        return;
    }

    if (command === 'get-baseline') {
        if (!scanRepository) {
            throw new Error('SCAN_REPOSITORY (org/repo) é obrigatório.');
        }
        await getBaseline(token, baselineOrg, baselineRepoName, scanRepository, outFile);
        return;
    }

    if (command === 'put-baseline') {
        if (!scanRepository) {
            throw new Error('SCAN_REPOSITORY (org/repo) é obrigatório.');
        }
        await putBaseline(token, baselineOrg, baselineRepoName, scanRepository, resultsFile);
        return;
    }

    throw new Error(`Comando desconhecido: ${command}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`::error::${err?.message || String(err)}`);
        process.exit(1);
    });
}

module.exports = {
    resolveAccessToken,
    checkRepoExists,
    getBaseline,
    putBaseline,
    baselineContentPath,
    createAppJwt,
    normalizePem,
    githubApiBase,
    githubErrorDetail,
    isEmptyRepoConflict,
    BASELINE_COMMIT_IDENTITY,
    FIXED_BASELINE_REPO_NAME
};
