'use strict';

/**
 * Catálogo de mensagens do Veracode SCA (erros, avisos, sucesso).
 *
 * Bash:  node "$GITHUB_ACTION_PATH/messages.js" warning CHAVE [k=v ...]
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {
    CVE_GATE_BLOCKED: 'fail_on_cve: {count} finding(s) SCA com CVE bloqueado ({list}).'
};

const warnings = {
    SCA_FAILED_CONTINUE: 'Veracode SCA retornou falha; os demais scans continuam e o bloqueio sera decidido ao final.',
    NO_SCA_RESULTS: 'Nenhum scaResults.txt/json encontrado após o scan SCA.',
    CVE_GATE_NO_RESULTS: 'fail_on_cve preenchido, mas scaResults.json válido não foi encontrado; a checagem de CVE não pôde ser avaliada.'
};

const success = {
    SCA_STATUS_SET: 'sca_status={status}',
    SCA_ARTIFACT_NORMALIZED: 'artefato_sca={file} (origem: {source})',
    ARTIFACT_NAME_SET: 'artifact_name={name}',
    SUMMARY_WRITTEN: 'summary=escrito',
    CVE_GATE_SKIPPED: 'fail_on_cve=vazio (checagem desligada)',
    CVE_GATE_CLEAR: 'fail_on_cve=ok (nenhum CVE bloqueado; pedidos={requested})'
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
