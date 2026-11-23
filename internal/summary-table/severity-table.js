'use strict';

/**
 * Tabela de severidades única dos cards SAST, SCA e IaC.
 *
 * Uma linha por grupo e as severidades nas colunas:
 *   - com baseline comparado: novos que afetam a política, novos que não afetam e backlog;
 *   - sem baseline: vulnerabilidades e, com política ativa, as que afetam a política.
 *
 * counts = { critical, high, medium, low, very_low, total }.
 */

const BANDS = ['critical', 'high', 'medium', 'low', 'very_low'];
const BAND_LABEL = {
    critical: '🔴 Very High',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🔵 Low',
    very_low: '⚪ Very Low'
};

const ROW = {
    all: '🔎 Vulnerabilidades',
    policy: '❌ Afetam a política',
    newPolicy: '❌ Novos (afetam a política)',
    newOther: '🆕 Novos (não afetam)',
    backlog: '📦 Backlog'
};

// cvssBand e normalizeSeverity ficam aqui, num módulo sem dependências, porque são usadas
// tanto pelos summary-findings.js quanto pelos *-baseline.js. Importar uma do outro cria
// ciclo de require: rodando summary-findings.js como script, o baseline carregado sob
// demanda recebia os exports ainda vazios ("x is not a function").

/** Faixa de severidade (NVD/Veracode) a partir do score CVSS; null quando não há score. */
function cvssBand(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) {
        return null;
    }
    if (n >= 9) {
        return 'critical';
    }
    if (n >= 7) {
        return 'high';
    }
    if (n >= 4) {
        return 'medium';
    }
    if (n >= 0.1) {
        return 'low';
    }
    return 'very_low';
}

/** Faixa a partir do texto de severidade do IaC/Secrets (qualquer caixa); null quando desconhecido. */
function normalizeSeverity(raw) {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'CRITICAL' || value === 'VERY HIGH' || value === 'VERYHIGH') {
        return 'critical';
    }
    if (value === 'HIGH') {
        return 'high';
    }
    if (value === 'MEDIUM' || value === 'MODERATE') {
        return 'medium';
    }
    if (value === 'LOW') {
        return 'low';
    }
    if (value === 'NEGLIGIBLE' || value === 'VERY LOW' || value === 'VERYLOW' || value === 'INFO') {
        return 'very_low';
    }
    return null;
}

function emptyCounts() {
    return { critical: 0, high: 0, medium: 0, low: 0, very_low: 0, total: 0 };
}

/**
 * Cópia ordenada de Very High a Very Low; na mesma faixa, maior `score` primeiro (quando houver).
 * Estável: findings empatados mantêm a ordem recebida.
 */
function sortBySeverity(findings) {
    const rank = (finding) => {
        const index = BANDS.indexOf(finding.severity);
        return index === -1 ? BANDS.length : index;
    };
    const score = (finding) => (Number.isFinite(Number(finding.score)) ? Number(finding.score) : -1);
    return findings.slice().sort((a, b) => rank(a) - rank(b) || score(b) - score(a));
}

/** Conta findings já normalizados com `severity` em uma das BANDS. */
function countBands(findings) {
    const counts = emptyCounts();
    for (const finding of findings || []) {
        counts[BANDS.includes(finding.severity) ? finding.severity : 'very_low'] += 1;
        counts.total += 1;
    }
    return counts;
}

/** @param {{label: string, counts: object}[]} rows */
function severityTable(rows) {
    return [
        `| Grupo | ${BANDS.map((band) => BAND_LABEL[band]).join(' | ')} | Total |`,
        `|---|${BANDS.map(() => '---|').join('')}---|`,
        ...rows.map(({ label, counts }) => {
            const c = { ...emptyCounts(), ...counts };
            return `| ${label} | ${BANDS.map((band) => c[band]).join(' | ')} | **${c.total}** |`;
        })
    ];
}

module.exports = { BANDS, BAND_LABEL, ROW, cvssBand, normalizeSeverity, sortBySeverity, emptyCounts, countBands, severityTable };
