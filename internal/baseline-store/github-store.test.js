'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { readStoreFile, writeStoreFileOnce } = require('./github-store');
const { baselineContentPath, seedCommitMessage } = require('./kinds');
const { resolveSeedGate } = require('./seed-gate');
const { main } = require('./cli');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function response(status, body, raw) {
    const text = raw ?? JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-store-'));
    process.env.GITHUB_OUTPUT = path.join(dir, 'output');
    process.env.GITHUB_API_URL = 'https://api.github.com';
    t.after(() => {
        global.fetch = originalFetch;
        process.env = { ...originalEnv };
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return dir;
}

function outputs(dir) {
    const file = path.join(dir, 'output');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Store em memória: contents GET, Git Data API e PATCH do ref. */
function mockStore({ files = {}, defaultBranch = 'main', rawOnly = false } = {}) {
    const calls = [];
    global.fetch = async (url, options = {}) => {
        const method = (options.method || 'GET').toUpperCase();
        const u = String(url);
        const accept = options.headers?.Accept || '';
        calls.push({ method, url: u, accept, body: options.body ? JSON.parse(options.body) : undefined });
        const contents = u.match(/\/contents\/([^?]+)/);
        if (method === 'GET' && contents) {
            const key = decodeURIComponent(contents[1]);
            if (!(key in files)) return response(404, { message: 'Not Found' });
            if (accept === 'application/vnd.github.raw') return response(200, null, files[key]);
            const content = rawOnly ? '' : Buffer.from(files[key]).toString('base64');
            return response(200, { type: 'file', sha: 'sha-1', size: files[key].length, encoding: rawOnly ? 'none' : 'base64', content });
        }
        if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u)) return response(200, { default_branch: defaultBranch });
        if (method === 'GET' && u.includes('/git/ref')) return response(200, { object: { sha: 'head' } });
        if (method === 'GET' && u.includes('/git/commits/')) return response(200, { tree: { sha: 'tree' } });
        if (method === 'POST' && u.endsWith('/git/blobs')) return response(201, { sha: 'blob' });
        if (method === 'POST' && u.endsWith('/git/trees')) return response(201, { sha: 'tree2' });
        if (method === 'POST' && u.endsWith('/git/commits')) return response(201, { sha: 'commit2' });
        if (method === 'PATCH') return response(200, { object: { sha: 'commit2' } });
        return response(500, { message: `unexpected ${method} ${u}` });
    };
    return calls;
}

const STORE = { token: 't', baselineOrg: 'Org', baselineRepoName: 'Store' };

test('kinds: cada baseline fica na pasta do app com o próprio nome', () => {
    assert.equal(baselineContentPath('Acme/app'), 'Acme/app/baseline.json');
    assert.equal(baselineContentPath('Acme/app', 'iac'), 'Acme/app/iac-baseline.json');
    assert.equal(baselineContentPath('Acme/app', 'sca'), 'Acme/app/sca-baseline.json');
    assert.equal(seedCommitMessage('Acme/app', 'iac'), 'Baseline IaC criado para a aplicação "app" (Acme/app)');
    assert.throws(() => baselineContentPath('Acme/app', 'dast'), /Tipo de baseline desconhecido/);
    assert.throws(() => baselineContentPath('sem-barra', 'iac'), /repository_full_name inválido/);
});

test('readStoreFile lê arquivos acima de 1 MB pelo media type raw', async (t) => {
    setup(t);
    const big = JSON.stringify({ findings: [], pad: 'x'.repeat(64) });
    const calls = mockStore({ files: { 'Acme/app/baseline.json': big }, rawOnly: true });
    const result = await readStoreFile({ ...STORE, relativePath: 'Acme/app/baseline.json' });
    assert.equal(result.exists, true);
    assert.equal(result.content.toString('utf8'), big);
    assert.ok(calls.some((c) => c.accept === 'application/vnd.github.raw'));
});

test('readStoreFile: 404 = ausente, sem erro', async (t) => {
    setup(t);
    mockStore();
    const result = await readStoreFile({ ...STORE, relativePath: 'Acme/app/iac-baseline.json', branch: 'baselines' });
    assert.deepEqual(result, { exists: false, branch: 'baselines' });
});

test('writeStoreFileOnce grava quando o arquivo não existe', async (t) => {
    const dir = setup(t);
    const calls = mockStore();
    const result = await writeStoreFileOnce({ ...STORE, relativePath: 'Acme/app/iac-baseline.json',
        content: Buffer.from('{}'), commitMessage: 'msg' });
    assert.equal(result.seeded, true);
    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    assert.equal(tree.body.tree[0].path, 'Acme/app/iac-baseline.json');
    assert.match(outputs(dir), /^baseline_seeded=true$/m);
});

test('writeStoreFileOnce nunca sobrescreve um arquivo existente', async (t) => {
    const dir = setup(t);
    const calls = mockStore({ files: { 'Acme/app/iac-baseline.json': '{}' } });
    const result = await writeStoreFileOnce({ ...STORE, relativePath: 'Acme/app/iac-baseline.json',
        content: Buffer.from('{"novo":true}'), commitMessage: 'msg' });
    assert.deepEqual(result, { seeded: false, alreadyExists: true, branch: 'main' });
    assert.equal(calls.some((c) => c.method !== 'GET'), false);
    assert.match(outputs(dir), /^baseline_already_exists=true$/m);
});

test('seed gate: push ou PR para a default branch podem gravar; demais não', () => {
    assert.equal(resolveSeedGate({ refName: 'main', defaultBranch: 'main' }).canSeed, true);
    assert.equal(resolveSeedGate({ headRef: 'feat/x', baseRef: 'main', refName: '1/merge', defaultBranch: 'main' }).canSeed, true);
    assert.equal(resolveSeedGate({ headRef: 'feat/x', baseRef: 'develop', defaultBranch: 'main' }).canSeed, false);
    assert.equal(resolveSeedGate({ refName: 'feat/x', defaultBranch: 'main' }).canSeed, false);
    assert.equal(resolveSeedGate({ refName: 'main', defaultBranch: '' }).canSeed, false);
});

test('seed gate CLI escreve as saídas e avisa quando não pode gravar', (t) => {
    const dir = setup(t);
    const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'seed-gate.js')], {
        env: { ...process.env, HEAD_REF: 'feat/x', BASE_REF: 'develop', REF_NAME: '1/merge', DEFAULT_BRANCH: 'main', HAS_BASELINE: 'false' },
        encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(outputs(dir), /^can_seed=false$/m);
    assert.match(outputs(dir), /^target_branch=develop$/m);
    assert.match(run.stdout, /::warning::baseline ausente; seed bloqueado/);
});

test('CLI get/put usa o caminho do tipo pedido', async (t) => {
    const dir = setup(t);
    Object.assign(process.env, { BASELINE_ORG: 'Org', BASELINE_REPO_NAME: 'Store', SCAN_REPOSITORY: 'Acme/app', BASELINE_GITHUB_TOKEN: 'pat' });
    const files = {};
    const calls = mockStore({ files });
    const seed = path.join(dir, 'seed.json');
    fs.writeFileSync(seed, '{"findings":[]}');

    const out = path.join(dir, 'got.json');
    await main(['get', '--kind', 'iac', '--out', out]);
    assert.match(outputs(dir), /^has_baseline=false$/m);
    assert.equal(fs.existsSync(out), false);

    await main(['put', '--kind', 'iac', '--file', seed]);
    const commit = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/commits'));
    assert.equal(commit.body.message, 'Baseline IaC criado para a aplicação "app" (Acme/app)');

    files['Acme/app/iac-baseline.json'] = '{"findings":[]}';
    await main(['get', '--kind', 'iac', '--out', out]);
    assert.match(outputs(dir), /^has_baseline=true$/m);
    assert.equal(fs.readFileSync(out, 'utf8'), '{"findings":[]}');
});

test('CLI recusa uso inválido', async () => {
    await assert.rejects(() => main(['get', '--kind', 'iac']), /Uso: node cli.js/);
});
