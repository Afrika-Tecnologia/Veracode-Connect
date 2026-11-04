'use strict';

/**
 * Catálogo de mensagens do Dependency Cache (cache Maven/Gradle e mirror Maven).
 *
 * Node:  const { message } = require('./messages');
 * Bash:  node "$GITHUB_ACTION_PATH/messages.js" success CHAVE [k=v ...]
 *
 * Placeholders: {nome} interpolados por format().
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {};

const warnings = {
    MAVEN_SETTINGS_EXISTS: 'maven_mirror_url ignorado: {file} já existe e não será sobrescrito. Configure o mirror nesse arquivo.',
    DEPS_NO_BUILD_FILES: 'Cache de dependências não usado: nenhum pom.xml, build.gradle(.kts) ou wrapper Maven/Gradle encontrado no workspace.'
};

const success = {
    MAVEN_SETTINGS_WRITTEN: 'settings.xml temporário criado em {file} com mirror {url}',
    MAVEN_SETTINGS_REMOVED: 'settings.xml temporário removido ({file})',
    DEPS_KEY: 'deps_cache_key={key}'
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
    parseVars,
    errors,
    warnings,
    success
};
