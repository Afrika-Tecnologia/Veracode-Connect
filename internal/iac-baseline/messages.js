'use strict';

/**
 * Catálogo de mensagens do baseline IaC/Secrets.
 *
 * Node:  const { message, fail } = require('./messages');
 * Bash:  node "$GITHUB_ACTION_PATH/../iac-baseline/messages.js" warning CHAVE [k=v ...]
 */

function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

const errors = {
    RESULTS_INVALID:
        'Resultado IaC inválido ou ausente em {file}: esperado JSON com vulnerabilities, secrets ou configs.',
    BASELINE_INVALID:
        'Baseline IaC inválido em {file}: esperado JSON com schema_version, fingerprint_version e findings.',
    CLI_USAGE:
        'Uso: node iac-baseline.js <build|evaluate|summary-md> [opções]'
};

const warnings = {
    BASELINE_READ_FAILED:
        'Não foi possível ler o baseline IaC do repositório de baseline; a comparação foi ignorada e o IaC não bloqueia nesta execução.',
    SCAN_NOT_VALID:
        'Scan IaC sem resultado válido; a comparação com o baseline foi ignorada e o IaC não bloqueia nesta execução.',
    FINGERPRINT_VERSION_MISMATCH:
        'O baseline IaC foi gravado com fingerprint_version={stored}, diferente da atual ({current}). A comparação foi ignorada; apague {file} no repositório de baseline para gravar um novo.',
    BASELINE_PARSE_FAILED:
        'Baseline IaC ilegível; a comparação foi ignorada. Apague {file} no repositório de baseline para gravar um novo.',
    NEW_POLICY_FINDINGS:
        '{count} finding(s) IaC novo(s) em relação ao baseline violam a política {policy}.'
};

const success = {
    BASELINE_DEFERRED:
        'Sem baseline IaC: findings da política não bloqueiam esta execução.',
    COMPARED:
        'Baseline IaC comparado: novos que afetam a política={new_policy}, novos que não afetam={new_other}, backlog={backlog}, corrigidos={fixed}.',
    BUILT:
        'Baseline IaC normalizado: {count} finding(s) em {file}.'
};

const catalogs = { error: errors, errors, warning: warnings, warnings, success };

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
            if (i === -1) throw new Error(`Parâmetro inválido (esperado k=v): ${pair}`);
            vars[pair.slice(0, i)] = pair.slice(i + 1);
        }
        process.stdout.write(message(kind, key, vars));
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = { format, message, fail, errors, warnings, success };
