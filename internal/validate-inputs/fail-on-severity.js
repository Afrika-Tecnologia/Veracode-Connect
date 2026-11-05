'use strict';

/**
 * Normaliza fail_on_severity para o Pipeline Scan oficial.
 *
 * A Veracode-pipeline-scan-action monta o comando concatenando
 * `--fail_on_severity <valor>` sem aspas e o executa num shell, então
 * "Very High, High" vira argumentos soltos e o pipeline-scan.jar aborta.
 * Aqui só severidades conhecidas são aceitas e o valor sai entre aspas
 * duplas, que é seguro porque a lista resultante só tem letras, espaço e vírgula.
 */
const SEVERITIES = ['Very High', 'High', 'Medium', 'Low', 'Very Low', 'Informational'];
const BY_KEY = new Map(SEVERITIES.map((s) => [s.toLowerCase(), s]));

function normalizeFailOnSeverity(raw) {
    const text = String(raw || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    if (!text) return { value: '', severities: [] };
    const severities = [];
    for (const token of text.split(',')) {
        const key = token.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!key) continue;
        const severity = BY_KEY.get(key);
        if (!severity) return { error: token.trim() };
        if (!severities.includes(severity)) severities.push(severity);
    }
    if (severities.length === 0) return { value: '', severities: [] };
    return { value: `"${severities.join(', ')}"`, severities };
}

module.exports = { SEVERITIES, normalizeFailOnSeverity };
