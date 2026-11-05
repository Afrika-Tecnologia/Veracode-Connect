'use strict';

/**
 * Catálogo de mensagens do store de baseline (GitHub App/PAT + Contents/Git Data API).
 *
 * Compartilhado pelos baselines SAST (repo), IaC e, futuramente, SCA. Os fluxos
 * reexportam estes textos nos próprios catálogos para manter as mensagens idênticas.
 *
 * Node:  const { message, fail } = require('./messages');
 * Bash:  node "$GITHUB_ACTION_PATH/../baseline-store/messages.js" error CHAVE [k=v ...]
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {
    APP_TOKEN_FAILED:
        'Falha ao obter installation token do GitHub App (HTTP {status}): {detail}',
    AUTH_REQUIRED:
        'Acesso ao repositório de baseline requer GitHub App (baseline_github_app_id + baseline_github_app_private_key + baseline_github_app_installation_id) ou baseline_github_token (PAT).',
    INVALID_REPOSITORY:
        "repository_full_name inválido (esperado org/repo): '{scanRepository}'",
    PATH_IS_DIRECTORY:
        'Caminho inválido: esperado arquivo baseline.json, recebido diretório.',
    EXISTS_CHECK_FAILED:
        'Falha ao verificar existência do baseline (HTTP {status}): {detail}',
    EMPTY_REPO:
        'Falha ao gravar baseline em {store}: repositório vazio. {detail}',
    READ_HEAD_FAILED:
        'Falha ao ler HEAD de {repo}@{branch} (HTTP {status}): {detail}',
    READ_PARENT_COMMIT_FAILED:
        'Falha ao ler commit pai {sha} (HTTP {status}): {detail}',
    CREATE_BLOB_FAILED:
        'Falha ao criar blob do baseline (HTTP {status}): {detail}',
    CREATE_TREE_FAILED:
        'Falha ao criar tree do baseline (HTTP {status}): {detail}',
    CREATE_COMMIT_FAILED:
        'Falha ao criar commit do baseline (HTTP {status}): {detail}',
    REPO_NOT_FOUND:
        'Repositório de baseline não encontrado: {repo} (HTTP 404).',
    REPO_FORBIDDEN:
        'Acesso negado ao repositório de baseline {repo} (HTTP {status}). Requer Contents: read/write.',
    REPO_CHECK_FAILED:
        "Falha ao verificar repositório de baseline '{repo}' (HTTP {status}): {detail}",
    GET_BASELINE_FAILED:
        'Falha ao obter baseline (HTTP {status}) em {store}: {detail}',
    CONTENTS_MISSING:
        'Resposta da Contents API sem campo content.',
    RESULTS_FILE_MISSING:
        'Arquivo de resultados não encontrado: {file}',
    RULESET_PR_REQUIRED:
        'Falha ao gravar baseline em {store} (HTTP 422): ruleset exige pull request. Bypass do GitHub App na ruleset da branch é obrigatório.',
    PUT_FAILED:
        'Falha ao gravar baseline (HTTP {status}) em {store}: {detail}',
    PUT_RETRIES_EXHAUSTED:
        'Falha ao gravar baseline após {attempts} tentativas em {store}: {detail}',
    BASELINE_ORG_REQUIRED:
        "baseline_org é obrigatório. A organização deve conter o repositório de baseline (default 'Afrika-Veracode-Connect-Baseline', ou o valor de baseline_repo_name).",
    SCAN_REPOSITORY_REQUIRED:
        'SCAN_REPOSITORY (org/repo) é obrigatório.',
    UNKNOWN_KIND:
        "Tipo de baseline desconhecido: '{kind}' (esperado sast, iac ou sca).",
    STORE_CLI_USAGE:
        'Uso: node cli.js <get|put> --kind <sast|iac|sca> [--out arquivo | --file arquivo]',
    UNKNOWN_COMMAND:
        'Comando desconhecido: {command}'
};

const warnings = {
    RETRY:
        'retry {attempt}/{max} HTTP {status}: {detail}',
    SEED_NOT_DEFAULT_BRANCH:
        'baseline ausente; seed bloqueado: execução fora da default_branch={default_branch} e sem PR destinado a ela (branch={branch}).'
};

const success = {
    AUTH: 'auth={source}',
    API: 'api={api}',
    REPO: 'repo={repo}',
    BASELINE_ABSENT: 'baseline=ausente path={store}',
    BASELINE_FOUND: 'baseline=encontrado path={store}',
    LOCAL_FILE: 'local_file={file}',
    BASELINE_WRITTEN: 'baseline gravado: {store} branch={branch} sha={sha}',
    BASELINE_EXISTS_KEPT: 'baseline já existe e foi mantido (não é regravado): {store} branch={branch}',
    GIT_REF_FALLBACK: 'GET /git/ref HTTP 404; usando GET /git/refs.',
    SEED_ELIGIBLE: 'seed=elegível branch={branch} destino={target_branch}'
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

if (require.main === module) {
    try {
        const [kind, key, ...pairs] = process.argv.slice(2);
        if (!kind || !key) {
            throw new Error('Uso: node messages.js <error|success|warning> <CHAVE> [k=v ...]');
        }
        const vars = {};
        for (const pair of pairs) {
            const i = String(pair).indexOf('=');
            if (i === -1) {
                throw new Error(`Parâmetro inválido (esperado k=v): ${pair}`);
            }
            vars[pair.slice(0, i)] = pair.slice(i + 1);
        }
        process.stdout.write(message(kind, key, vars));
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = { format, message, fail, errors, warnings, success };
