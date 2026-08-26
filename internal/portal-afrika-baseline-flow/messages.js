'use strict';

/**
 * Catálogo de mensagens do Portal Afrika Baseline Flow (erros, avisos, sucesso).
 *
 * Fica nesta pasta porque GitHub só envia o diretório da sub-action
 * (`Afrika-Tecnologia/Veracode-Connect/internal/portal-afrika-baseline-flow@v1`).
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
    RESULTS_MISSING_SEED:
        'Falha ao enviar baseline para o Portal Afrika: results.json não encontrado após o Pipeline Scan.',
    SEED_UPLOAD_FAILED:
        'Falha ao enviar baseline para Portal Afrika (HTTP {status}). Verifique as credenciais.',
    SEED_UPLOAD_RESPONSE:
        'Resposta do Portal Afrika: {body}',
    RESULTS_MISSING_POLICY_CHECK:
        'Falha na verificação do Pipeline Scan: results.json não encontrado após o scan.',
    POLICY_FAIL_TRUE:
        'Pipeline Scan falhou e policy_fail=true — o job será interrompido.'
};

const warnings = {
    PORTAL_HTTP_ERROR:
        'Portal Afrika retornou HTTP {status} ao consultar baseline. Continuando sem baseline.',
    RESULTS_MISSING_UPLOAD:
        'results.json não encontrado após o Pipeline Scan com baseline. Pulando upload.',
    UPLOAD_BASELINE_FAILED:
        'Falha ao enviar resultados com baseline para o Portal Afrika (HTTP {status}). O job continua.',
    SEED_NOT_DEFAULT_BRANCH:
        'Sem baseline e a execução não está na default_branch ("{default_branch}"). O Pipeline Scan segue sem baseline e o seed NÃO será enviado ao Portal Afrika. Rode na default_branch para criar o baseline.',
    POLICY_FAIL_FALSE:
        'Pipeline Scan reportou falhas, mas policy_fail=false (o job continua).',
    FILTERED_RESULTS_MISSING:
        'filtered_results.json não encontrado; import de issues do Pipeline Scan ignorado.'
};

const success = {
    BASELINE_FOUND: 'baseline=encontrado repo={repo}',
    BASELINE_ABSENT: 'baseline=ausente repo={repo} (HTTP {status})',
    BASELINE_LOCAL_CREATED: 'baseline local criado: baseline.json',
    UPLOAD_RESULT_OK: 'upload resultado com baseline concluído (HTTP {status})',
    SEED_UPLOADED: 'baseline enviado ao Portal Afrika (HTTP {status}) repo={repo}',
    SEED_ELIGIBLE: 'seed=elegível branch={branch}',
    PIPELINE_STATUS_SET: 'pipeline_status={status}',
    ARTIFACT_NAME_SET: 'artifact_name={name}',
    FILTERED_RESULTS_FOUND: 'filtered_results.json=encontrado',
    POLICY_CHECK_OK: 'policy_fail=ok',
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
