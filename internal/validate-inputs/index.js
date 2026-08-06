const fs = require('fs');
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
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_SERVER_URL,
    BASELINE_ORG,
    BASELINE_GITHUB_APP_ID,
    BASELINE_GITHUB_APP_PRIVATE_KEY,
    BASELINE_GITHUB_APP_INSTALLATION_ID,
    BASELINE_GITHUB_TOKEN
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
console.log(`Modo de baseline resolvido: "${resolvedBaselineMode}"`);

if (!VID) erros.push("veracode_api_id é obrigatório.");
if (!VKEY) erros.push("veracode_api_key é obrigatório.");
if (CREATE_ISSUES && CREATE_ISSUES !== 'true' && CREATE_ISSUES !== 'false') {
    erros.push("create_issues deve ser 'true' ou 'false'.");
}
if (VKEY && (!/^[0-9a-fA-F]+$/.test(VKEY) || VKEY.length % 2 !== 0)) {
    erros.push("veracode_api_key deve ser uma string hexadecimal válida.");
}
if (ENABLE_SCA === 'true' && !SCA_TOKEN) erros.push("enable_sca=true requer veracode_sca_token.");

if (resolvedBaselineMode === 'portal_afrika') {
    if (!PORTAL_AFRIKA_KEY) erros.push("baseline_mode=portal_afrika requer portal_afrika_api_key.");
    if (PORTAL_AFRIKA_URL) {
        if (PORTAL_AFRIKA_URL.endsWith('/')) erros.push(`portal_afrika_base_url não deve terminar com barra (/). Atual: '${PORTAL_AFRIKA_URL}'`);
        if (!/^https?:\/\//.test(PORTAL_AFRIKA_URL)) erros.push(`portal_afrika_base_url deve começar com http:// ou https://. Atual: '${PORTAL_AFRIKA_URL}'`);
    }
}

if (resolvedBaselineMode === 'repo') {
    const baselineOrg = (BASELINE_ORG || '').trim();
    const appId = (BASELINE_GITHUB_APP_ID || '').trim();
    const appKey = (BASELINE_GITHUB_APP_PRIVATE_KEY || '').trim();
    const appInstall = (BASELINE_GITHUB_APP_INSTALLATION_ID || '').trim();
    const pat = (BASELINE_GITHUB_TOKEN || '').trim();

    if (!baselineOrg) {
        erros.push(
            "baseline_mode=repo requer baseline_org. A organização informada deve conter o repositório fixo 'Afrika-Veracode-Connect-Baseline'."
        );
    }

    const hasApp = Boolean(appId && appKey && appInstall);
    const hasPat = Boolean(pat);
    if (!hasApp && !hasPat) {
        erros.push(
            "baseline_mode=repo requer GitHub App (baseline_github_app_id + baseline_github_app_private_key + baseline_github_app_installation_id) ou baseline_github_token (PAT)."
        );
    } else if ((appId || appKey || appInstall) && !hasApp && !hasPat) {
        erros.push(
            "GitHub App incompleto: informe baseline_github_app_id, baseline_github_app_private_key e baseline_github_app_installation_id (ou use baseline_github_token)."
        );
    } else if ((appId || appKey || appInstall) && !hasApp && hasPat) {
        console.log("::warning::Credenciais de GitHub App incompletas; usando baseline_github_token (PAT) como fallback.");
    }

    setOutput('baseline_org', baselineOrg);
}

const needsScanFile =
    ['true'].includes(ENABLE_PIPELINE) ||
    ['true'].includes(ENABLE_UPLOAD) ||
    resolvedBaselineMode === 'portal_afrika' ||
    resolvedBaselineMode === 'repo';

if (needsScanFile && ENABLE_AUTO_PACKAGER !== 'true' && !SCAN_FILE) {
    erros.push("scan_file é obrigatório quando auto_packager está desativado e pipeline/upload/baseline estão ativos.");
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
        erros.push("create_issues=true requer GITHUB_TOKEN no contexto do job.");
        console.log("::endgroup::");
        return;
    }
    if (!GITHUB_REPOSITORY) {
        erros.push("create_issues=true requer github.repository no contexto do workflow.");
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
            erros.push(
                "create_issues=true: token sem acesso ao repositório (HTTP " + repoResponse.status + "). " +
                "Verifique permissions do workflow (mínimo contents: read)."
            );
        } else if (!repoResponse.ok) {
            erros.push(
                `create_issues=true: não foi possível consultar o repositório (HTTP ${repoResponse.status}).`
            );
        } else {
            const repo = await repoResponse.json();
            if (repo.has_issues === false) {
                erros.push(
                    "create_issues=true requer Issues habilitadas no repositório. " +
                    "No GitHub: Settings → General → Features → Issues."
                );
            } else {
                console.log("Issues habilitadas no repositório (has_issues=true) — verificação OK.");
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
            erros.push(
                "create_issues=true requer permissão issues: write no job do workflow que chama o Veracode Connect. " +
                "Actions composite não declaram permissions — configure no workflow:\n\n" +
                "permissions:\n  contents: read\n  issues: write\n\n" +
                "Ou no job:\n\n" +
                "jobs:\n  security:\n    permissions:\n      contents: read\n      issues: write"
            );
        } else if (response.status !== 422 && response.status !== 201) {
            erros.push(
                `create_issues=true: não foi possível confirmar issues: write (HTTP ${response.status}). ` +
                "Verifique as permissions do workflow."
            );
        } else {
            console.log("Permissão issues: write confirmada com sucesso para GITHUB_TOKEN.");
        }
    } catch (err) {
        erros.push(`create_issues=true: falha ao validar pré-requisitos — ${err?.message || String(err)}`);
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
        console.log(`Repositório de baseline OK: "${baselineOrg}/${baselineRepoName}"`);
    } catch (err) {
        erros.push(err?.message || String(err));
    }
    console.log("::endgroup::");
}

async function main() {
    await validateCreateIssuesPreconditions();
    await validateRepoBaselinePreconditions();

    if (erros.length > 0) {
        failValidation();
    }

    console.log("Validação de inputs concluída com sucesso.");
    console.log("::endgroup::");
}

main().catch((err) => {
    console.log(`::error::${err?.message || String(err)}`);
    console.log("::endgroup::");
    process.exit(1);
});
