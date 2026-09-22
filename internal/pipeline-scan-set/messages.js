'use strict';

/**
 * Catálogo de mensagens do Pipeline Scan Set.
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
    NO_SCAN_FILES: 'Nenhum artefato informado para o Pipeline Scan.',
    RESULTS_MISSING: 'Nenhum results-K.json válido após os Pipeline Scans.',
    CLI_USAGE: 'Uso: node merge-results.js <plan|retry-plan|merge>'
};

const warnings = {
    SCAN_ERROR: 'Pipeline Scan do artefato {file} falhou (scan_error).',
    UNSCANNABLE:
        'Pipeline Scan do artefato {file}: nada a analisar (unscannable) — slot ignorado, esteira não trava.',
    ALL_UNSCANNABLE:
        'Todos os artefatos do Pipeline Scan foram unscannable; results.json vazio gravado para o gate seguir.',
    RETRY_WAIT: 'Aguardando {seconds}s antes de repetir {count} Pipeline Scan(s) sem resultado válido.',
    SLOT_RETRY: 'Repetindo Pipeline Scan do slot {slot} ({file}).'
};

const success = {
    PLAN_OK: 'pipeline-scan-set: {count} artefato(s) planejado(s)',
    MERGE_OK: 'pipeline-scan-set: scanned={scanned} errors={errors} policy={policy}',
    NO_RETRY: 'Nenhum slot exige retry.'
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
