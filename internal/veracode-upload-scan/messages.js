'use strict';

/**
 * Catálogo de mensagens do Veracode Upload & Scan (erros, avisos, sucesso).
 *
 * Fica nesta pasta porque GitHub só envia o diretório da sub-action
 * (`Afrika-Tecnologia/Veracode-Connect/internal/veracode-upload-scan@v1`).
 *
 * Node:  const { message, fail } = require('./messages');
 * Bash:  node "$GITHUB_ACTION_PATH/messages.js" error CHAVE [k=v ...]
 *        node "$GITHUB_ACTION_PATH/messages.js" warning CHAVE [k=v ...]
 *        node "$GITHUB_ACTION_PATH/messages.js" success CHAVE [k=v ...]
 *
 * Placeholders: {nome} interpolados por format().
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {
    SANDBOX_INVALID: "veracode_sandbox deve ser 'true', 'false' ou omitido (auto por branch).",
    SANDBOX_NAME_REQUIRED: 'veracode_sandbox=true requer veracode_sandbox_name (sandboxname).',
    FILEPATH_NOT_FOUND: 'Falha ao resolver filepath: arquivo não encontrado: {path}'
};

const warnings = {};

const success = {
    PREP_OK: 'upload_scan preparado: sandbox={sandbox} mode={mode} branch={branch}',
    FILEPATH_RESOLVED: 'filepath={path}',
    SANDBOX_NAME_SET: 'sandboxname={name}',
    GIT_REPO_URL: 'git_repository_url={url}',
    SUMMARY_WRITTEN: 'summary=escrito'
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
