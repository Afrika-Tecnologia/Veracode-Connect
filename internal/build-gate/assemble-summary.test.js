const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {
    FRAGMENT_ORDER,
    FRAGMENT_DIR_NAME,
    fragmentDir,
    assembleFragments,
    appendAssembledSummary
} = require('./assemble-summary');

const cli = path.join(__dirname, 'assemble-summary.js');

function makeFragDir(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-summary-'));
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), body);
    }
    return dir;
}

test('FRAGMENT_ORDER é Pipeline, SCA, IaC, Upload, Packager', () => {
    assert.deepEqual(FRAGMENT_ORDER, ['pipeline', 'sca', 'iac', 'upload', 'packager']);
});

test('fragmentDir usa o nome canônico em RUNNER_TEMP', () => {
    assert.equal(
        fragmentDir('/tmp/runner'),
        path.join('/tmp/runner', FRAGMENT_DIR_NAME)
    );
});

test('assembleFragments concatena só os módulos presentes, na ordem de exibição', () => {
    const dir = makeFragDir({
        'packager.md': 'PACK\n',
        'sca.md': 'SCA\n',
        'pipeline.md': 'PIPE\n',
        'upload.md': 'UP\n',
        'iac.md': 'IAC\n'
    });
    assert.equal(assembleFragments(dir), 'PIPE\nSCA\nIAC\nUP\nPACK\n');
});

test('assembleFragments omite fragmentos ausentes ou vazios', () => {
    const dir = makeFragDir({
        'sca.md': 'SCA\n',
        'upload.md': ''
    });
    assert.equal(assembleFragments(dir), 'SCA\n');
});

test('assembleFragments devolve vazio se o diretório não existe', () => {
    assert.equal(assembleFragments(path.join(os.tmpdir(), 'vc-summary-missing')), '');
    assert.equal(assembleFragments(''), '');
});

test('appendAssembledSummary grava no Step Summary', () => {
    const dir = makeFragDir({
        'pipeline.md': 'PIPE\n',
        'iac.md': 'IAC\n'
    });
    const summary = path.join(dir, 'job-summary.md');
    fs.writeFileSync(summary, 'PRE\n');
    const text = appendAssembledSummary(dir, summary);
    assert.equal(text, 'PIPE\nIAC\n');
    assert.equal(fs.readFileSync(summary, 'utf8'), 'PRE\nPIPE\nIAC\n');
});

test('CLI assemble concatena no arquivo de summary', () => {
    const dir = makeFragDir({
        'pipeline.md': 'PIPE\n',
        'sca.md': 'SCA\n'
    });
    const summary = path.join(dir, 'out.md');
    const result = cp.spawnSync(process.execPath, [cli, 'assemble', dir, summary], {
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(summary, 'utf8'), 'PIPE\nSCA\n');
});

test('CLI falha com comando desconhecido', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'nope'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Uso: node assemble-summary.js/);
});
