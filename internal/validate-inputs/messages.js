'use strict';

/**
 * Catálogo de mensagens do Validate Inputs (erros, avisos, sucesso).
 *
 * Node:  const { message, fail } = require('./messages');
 * Bash:  node "$GITHUB_ACTION_PATH/messages.js" error CHAVE [k=v ...]
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {
    VID_REQUIRED: 'veracode_api_id é obrigatório.',
    VKEY_REQUIRED: 'veracode_api_key é obrigatório.',
    VKEY_INVALID_HEX: 'veracode_api_key deve ser uma string hexadecimal válida.',
    CREATE_ISSUES_INVALID: "create_issues deve ser 'true' ou 'false'.",
    COMMENT_PR_INVALID: "comment_pr deve ser 'true' ou 'false'.",
    SCA_TOKEN_REQUIRED: 'enable_sca=true requer veracode_sca_token.',
    PORTAL_AFRIKA_KEY_REQUIRED: 'baseline_mode=portal_afrika requer portal_afrika_api_key.',
    PORTAL_URL_TRAILING_SLASH: "portal_afrika_base_url não deve terminar com barra (/). Atual: '{url}'",
    PORTAL_URL_INVALID_SCHEME: "portal_afrika_base_url deve começar com http:// ou https://. Atual: '{url}'",
    BASELINE_ORG_REQUIRED: "baseline_mode=repo requer baseline_org. A organização informada deve conter o repositório fixo 'Afrika-Veracode-Connect-Baseline'.",
    BASELINE_AUTH_REQUIRED: 'baseline_mode=repo requer GitHub App (baseline_github_app_id + baseline_github_app_private_key + baseline_github_app_installation_id) ou baseline_github_token (PAT).',
    BASELINE_APP_INCOMPLETE: 'GitHub App incompleto: informe baseline_github_app_id, baseline_github_app_private_key e baseline_github_app_installation_id (ou use baseline_github_token).',
    SCAN_FILE_REQUIRED: "scan_file é obrigatório quando auto_packager está desativado e pipeline/upload/baseline estão ativos.",
    SANDBOX_INVALID: "veracode_sandbox deve ser 'true', 'false' ou omitido (auto por branch).",
    SANDBOX_NAME_REQUIRED: 'veracode_sandbox=true requer veracode_sandbox_name.',
    BASELINE_MODE_INVALID: "baseline_mode inválido: '{mode}'. Use 'none', 'portal_afrika' ou 'repo'.",
    ISSUES_TOKEN_REQUIRED: 'create_issues=true requer GITHUB_TOKEN no contexto do job.',
    ISSUES_REPO_REQUIRED: 'create_issues=true requer github.repository no contexto do workflow.',
    ISSUES_TOKEN_FORBIDDEN: 'create_issues=true: token sem acesso ao repositório (HTTP {status}). Verifique permissions do workflow (mínimo contents: read).',
    ISSUES_REPO_QUERY_FAILED: 'create_issues=true: não foi possível consultar o repositório (HTTP {status}).',
    ISSUES_DISABLED: 'create_issues=true requer Issues habilitadas no repositório. No GitHub: Settings → General → Features → Issues.',
    ISSUES_WRITE_FORBIDDEN: "create_issues=true requer permissão issues: write no job do workflow que chama o Veracode Connect. Actions composite não declaram permissions — configure no workflow:\n\npermissions:\n  contents: read\n  issues: write\n\nOu no job:\n\njobs:\n  security:\n    permissions:\n      contents: read\n      issues: write",
    ISSUES_WRITE_UNCONFIRMED: 'create_issues=true: não foi possível confirmar issues: write (HTTP {status}). Verifique as permissions do workflow.',
    ISSUES_VALIDATION_FAILED: 'create_issues=true: falha ao validar pré-requisitos — {detail}',
    COMMENT_PR_TOKEN_REQUIRED: 'comment_pr=true requer GITHUB_TOKEN no contexto do job.',
    COMMENT_PR_REPO_REQUIRED: 'comment_pr=true requer github.repository no contexto do workflow.',
    COMMENT_PR_TOKEN_FORBIDDEN: 'comment_pr=true: token sem acesso ao repositório (HTTP {status}). Verifique permissions do workflow (mínimo contents: read).',
    COMMENT_PR_PULLS_QUERY_FAILED: 'comment_pr=true: não foi possível consultar pull requests (HTTP {status}).',
    COMMENT_PR_WRITE_FORBIDDEN: "comment_pr=true requer permissão pull-requests: write no job do workflow que chama o Veracode Connect. Actions composite não declaram permissions — configure no workflow:\n\npermissions:\n  contents: read\n  pull-requests: write\n\nOu no job:\n\njobs:\n  security:\n    permissions:\n      contents: read\n      pull-requests: write",
    COMMENT_PR_WRITE_UNCONFIRMED: 'comment_pr=true: não foi possível confirmar pull-requests: write (HTTP {status}). Verifique as permissions do workflow.',
    COMMENT_PR_VALIDATION_FAILED: 'comment_pr=true: falha ao validar pré-requisitos — {detail}',
    APP_TOKEN_FAILED: 'Falha ao obter installation token do GitHub App (HTTP {status}): {detail}',
    AUTH_REQUIRED: 'baseline_mode=repo requer GitHub App (baseline_github_app_id + private_key + installation_id) ou baseline_github_token (PAT).',
    BASELINE_REPO_NOT_FOUND: "Repositório de baseline '{repo}' não existe. Crie o repositório privado antes de usar baseline_mode=repo.",
    BASELINE_REPO_FORBIDDEN: "Sem acesso ao repositório de baseline '{repo}' (HTTP {status}). Verifique o GitHub App/PAT (contents: read/write) e a instalação na org correta.",
    BASELINE_REPO_CHECK_FAILED: "Falha ao verificar repositório de baseline '{repo}' (HTTP {status}): {detail}"
};

const warnings = {
    APP_INCOMPLETE_PAT_FALLBACK: 'Credenciais de GitHub App incompletas; usando baseline_github_token (PAT) como fallback.'
};

const success = {
    BASELINE_MODE_RESOLVED: 'baseline_mode={mode}',
    ISSUES_ENABLED_OK: 'has_issues=true',
    ISSUES_WRITE_OK: 'issues:write=ok',
    COMMENT_PR_PULLS_READ_OK: 'pull-requests:read=ok',
    COMMENT_PR_WRITE_OK: 'pull-requests:write=ok',
    BASELINE_REPO_OK: 'baseline_repo={repo}',
    VALIDATION_OK: 'validação=ok'
};

const catalogs = {
    error: errors,
    errors,
    warning: warnings,
    warnings,
    success
};

function message(kind, key, vars) {
    const catalog = catalogs[kind];
    if (!catalog) {
        throw new Error(`Catálogo desconhecido: ${kind}`);
    }
    const template = catalog[key];
    if (template == null) {
        throw new Error(`Mensagem desconhecida: ${kind}.${key}`);
    }
    return format(template, vars);
}

function fail(key, vars) {
    return new Error(message('error', key, vars));
}

function parseVars(pairs) {
    const vars = {};
    for (const pair of pairs) {
        const i = String(pair).indexOf('=');
        if (i === -1) {
            throw new Error(`Parâmetro inválido (esperado k=v): ${pair}`);
        }
        vars[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return vars;
}

if (require.main === module) {
    try {
        const [kind, key, ...pairs] = process.argv.slice(2);
        if (!kind || !key) {
            throw new Error('Uso: node messages.js <error|success|warning> <CHAVE> [k=v ...]');
        }
        process.stdout.write(message(kind, key, parseVars(pairs)));
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    format,
    message,
    fail,
    parseVars,
    errors,
    warnings,
    success
};
