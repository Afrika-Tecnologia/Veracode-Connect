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

function emptyCounts() {
    return { critical: 0, high: 0, medium: 0, low: 0, very_low: 0, total: 0 };
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

module.exports = { BANDS, BAND_LABEL, ROW, emptyCounts, countBands, severityTable };
