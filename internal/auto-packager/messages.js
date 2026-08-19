'use strict';

/**
 * Catálogo de mensagens do Auto Packager (erros, avisos, sucesso).
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
    CLI_NOT_FOUND: "Falha ao preparar o scan file: Veracode CLI instalada, mas o binário 'veracode' não foi encontrado no PATH/workspace.",
    PACKAGE_FILE_MISSING: "Falha no Auto Packager: arquivo '{file}' não encontrado após o empacotamento.",
    SCAN_FILE_NOT_PROVIDED: "Falha ao preparar o scan file: scan_file não foi fornecido e enable_auto_packager está 'false'.",
    SCAN_FILE_NOT_FOUND: "Falha ao preparar o scan file: arquivo '{file}' não encontrado.",
    FALLBACK_ZIP_FAILED: 'Falha no fallback ZIP: app.zip não foi criado pelo zip-release.'
};

const warnings = {
    SCAN_FILE_OVERRIDES_PACKAGER: 'Auto Packager está ativo, mas scan_file foi fornecido. Usando o arquivo informado em vez de empacotar.',
    PACKAGE_EXIT_FALLBACK: "'veracode package' retornou exit code {code}; tentando fallback.",
    NO_ZIP_FALLBACK: 'Nenhum arquivo .zip gerado pela Veracode CLI. Acionando fallback (TheDoctor0/zip-release).'
};

const success = {
    SCAN_FILE_SET: 'scan_file={file} (Auto Packager ignorado — arquivo já informado)',
    SCAN_FILE_PACKAGED: 'scan_file={file} (origem: {source})',
    SCAN_FILE_VALIDATED: 'scan_file={file}',
    FALLBACK_ZIP_OK: 'scan_file=app.zip (via TheDoctor0/zip-release)',
    SCAN_FILE_CONSOLIDATED: 'scan_file={file} (origem: {source})'
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
