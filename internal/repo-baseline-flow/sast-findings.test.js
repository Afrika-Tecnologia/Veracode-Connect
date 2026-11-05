const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {
    extractFindings,
    countBySeverity,
    findingKey,
    splitNovas,
    classifyFindings,
    buildSummaryMarkdown
} = require('./sast-findings');

const cli = path.join(__dirname, 'sast-findings.js');

const knownFlaw = {
    title: 'eval',
    issue_id: 1014,
    severity: 5,
    cwe_id: '95',
    files: { source_file: { file: 'app/routes/a.js', line: 32 } },
    flaw_match: {
        procedure_hash: '4175066609',
        prototype_hash: '229243849',
        flaw_hash: '3341717358',
        flaw_hash_ordinal: 1,
        cause_hash: '3693385549',
        cause_hash_ordinal: 1
    }
};

const newFlaw = {
    title: 'sql',
    issue_id: 2001,
    severity: 4,
    cwe_id: '89',
    files: { source_file: { file: 'app/db.js', line: 10 } },
    flaw_match: {
        procedure_hash: '1',
        prototype_hash: '2',
        flaw_hash: '999',
        flaw_hash_ordinal: 1,
        cause_hash: '3',
        cause_hash_ordinal: 1
    }
};

function writeTemp(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sast-'));
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
    }
    return dir;
}

test('extractFindings aceita findings na raiz e wrappers do Portal', () => {
    assert.equal(extractFindings({ findings: [knownFlaw] }).length, 1);
    assert.equal(extractFindings({ scanResult: { findings: [knownFlaw] } }).length, 1);
    assert.equal(extractFindings({ results: { scanResult: { findings: [knownFlaw] } } }).length, 1);
    assert.equal(extractFindings({ findings: [] }).length, 0);
});

test('countBySeverity trata severity numérica e string', () => {
    const counts = countBySeverity([
        { severity: 5 },
        { severity: '4' },
        { severity: 3 },
        { severity: 2 },
        { severity: 1 }
    ]);
    assert.deepEqual(counts, { veryHigh: 1, high: 1, medium: 1, low: 1, veryLow: 1, total: 5 });
});

test('findingKey usa flaw_match e não issue_id', () => {
    const moved = { ...knownFlaw, issue_id: 9999 };
    assert.equal(findingKey(knownFlaw), findingKey(moved));
    assert.notEqual(findingKey(knownFlaw), findingKey(newFlaw));
});

test('splitNovas remove o que já está no baseline', () => {
    const novas = splitNovas([knownFlaw, newFlaw], [knownFlaw]);
    assert.equal(novas.length, 1);
    assert.equal(novas[0].title, 'sql');
});

test('classifyFindings: novo fora do filtrado não afeta a política; o resto do baseline é backlog', () => {
    const groups = classifyFindings([knownFlaw, newFlaw], [knownFlaw], []);
    assert.deepEqual(groups.newPolicy, []);
    assert.deepEqual(groups.newOther.map((f) => f.title), ['sql']);
    assert.deepEqual(groups.backlog.map((f) => f.title), ['eval']);
});

test('classifyFindings: o filtrado da política manda, mesmo para finding que estaria no baseline', () => {
    const groups = classifyFindings([knownFlaw, newFlaw], [knownFlaw], [newFlaw, knownFlaw]);
    assert.equal(groups.newPolicy.length, 2);
    assert.deepEqual(groups.newOther, []);
    assert.deepEqual(groups.backlog, []);
});

test('classifyFindings: baseline vazio deixa todo finding fora do filtrado como novo', () => {
    const groups = classifyFindings([knownFlaw, newFlaw], [], [newFlaw]);
    assert.deepEqual(groups.newPolicy.map((f) => f.title), ['sql']);
    assert.deepEqual(groups.newOther.map((f) => f.title), ['eval']);
    assert.deepEqual(groups.backlog, []);
});

test('summary-md mostra os três grupos numa tabela e detalha cada um', () => {
    const dir = writeTemp({
        'results.json': { findings: [knownFlaw, newFlaw] },
        'baseline.json': { findings: [knownFlaw] },
        'filtered_results.json': { findings: [] }
    });
    const md = buildSummaryMarkdown({
        resultsPath: path.join(dir, 'results.json'),
        baselinePath: path.join(dir, 'baseline.json'),
        filteredPath: path.join(dir, 'filtered_results.json'),
        split: true
    });
    assert.match(md, /\| Grupo \| 🔴 Very High \| 🟠 High \| 🟡 Medium \| 🔵 Low \| ⚪ Very Low \| Total \|/);
    assert.match(md, /\| ❌ Novos \(afetam a política\) \| 0 \| 0 \| 0 \| 0 \| 0 \| \*\*0\*\* \|/);
    assert.match(md, /\| 🆕 Novos \(não afetam\) \| 0 \| 1 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
    assert.match(md, /\| 📦 Backlog \| 1 \| 0 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
    assert.doesNotMatch(md, /<summary>Novos que afetam a política/);
    assert.match(md, /<summary>Novos que não afetam a política \(1\)<\/summary>/);
    assert.match(md, /<summary>Backlog \(1\)<\/summary>/);
    assert.doesNotMatch(md, /####|Bloqueantes de Esteira|Todas Vulnerabilidades/);
    assert.ok(md.indexOf('Novos que não afetam a política (1)') < md.indexOf('Backlog (1)'));
});

for (const provider of ['repo-baseline-flow', 'portal-afrika-baseline-flow', 'pr-comment']) {
    const renderer = require(`../${provider}/sast-findings`);
    for (const filtered of [[], [newFlaw], [{ ...newFlaw, severity: 3 }]]) {
        test(`${provider}: novos que afetam a política seguem o resultado filtrado (${filtered.length}, severidade ${filtered[0]?.severity ?? 'nenhuma'})`, () => {
            const medium = { ...newFlaw, severity: 3, title: 'Medium outside policy', flaw_match: { flaw_hash: 'medium' } };
            const dir = writeTemp({
                'results.json': { findings: [knownFlaw, filtered[0] || newFlaw, medium] },
                'baseline.json': { findings: [knownFlaw] },
                'filtered_results.json': { findings: filtered }
            });
            try {
                const md = renderer.buildSummaryMarkdown({
                    resultsPath: path.join(dir, 'results.json'),
                    baselinePath: path.join(dir, 'baseline.json'),
                    filteredPath: path.join(dir, 'filtered_results.json'),
                    split: true
                });
                const policyRow = md.match(/^\| ❌ Novos \(afetam a política\) \|.*$/m)[0];
                const otherRow = md.match(/^\| 🆕 Novos \(não afetam\) \|.*$/m)[0];
                assert.match(policyRow, new RegExp(`\\*\\*${filtered.length}\\*\\* \\|$`));
                assert.match(otherRow, new RegExp(`\\*\\*${filtered.length ? 1 : 2}\\*\\* \\|$`));
                assert.match(md, /\| 📦 Backlog \| 1 \| 0 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
                const policyDetails = md.split('<summary>Novos que não afetam')[0];
                assert.doesNotMatch(policyDetails, /Medium outside policy/);
                assert.match(md, /Medium outside policy/);
                if (filtered.length) {
                    assert.match(policyRow, filtered[0].severity === 3 ? /^\| [^|]+ \| 0 \| 0 \| 1 \|/ : /^\| [^|]+ \| 0 \| 1 \| 0 \|/);
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    }
    for (const invalid of [undefined, '{invalid json']) {
        test(`${provider}: não deduz bloqueantes sem resultado filtrado válido (${invalid === undefined ? 'ausente' : 'inválido'})`, () => {
            const files = {
                'results.json': { findings: [knownFlaw, newFlaw] },
                'baseline.json': { findings: [knownFlaw] }
            };
            if (invalid !== undefined) files['filtered_results.json'] = invalid;
            const dir = writeTemp(files);
            try {
                const md = renderer.buildSummaryMarkdown({
                    resultsPath: path.join(dir, 'results.json'),
                    baselinePath: path.join(dir, 'baseline.json'),
                    filteredPath: path.join(dir, 'filtered_results.json'),
                    split: true
                });
                assert.match(md, /não foi possível determinar as vulnerabilidades bloqueantes/);
                assert.match(md, /\| 🔎 Vulnerabilidades \| 1 \| 1 \| 0 \| 0 \| 0 \| \*\*2\*\* \|/);
                assert.match(md, /<summary>Vulnerabilidades \(2\)<\/summary>/);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    }
}

test('CLI summary-md escreve a tabela de grupos', () => {
    const dir = writeTemp({
        'results.json': { findings: [newFlaw] },
        'baseline.json': { findings: [] },
        'filtered_results.json': { findings: [newFlaw] }
    });
    const result = cp.spawnSync(process.execPath, [
        cli,
        'summary-md',
        '--results', path.join(dir, 'results.json'),
        '--baseline', path.join(dir, 'baseline.json'),
        '--filtered', path.join(dir, 'filtered_results.json'),
        '--split', 'true'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| ❌ Novos \(afetam a política\) \| 0 \| 1 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
});

test('classifyFindings conta o filtrado como multiconjunto', () => {
    const twin = { ...newFlaw, title: 'sql 2' };
    const groups = classifyFindings([newFlaw, twin], [], [newFlaw]);
    assert.equal(groups.newPolicy.length, 1);
    assert.deepEqual(groups.newOther.map((f) => f.title), ['sql 2']);
});

test('sem baseline: linha de vulnerabilidades e, com política ativa, a das que afetam a política', () => {
    const dir = writeTemp({
        'results.json': { findings: [knownFlaw, newFlaw] },
        'filtered_results.json': { findings: [knownFlaw] }
    });
    try {
        const args = { resultsPath: path.join(dir, 'results.json'), filteredPath: path.join(dir, 'filtered_results.json'), split: false };
        const plain = buildSummaryMarkdown(args);
        assert.match(plain, /\| Grupo \| 🔴 Very High \| 🟠 High \| 🟡 Medium \| 🔵 Low \| ⚪ Very Low \| Total \|/);
        assert.match(plain, /\| 🔎 Vulnerabilidades \| 1 \| 1 \| 0 \| 0 \| 0 \| \*\*2\*\* \|/);
        assert.doesNotMatch(plain, /Afetam a política|####/);
        const withPolicy = buildSummaryMarkdown({ ...args, policyActive: true });
        assert.match(withPolicy, /\| ❌ Afetam a política \| 1 \| 0 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
        assert.match(withPolicy, /<summary>Vulnerabilidades \(2\)<\/summary>/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
