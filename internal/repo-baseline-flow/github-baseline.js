'use strict';

/**
 * Repo Baseline (SAST) e regras IaC centralizadas sobre o store compartilhado
 * (internal/baseline-store). Mantém a CLI e os exports usados pelos fluxos e testes.
 *
 * CLI:
 *   node github-baseline.js resolve-token
 *   node github-baseline.js check-repo
 *   node github-baseline.js get-baseline
 *   node github-baseline.js get-iac-config
 *   node github-baseline.js put-baseline
 */

const fs = require('fs');
const path = require('path');
const { message, fail } = require('./messages');
const auth = require('../baseline-store/github-auth');
const store = require('../baseline-store/github-store');
const kinds = require('../baseline-store/kinds');

const {
    DEFAULT_BASELINE_REPO_NAME,
    BASELINE_COMMIT_IDENTITY,
    resolveBaselineRepoName,
    resolveRequestedStoreBranch,
    resolveStoreBranch,
    contentsApiUrl,
    githubErrorDetail,
    isEmptyRepoConflict,
    isRulesetViolation,
    isRetriableRefConflict,
    checkRepoExists,
    setOutput
} = store;

const { githubApiBase, normalizePem, createAppJwt, resolveAccessToken } = auth;

function baselineContentPath(scanRepository) {
    return kinds.baselineContentPath(scanRepository, 'sast');
}

async function getBaseline(token, baselineOrg, baselineRepoName, scanRepository, outFile, branch) {
    const relativePath = baselineContentPath(scanRepository);
    const storeLabel = `${baselineOrg}/${baselineRepoName}/${relativePath}`;
    const result = await store.readStoreFile({ token, baselineOrg, baselineRepoName, relativePath, branch });
    setOutput('baseline_repo_branch', result.branch);
    if (!result.exists) {
        setOutput('has_baseline', 'false');
        console.log(message('success', 'BASELINE_ABSENT', { store: storeLabel }));
        return { hasBaseline: false };
    }
    fs.writeFileSync(outFile, result.content);
    setOutput('has_baseline', 'true');
    console.log(message('success', 'BASELINE_FOUND', { store: storeLabel }));
    console.log(message('success', 'LOCAL_FILE', { file: outFile }));
    return { hasBaseline: true, sha: result.sha };
}

async function getIacConfig(token, baselineOrg, baselineRepoName, outFile, branch) {
    setOutput('iac_config_downloaded', 'false');
    const targetBranch = await resolveStoreBranch(token, baselineOrg, baselineRepoName, branch);
    const url = contentsApiUrl(githubApiBase(), baselineOrg, baselineRepoName, 'veracode.yml', targetBranch);
    const { response, json } = await store.githubJson(token, url);
    if (response.status === 404) {
        console.log(`::warning::${message('warning', 'IAC_CONFIG_ABSENT', { repo: `${baselineOrg}/${baselineRepoName}`, branch: targetBranch })}`);
        return { hasConfig: false };
    }
    if (!response.ok) {
        throw fail('GET_IAC_CONFIG_FAILED', { status: response.status });
    }
    if (json?.type !== 'file' || json.encoding !== 'base64' || typeof json.content !== 'string') {
        throw fail('IAC_CONFIG_INVALID');
    }
    const encoded = json.content.replace(/\s/g, '');
    const content = Buffer.from(encoded, 'base64');
    if (!content.length || content.toString('base64') !== encoded) {
        throw fail('IAC_CONFIG_INVALID');
    }
    // Substitui o destino de forma atômica, sem seguir symlinks ou hard links do workspace.
    const tempDir = fs.mkdtempSync(path.join(path.dirname(outFile), '.veracode-iac-config-'));
    try {
        const tempFile = path.join(tempDir, 'veracode.yml');
        fs.writeFileSync(tempFile, content, { mode: 0o600 });
        fs.renameSync(tempFile, outFile);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
    setOutput('iac_config_downloaded', 'true');
    console.log(message('success', 'IAC_CONFIG_DOWNLOADED', { repo: `${baselineOrg}/${baselineRepoName}`, branch: targetBranch }));
    return { hasConfig: true };
}

/** Write-once: um baseline existente nunca é sobrescrito. */
async function putBaseline(token, baselineOrg, baselineRepoName, scanRepository, resultsFile, branch) {
    if (!fs.existsSync(resultsFile)) {
        throw fail('RESULTS_FILE_MISSING', { file: resultsFile });
    }
    const result = await store.writeStoreFileOnce({
        token,
        baselineOrg,
        baselineRepoName,
        relativePath: baselineContentPath(scanRepository),
        branch,
        content: fs.readFileSync(resultsFile),
        commitMessage: kinds.seedCommitMessage(scanRepository, 'sast')
    });
    return { seeded: result.seeded, alreadyExists: result.alreadyExists };
}

async function main() {
    const command = process.argv[2];
    const baselineOrg = (process.env.BASELINE_ORG || '').trim();
    const baselineRepoName = resolveBaselineRepoName(process.env.BASELINE_REPO_NAME);
    const baselineRepoBranch = resolveRequestedStoreBranch(process.env.BASELINE_REPO_BRANCH);
    const scanRepository = (process.env.SCAN_REPOSITORY || process.env.GITHUB_REPOSITORY || '').trim();
    const resultsFile = (process.env.RESULTS_FILE || 'results.json').trim();
    const outFile = (process.env.BASELINE_OUT_FILE || 'baseline.json').trim();

    if (!command) {
        throw fail('CLI_USAGE');
    }

    if (command === 'resolve-token') {
        const { token, source } = await resolveAccessToken();
        // O token nunca vai para stdout: só GITHUB_OUTPUT e arquivo local 0600.
        const out = process.env.GITHUB_OUTPUT;
        if (out) {
            fs.appendFileSync(out, `token=${token}\n`);
            fs.appendFileSync(out, `token_source=${source}\n`);
        }
        const tokenFile = process.env.TOKEN_FILE || path.join(process.cwd(), '.baseline-github-token');
        fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 });
        process.stdout.write(`${message('success', 'AUTH', { source })}\n`);
        process.stdout.write(`${message('success', 'TOKEN_FILE', { file: tokenFile })}\n`);
        if (out) {
            fs.appendFileSync(out, `token_file=${tokenFile}\n`);
        }
        return;
    }

    const { token, source } = await resolveAccessToken();
    console.log(message('success', 'AUTH', { source }));

    if (!baselineOrg) {
        throw fail('BASELINE_ORG_REQUIRED');
    }

    if (command === 'check-repo') {
        await checkRepoExists(token, baselineOrg, baselineRepoName);
        console.log(message('success', 'REPO', { repo: `${baselineOrg}/${baselineRepoName}` }));
        return;
    }
    if (command === 'get-baseline') {
        if (!scanRepository) throw fail('SCAN_REPOSITORY_REQUIRED');
        await getBaseline(token, baselineOrg, baselineRepoName, scanRepository, outFile, baselineRepoBranch);
        return;
    }
    if (command === 'get-iac-config') {
        const configFile = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), 'veracode.yml');
        await getIacConfig(token, baselineOrg, baselineRepoName, configFile, baselineRepoBranch);
        return;
    }
    if (command === 'put-baseline') {
        if (!scanRepository) throw fail('SCAN_REPOSITORY_REQUIRED');
        await putBaseline(token, baselineOrg, baselineRepoName, scanRepository, resultsFile, baselineRepoBranch);
        return;
    }
    throw fail('UNKNOWN_COMMAND', { command });
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
    getIacConfig,
    putBaseline,
    baselineContentPath,
    createAppJwt,
    normalizePem,
    githubApiBase,
    githubErrorDetail,
    isEmptyRepoConflict,
    isRulesetViolation,
    isRetriableRefConflict,
    BASELINE_COMMIT_IDENTITY,
    DEFAULT_BASELINE_REPO_NAME,
    resolveBaselineRepoName,
    resolveRequestedStoreBranch,
    resolveStoreBranch,
    contentsApiUrl
};
