const fs = require('fs');

const {
    ENABLE_SCA,
    SCA_TOKEN,
    ENABLE_IAC,
    ENABLE_PIPELINE,
    ENABLE_BASELINE,
    BANTUU_KEY,
    BANTUU_URL,
    ENABLE_AUTO_PACKAGER,
    SCAN_FILE,
    ENABLE_UPLOAD,
    ENABLE_BU,
    BU_NAME,
    VID,
    VKEY,
    CREATE_ISSUES,
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_SERVER_URL
} = process.env;

console.log("::group::Validar inputs condicionais");
const erros = [];

if (!VID) erros.push("veracode_api_id é obrigatório.");
if (!VKEY) erros.push("veracode_api_key é obrigatório.");
if (CREATE_ISSUES && CREATE_ISSUES !== 'true' && CREATE_ISSUES !== 'false') {
    erros.push("create_issues deve ser 'true' ou 'false'.");
}
if (VKEY && (!/^[0-9a-fA-F]+$/.test(VKEY) || VKEY.length % 2 !== 0)) {
    erros.push("veracode_api_key deve ser uma string hexadecimal válida.");
}
if (ENABLE_SCA === 'true' && !SCA_TOKEN) erros.push("enable_sca=true requer veracode_sca_token.");
if (ENABLE_BASELINE === 'true' && !BANTUU_KEY) erros.push("enable_baseline=true requer bantuu_api_key.");

if (ENABLE_BASELINE === 'true' && BANTUU_URL) {
    if (BANTUU_URL.endsWith('/')) erros.push(`bantuu_base_url não deve terminar com barra (/). Atual: '${BANTUU_URL}'`);
    if (!/^https?:\/\//.test(BANTUU_URL)) erros.push(`bantuu_base_url deve começar com http:// ou https://. Atual: '${BANTUU_URL}'`);
}

const needsScanFile = ['true'].includes(ENABLE_PIPELINE) || ['true'].includes(ENABLE_UPLOAD) || ['true'].includes(ENABLE_BASELINE);
if (needsScanFile && ENABLE_AUTO_PACKAGER !== 'true' && !SCAN_FILE) {
    erros.push("scan_file é obrigatório quando auto_packager está desativado e pipeline/upload/baseline estão ativos.");
}

if (ENABLE_BU === 'true') {
    if (ENABLE_UPLOAD !== 'true') erros.push("enable_business_unit=true requer enable_upload_scan=true (o vínculo depende do profile criado pelo Upload & Scan).");
    if (!BU_NAME) erros.push("enable_business_unit=true requer veracode_business_unit (nome da BU).");
    if (BU_NAME?.includes(',')) erros.push("veracode_business_unit não pode conter vírgula (Veracode permite apenas uma BU por aplicação).");
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
            '| Scan | Status |',
            '|---|---|',
            '| Veracode SCA | ⏭️ Skipped |',
            '| Veracode IaC/Secrets | ⏭️ Skipped |',
            '| Bantuu Baseline Flow | ⏭️ Skipped |',
            '| Pipeline Scan | ⏭️ Skipped |',
            '| Upload & Scan | ⏭️ Skipped |',
            '| Business Unit | ⏭️ Skipped |',
            '',
            '---',
            '',
            '*Gerado por [Veracode Connect](https://github.com/Afrika-Tecnologia/Veracode-Connect)*',
        ].join('\n');
        fs.appendFileSync(summaryFile, lines);
    }

    process.exit(1);
}

function githubApiBase() {
    const serverUrl = (GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    return serverUrl === 'https://github.com'
        ? 'https://api.github.com'
        : `${serverUrl}/api/v3`;
}

function githubApiHeaders() {
    return {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
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

    const apiBase = githubApiBase();
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
                console.log("Issues habilitadas no repositório (has_issues=true).");
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

        // 422 = título inválido, mas o token tem issues:write (probe intencional).
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
            console.log("Permissão issues: write confirmada para GITHUB_TOKEN.");
        }
    } catch (err) {
        erros.push(`create_issues=true: falha ao validar pré-requisitos — ${err?.message || String(err)}`);
    }

    console.log("::endgroup::");
}

async function main() {
    await validateCreateIssuesPreconditions();

    if (erros.length > 0) {
        failValidation();
    }

    console.log("Todos os inputs validados com sucesso.");
    console.log("::endgroup::");
}

main().catch((err) => {
    console.log(`::error::${err?.message || String(err)}`);
    console.log("::endgroup::");
    process.exit(1);
});
