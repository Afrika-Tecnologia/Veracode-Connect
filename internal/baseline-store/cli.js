'use strict';

/**
 * CLI do store de baseline.
 *
 *   node cli.js get --kind <sast|iac|sca> --out <arquivo>
 *       Saídas: has_baseline, baseline_repo_branch
 *   node cli.js put --kind <sast|iac|sca> --file <arquivo>
 *       Write-once. Saídas: baseline_seeded, baseline_already_exists, baseline_repo_branch
 *
 * Env: BASELINE_ORG, BASELINE_REPO_NAME, BASELINE_REPO_BRANCH, SCAN_REPOSITORY (ou GITHUB_REPOSITORY),
 *      BASELINE_GITHUB_APP_ID / _PRIVATE_KEY / _INSTALLATION_ID ou BASELINE_GITHUB_TOKEN.
 */

const fs = require('fs');
const path = require('path');
const { resolveAccessToken } = require('./github-auth');
const {
    resolveBaselineRepoName,
    resolveRequestedStoreBranch,
    readStoreFile,
    writeStoreFileOnce,
    setOutput
} = require('./github-store');
const { baselineContentPath, seedCommitMessage } = require('./kinds');
const { message, fail } = require('./messages');

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key.startsWith('--')) {
            args[key.slice(2)] = argv[i + 1];
            i += 1;
        }
    }
    return args;
}

function storeContext() {
    const baselineOrg = (process.env.BASELINE_ORG || '').trim();
    if (!baselineOrg) {
        throw fail('BASELINE_ORG_REQUIRED');
    }
    const scanRepository = (process.env.SCAN_REPOSITORY || process.env.GITHUB_REPOSITORY || '').trim();
    if (!scanRepository) {
        throw fail('SCAN_REPOSITORY_REQUIRED');
    }
    return {
        baselineOrg,
        baselineRepoName: resolveBaselineRepoName(process.env.BASELINE_REPO_NAME),
        branch: resolveRequestedStoreBranch(process.env.BASELINE_REPO_BRANCH),
        scanRepository
    };
}

async function getCommand({ kind, out }) {
    const ctx = storeContext();
    const relativePath = baselineContentPath(ctx.scanRepository, kind);
    const store = `${ctx.baselineOrg}/${ctx.baselineRepoName}/${relativePath}`;
    const { token, source } = await resolveAccessToken();
    console.log(message('success', 'AUTH', { source }));

    const result = await readStoreFile({ token, ...ctx, relativePath });
    setOutput('baseline_repo_branch', result.branch);
    if (!result.exists) {
        setOutput('has_baseline', 'false');
        console.log(message('success', 'BASELINE_ABSENT', { store }));
        return result;
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, result.content);
    setOutput('has_baseline', 'true');
    console.log(message('success', 'BASELINE_FOUND', { store }));
    console.log(message('success', 'LOCAL_FILE', { file: out }));
    return result;
}

async function putCommand({ kind, file }) {
    const ctx = storeContext();
    if (!file || !fs.existsSync(file)) {
        throw fail('RESULTS_FILE_MISSING', { file });
    }
    const { token, source } = await resolveAccessToken();
    console.log(message('success', 'AUTH', { source }));
    return writeStoreFileOnce({
        token,
        ...ctx,
        relativePath: baselineContentPath(ctx.scanRepository, kind),
        content: fs.readFileSync(file),
        commitMessage: seedCommitMessage(ctx.scanRepository, kind)
    });
}

async function main(argv) {
    const [command, ...rest] = argv;
    const args = parseArgs(rest);
    if (command === 'get' && args.kind && args.out) {
        return getCommand(args);
    }
    if (command === 'put' && args.kind && args.file) {
        return putCommand(args);
    }
    throw fail('STORE_CLI_USAGE');
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(`::error::${err?.message || String(err)}`);
        process.exit(1);
    });
}

module.exports = { main, parseArgs, getCommand, putCommand };
