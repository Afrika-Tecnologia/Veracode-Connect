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

    // Write-once: if already exists, do not overwrite
    const existing = await fetchJson(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (existing.response.status === 200) {
        console.log(
            `::warning::Baseline já existe em ${baselineOrg}/${baselineRepoName}/${relativePath}. Write-once: não será sobrescrito.`
        );
        setOutput('baseline_seeded', 'false');
        setOutput('baseline_already_exists', 'true');
        console.log(
            `Gravação de baseline ignorada com sucesso (write-once): arquivo já existia em ${baselineOrg}/${baselineRepoName}/${relativePath}.`
        );
        return { seeded: false, alreadyExists: true };
    }
    if (existing.response.status !== 404) {
        throw new Error(
            `Falha ao verificar existência do baseline antes do seed (HTTP ${existing.response.status}): ${existing.text.slice(0, 300)}`
        );
    }

    const appName = String(scanRepository).split('/')[1] || scanRepository;
    const raw = fs.readFileSync(resultsFile);
    const body = {
        message: `Baseline criado para a aplicação "${appName}" (${scanRepository})`,
        content: raw.toString('base64'),
        author: BASELINE_COMMIT_IDENTITY,
        committer: BASELINE_COMMIT_IDENTITY
    };

    const { response, text } = await fetchJson(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    // Race: another job created it first
    if (response.status === 409 || response.status === 422) {
        console.log(
            `::warning::Baseline já existia no momento do seed (HTTP ${response.status}). Write-once: mantido o arquivo existente.`
        );
        setOutput('baseline_seeded', 'false');
        setOutput('baseline_already_exists', 'true');
        console.log(
            `Gravação de baseline ignorada (corrida write-once): mantido o arquivo existente em ${baselineOrg}/${baselineRepoName}/${relativePath}.`
        );
        return { seeded: false, alreadyExists: true };
    }

    if (!response.ok) {
        throw new Error(
            `Falha ao gravar baseline (HTTP ${response.status}) em ${baselineOrg}/${baselineRepoName}/${relativePath}: ${text.slice(0, 300)}`
        );
    }

    setOutput('baseline_seeded', 'true');
    setOutput('baseline_already_exists', 'false');
    console.log(
        `Baseline gravado com sucesso (write-once): ${baselineOrg}/${baselineRepoName}/${relativePath}`
    );
    console.log(
        `Commit autor/committer: "${BASELINE_COMMIT_IDENTITY.name}" <${BASELINE_COMMIT_IDENTITY.email}>`
    );
    return { seeded: true, alreadyExists: false };
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
    BASELINE_COMMIT_IDENTITY,
    FIXED_BASELINE_REPO_NAME
};
