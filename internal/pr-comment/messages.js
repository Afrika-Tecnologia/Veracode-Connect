'use strict';

/**
 * Catálogo de mensagens do PR Comment (erros, avisos, sucesso).
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
    LIST_COMMENTS_FAILED: 'Falha ao listar comentários do PR #{pr} (HTTP {status}).',
    UPSERT_COMMENT_FAILED: 'Falha ao publicar comentário no PR #{pr} (HTTP {status}): {detail}.',
    TOKEN_REQUIRED: 'comment_pr=true requer GITHUB_TOKEN no contexto do job.',
    REPO_REQUIRED: 'comment_pr=true requer github.repository no contexto do workflow.'
};

const warnings = {
    POST_FAILED: 'pr_comment=warning reason=post_failed detail={detail}',
    NOT_PR: 'pr_comment=skipped reason=not_pr'
};

const success = {
    CREATED: 'pr_comment=created pr={pr}',
    UPDATED: 'pr_comment=updated pr={pr}',
    SKIPPED: 'pr_comment=skipped reason={reason}'
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
    success,
    MARKER: '<!-- veracode-connect-pr-comment -->'
};
