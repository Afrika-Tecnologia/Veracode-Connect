'use strict';

/**
 * Catálogo de mensagens do ensure-runtime.
 * GitHub só envia o diretório desta sub-action.
 *
 * Bash:  node "$GITHUB_ACTION_PATH/messages.js" error CHAVE [k=v ...]
 *
 * Exceção: o step de bootstrap do curl (e erros de download do Node quando
 * node ainda não está no PATH) não pode invocar este arquivo — ver action.yml.
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {
    CURL_WGET_MISSING: 'Impossível baixar dependências: nem curl nem wget disponíveis no runner.',
    NODE_TARBALL_MISSING: 'Não foi possível encontrar binário do Node.js {major}.x para {arch}.',
    NODE_INSTALL_FAILED: 'Instalação do Node.js falhou: binário não encontrado em {path}.',
    JQ_INSTALL_FAILED: 'Falha ao instalar jq. Runner sem package manager e arquitetura não suportada para download direto.',
    PKG_INSTALL_FAILED: 'Falha ao instalar {cmd}. Nenhum package manager disponível no runner.'
};

const warnings = {
    CURL_MISSING_WGET: 'curl indisponível; wget presente — continuando com wget.'
};

const success = {
    TOOL_OK: '{cmd}=ok version={version}',
    TOOL_INSTALLED: '{cmd}=instalado version={version}',
    TOOL_INSTALLING: '{cmd}=ausente — instalando',
    NODE_OK: 'node=ok version={version}',
    NODE_UPGRADING: 'node={version} < v{major} — atualizando',
    NODE_DOWNLOADING: 'node=baixando url={url}',
    JQ_DOWNLOADING: 'jq=baixando url={url}'
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
