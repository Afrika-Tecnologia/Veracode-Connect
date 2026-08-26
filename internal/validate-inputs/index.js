const fs = require('fs');
const { message, fail } = require('./messages');
const {
    resolveAccessToken,
    assertBaselineRepoExists,
    resolveBaselineMode
} = require('./baseline-auth');

const {
    ENABLE_SCA,
    SCA_TOKEN,
    ENABLE_PIPELINE,
    BASELINE_MODE,
    PORTAL_AFRIKA_KEY,
    PORTAL_AFRIKA_URL,
    ENABLE_AUTO_PACKAGER,
    SCAN_FILE,
    ENABLE_UPLOAD,
    VID,
    VKEY,
    CREATE_ISSUES,
    COMMENT_PR,
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_SERVER_URL,
    BASELINE_ORG,
    BASELINE_GITHUB_APP_ID,
    BASELINE_GITHUB_APP_PRIVATE_KEY,
    BASELINE_GITHUB_APP_INSTALLATION_ID,
    BASELINE_GITHUB_TOKEN,
    VERACODE_SANDBOX,
    VERACODE_SANDBOX_NAME
} = process.env;

console.log("::group::Validar inputs condicionais");
const erros = [];

function setOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (out) {
        fs.appendFileSync(out, `${name}=${value}\n`);
    }
}

const modeResult = resolveBaselineMode({
    BASELINE_MODE
});
if (modeResult.error) {
    erros.push(modeResult.error);
}
const resolvedBaselineMode = modeResult.mode || 'none';
setOutput('baseline_mode', resolvedBaselineMode);
console.log(message('success', 'BASELINE_MODE_RESOLVED', { mode: resolvedBaselineMode }));

if (!VID) erros.push(message('error', 'VID_REQUIRED'));
if (!VKEY) erros.push(message('error', 'VKEY_REQUIRED'));
if (CREATE_ISSUES && CREATE_ISSUES !== 'true' && CREATE_ISSUES !== 'false') {
    erros.push(message('error', 'CREATE_ISSUES_INVALID'));
}
if (COMMENT_PR && COMMENT_PR !== 'true' && COMMENT_PR !== 'false') {
    erros.push(message('error', 'COMMENT_PR_INVALID'));
}
if (VKEY && (!/^[0-9a-fA-F]+$/.test(VKEY) || VKEY.length % 2 !== 0)) {
    erros.push(message('error', 'VKEY_INVALID_HEX'));
}
if (ENABLE_SCA === 'true' && !SCA_TOKEN) erros.push(message('error', 'SCA_TOKEN_REQUIRED'));

if (resolvedBaselineMode === 'portal_afrika') {
    if (!PORTAL_AFRIKA_KEY) erros.push(message('error', 'PORTAL_AFRIKA_KEY_REQUIRED'));
    if (PORTAL_AFRIKA_URL) {
        if (PORTAL_AFRIKA_URL.endsWith('/')) erros.push(message('error', 'PORTAL_URL_TRAILING_SLASH', { url: PORTAL_AFRIKA_URL }));
        if (!/^https?:\/\//.test(PORTAL_AFRIKA_URL)) erros.push(message('error', 'PORTAL_URL_INVALID_SCHEME', { url: PORTAL_AFRIKA_URL }));
    }
}

if (resolvedBaselineMode === 'repo') {
    const baselineOrg = (BASELINE_ORG || '').trim();
    const appId = (BASELINE_GITHUB_APP_ID || '').trim();
    const appKey = (BASELINE_GITHUB_APP_PRIVATE_KEY || '').trim();
    const appInstall = (BASELINE_GITHUB_APP_INSTALLATION_ID || '').trim();
    const pat = (BASELINE_GITHUB_TOKEN || '').trim();

    if (!baselineOrg) {
        erros.push(message('error', 'BASELINE_ORG_REQUIRED'));
    }

    const hasApp = Boolean(appId && appKey && appInstall);
    const hasPat = Boolean(pat);
    if (!hasApp && !hasPat) {
        erros.push(message('error', 'BASELINE_AUTH_REQUIRED'));
    } else if ((appId || appKey || appInstall) && !hasApp && !hasPat) {
        erros.push(message('error', 'BASELINE_APP_INCOMPLETE'));
    } else if ((appId || appKey || appInstall) && !hasApp && hasPat) {
        console.log("::warning::" + message('warning', 'APP_INCOMPLETE_PAT_FALLBACK'));
    }

    setOutput('baseline_org', baselineOrg);
}

const needsScanFile =
    ['true'].includes(ENABLE_PIPELINE) ||
    ['true'].includes(ENABLE_UPLOAD) ||
    resolvedBaselineMode === 'portal_afrika' ||
    resolvedBaselineMode === 'repo';

if (needsScanFile && ENABLE_AUTO_PACKAGER !== 'true' && !SCAN_FILE) {
    erros.push(message('error', 'SCAN_FILE_REQUIRED'));
}

const sandboxFlag = (VERACODE_SANDBOX || '').trim();
const sandboxName = (VERACODE_SANDBOX_NAME || '').trim();
if (sandboxFlag && sandboxFlag !== 'true' && sandboxFlag !== 'false') {
    erros.push(message('error', 'SANDBOX_INVALID'));
}
if (sandboxFlag === 'true' && !sandboxName) {
    erros.push(message('error', 'SANDBOX_NAME_REQUIRED'));
}

function failValidation() {
    console.log("\n============================================");
    console.log("  VALIDAÇÃO DE INPUTS FALHOU");
    console.log("============================================");
    for (const e of erros) {
        console.log(`::error::${e}`);
    }
    console.log("============================================");
    console.log("::endgroup::");

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
        const lines = [
            '---',
            '',
            '## 🛡️ Veracode Connect — Resumo Final',
            '',
            '> ❌ **Build travado** — Validação de inputs falhou antes de qualquer scan',
            '',
            '### ❌ Inputs inválidos ou ausentes',
            '',
            ...erros.map(e => `- ❌ ${e}`),
            '',
            '---',
            '',
            '*Gerado por [Veracode Connect](https://github.com/Afrika-Tecnologia/Veracode-Connect)*',
        ].join('\n');
        fs.appendFileSync(summaryFile, lines);
    }

    process.exit(1);
}

function githubApiHeaders() {
    return {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

function createIssuesApiBase() {
    const serverUrl = (GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    return serverUrl === 'https://github.com'
        ? 'https://api.github.com'
        : `${serverUrl}/api/v3`;
}

async function validateCreateIssuesPreconditions() {
    if (CREATE_ISSUES !== 'true') {
        return;
    }

    console.log("::group::Validar create_issues (Issues habilitadas + issues: write)");
    if (!GITHUB_TOKEN) {
        erros.push(message('error', 'ISSUES_TOKEN_REQUIRED'));
        console.log("::endgroup::");
        return;
    }
    if (!GITHUB_REPOSITORY) {
        erros.push(message('error', 'ISSUES_REPO_REQUIRED'));
        console.log("::endgroup::");
        return;
    }

    const apiBase = createIssuesApiBase();
    let repoMetadataOk = false;

    try {
        const repoResponse = await fetch(`${apiBase}/repos/${GITHUB_REPOSITORY}`, {
            method: 'GET',
            headers: githubApiHeaders()
        });

        if (repoResponse.status === 403 || repoResponse.status === 401) {
            erros.push(message('error', 'ISSUES_TOKEN_FORBIDDEN', { status: repoResponse.status }));
        } else if (!repoResponse.ok) {
            erros.push(message('error', 'ISSUES_REPO_QUERY_FAILED', { status: repoResponse.status }));
        } else {
            const repo = await repoResponse.json();
            if (repo.has_issues === false) {
                erros.push(message('error', 'ISSUES_DISABLED'));
            } else {
                console.log(message('success', 'ISSUES_ENABLED_OK'));
                repoMetadataOk = true;
            }
        }

        if (!repoMetadataOk) {
            console.log("::endgroup::");
            return;
        }

        const response = await fetch(`${apiBase}/repos/${GITHUB_REPOSITORY}/issues`, {
            method: 'POST',
            headers: {
                ...githubApiHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: '',
                body: 'veracode-connect-permission-probe'
            })
        });

        if (response.status === 403 || response.status === 401) {
            erros.push(message('error', 'ISSUES_WRITE_FORBIDDEN'));
        } else if (response.status !== 422 && response.status !== 201) {
            erros.push(message('error', 'ISSUES_WRITE_UNCONFIRMED', { status: response.status }));
        } else {
            console.log(message('success', 'ISSUES_WRITE_OK'));
        }
    } catch (err) {
        erros.push(message('error', 'ISSUES_VALIDATION_FAILED', { detail: err?.message || String(err) }));
    }

    console.log("::endgroup::");
}

async function validateCommentPrPreconditions() {
    if (COMMENT_PR !== 'true') {
        return;
    }

    console.log("::group::Validar comment_pr (pull-requests: write)");
    if (!GITHUB_TOKEN) {
        erros.push(message('error', 'COMMENT_PR_TOKEN_REQUIRED'));
        console.log("::endgroup::");
        return;
    }
    if (!GITHUB_REPOSITORY) {
        erros.push(message('error', 'COMMENT_PR_REPO_REQUIRED'));
        console.log("::endgroup::");
        return;
    }

    const apiBase = createIssuesApiBase();

    try {
        const pullsResponse = await fetch(`${apiBase}/repos/${GITHUB_REPOSITORY}/pulls?state=open&per_page=1`, {
            method: 'GET',
            headers: githubApiHeaders()
        });

        if (pullsResponse.status === 403 || pullsResponse.status === 401) {
            erros.push(message('error', 'COMMENT_PR_TOKEN_FORBIDDEN', { status: pullsResponse.status }));
            console.log("::endgroup::");
            return;
        }
        if (!pullsResponse.ok) {
            erros.push(message('error', 'COMMENT_PR_PULLS_QUERY_FAILED', { status: pullsResponse.status }));
            console.log("::endgroup::");
            return;
        }

        console.log(message('success', 'COMMENT_PR_PULLS_READ_OK'));
        const pulls = await pullsResponse.json();
        const probePr = pulls[0]?.number;

        if (!probePr) {
            console.log("::endgroup::");
            return;
        }

        const response = await fetch(`${apiBase}/repos/${GITHUB_REPOSITORY}/issues/${probePr}/comments`, {
            method: 'POST',
            headers: {
                ...githubApiHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ body: '' })
        });

        if (response.status === 403 || response.status === 401) {
            erros.push(message('error', 'COMMENT_PR_WRITE_FORBIDDEN'));
        } else if (response.status !== 422 && response.status !== 201) {
            erros.push(message('error', 'COMMENT_PR_WRITE_UNCONFIRMED', { status: response.status }));
        } else {
            console.log(message('success', 'COMMENT_PR_WRITE_OK'));
        }
    } catch (err) {
        erros.push(message('error', 'COMMENT_PR_VALIDATION_FAILED', { detail: err?.message || String(err) }));
    }

    console.log("::endgroup::");
}

async function validateRepoBaselinePreconditions() {
    if (resolvedBaselineMode !== 'repo') {
        return;
    }
    if (erros.length > 0) {
        return;
    }

    console.log("::group::Validar repositório de baseline (existência + acesso)");
    const baselineOrg = (BASELINE_ORG || '').trim();
    const baselineRepoName = 'Afrika-Veracode-Connect-Baseline';

    try {
        const token = await resolveAccessToken();
        await assertBaselineRepoExists(token, baselineOrg, baselineRepoName);
        console.log(message('success', 'BASELINE_REPO_OK', { repo: `${baselineOrg}/${baselineRepoName}` }));
    } catch (err) {
        erros.push(err?.message || String(err));
    }
    console.log("::endgroup::");
}

async function main() {
    await validateCreateIssuesPreconditions();
    await validateCommentPrPreconditions();
    await validateRepoBaselinePreconditions();

    if (erros.length > 0) {
        failValidation();
    }

    console.log(message('success', 'VALIDATION_OK'));
    console.log("::endgroup::");
}

main().catch((err) => {
    console.log(`::error::${err?.message || String(err)}`);
    console.log("::endgroup::");
    process.exit(1);
});
