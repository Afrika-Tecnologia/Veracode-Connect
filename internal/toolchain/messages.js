'use strict';

/**
 * Catálogo de mensagens do Toolchain (cache das ferramentas Veracode).
 *
 * Fica nesta pasta porque cada sub-action é referenciada isoladamente
 * (`Afrika-Tecnologia/Veracode-Connect/internal/toolchain@v1`).
 *
 * Node:  const { message } = require('./messages');
 * Bash:  node "$GITHUB_ACTION_PATH/messages.js" warning CHAVE [k=v ...]
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
    SHIM_NEXT_MISSING: 'veracode-connect: nenhum {bin} real encontrado no PATH após {dir}.'
};

const warnings = {
    TOOLS_PLATFORM_UNSUPPORTED: 'Cache de ferramentas desativado: runner {os}/{arch} não suportado (requer Linux). As actions oficiais baixam as ferramentas normalmente.',
    TOOL_PLATFORM_UNSUPPORTED: '{tool}: sem cache neste runner ({reason}); a action oficial fará o download direto.',
    TOOLS_REFRESH_INVALID: "tools_cache_refresh inválido ('{value}'); usando weekly.",
    TOOLS_MIRROR_INVALID: "tools_mirror_url ignorado: deve ser uma URL https:// sem espaços ou aspas ('{value}').",
    TOOL_FETCH_FAILED: '{tool}: falha ao baixar {url}; a action oficial fará o download direto.',
    TOOL_VERIFY_FAILED: '{tool}: verificação de integridade falhou ({detail}); a action oficial fará o download direto.',
    TOOL_CACHE_INVALID: '{tool}: conteúdo em cache inválido em {dir}; baixando novamente.',
    REAL_CURL_MISSING: 'curl real não encontrado no PATH; cache de ferramentas desativado nesta execução.',
    SHIMS_NOT_INSTALLED: 'Nenhuma ferramenta pronta; shims de rede não instalados.'
};

const success = {
    TOOLS_DISABLED: 'toolchain=desativado (enable_tools_cache=false)',
    TOOLS_PLAN: 'toolchain: pipeline={pipeline} cli={cli} sca={sca} refresh={refresh} periodo={period}',
    TOOL_REUSED: '{tool}: reutilizado do cache ({dir}) — 0 downloads',
    TOOL_FETCHED: '{tool}: baixado uma única vez de {url}',
    SHIMS_READY: 'shims instalados em {dir}: {count} URL(s) servidas do cache local',
    SHIM_SERVED: 'veracode-connect: {url} servido do cache local (sem rede)'
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
