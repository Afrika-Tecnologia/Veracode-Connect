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
    resolveNovas,
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

test('resolveNovas ignora filtered_results vazio quando há baseline', () => {
    const novas = resolveNovas([knownFlaw, newFlaw], [knownFlaw], []);
    assert.equal(novas.length, 1);
    assert.equal(novas[0].issue_id, 2001);
});

test('resolveNovas cai no filtered só quando o baseline não tem findings', () => {
    const novas = resolveNovas([knownFlaw, newFlaw], [], [newFlaw]);
    assert.equal(novas.length, 1);
    assert.equal(novas[0].title, 'sql');
});

test('summary-md com baseline não usa filtered vazio nas novas', () => {
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
    assert.match(md, /#### SAST - Vulnerabilidades Bloqueantes de Esteira/);
    assert.match(md, /#### SAST - Todas Vulnerabilidades/);
    assert.match(md, /\| 🟠 High \| 1 \|/);
    assert.match(md, /\| 🔴 Very High \| 1 \|/);
    assert.match(md, /\*\*1\*\*/);
    assert.match(md, /\*\*2\*\*/);
    assert.match(md, /Detalhamento de Vulnerabilidades Bloqueantes de Esteira \(1\)/);
    assert.match(md, /Detalhamento de Todas Vulnerabilidades \(2\)/);
    assert.doesNotMatch(md, /#### SAST - Vulnerabilidades\n/);
    const blockingIdx = md.indexOf('#### SAST - Vulnerabilidades Bloqueantes de Esteira');
    const blockingDetailsIdx = md.indexOf('Detalhamento de Vulnerabilidades Bloqueantes de Esteira');
    const allIdx = md.indexOf('#### SAST - Todas Vulnerabilidades');
    const allDetailsIdx = md.indexOf('Detalhamento de Todas Vulnerabilidades');
    assert.ok(blockingIdx < blockingDetailsIdx && blockingDetailsIdx < allIdx && allIdx < allDetailsIdx);
});

test('CLI summary-md escreve as duas tabelas', () => {
    const dir = writeTemp({
        'results.json': { findings: [newFlaw] },
        'baseline.json': { findings: [] }
    });
    const result = cp.spawnSync(process.execPath, [
        cli,
        'summary-md',
        '--results', path.join(dir, 'results.json'),
        '--baseline', path.join(dir, 'baseline.json'),
        '--filtered', path.join(dir, 'missing.json'),
        '--split', 'true'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SAST - Vulnerabilidades Bloqueantes de Esteira/);
    assert.match(result.stdout, /\*\*1\*\*/);
});
