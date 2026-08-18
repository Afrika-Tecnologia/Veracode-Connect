const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    putBaseline,
    githubErrorDetail,
    isEmptyRepoConflict,
    baselineContentPath,
    githubApiBase
} = require('./github-baseline.js');

const originalFetch = global.fetch;

function jsonResponse(status, body) {
    const text = JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => text
    };
}

function writeResults() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-baseline-'));
    const file = path.join(dir, 'results.json');
    fs.writeFileSync(file, '{"findings":[]}');
    process.env.GITHUB_OUTPUT = path.join(dir, 'output.txt');
    return { dir, file };
}

function mockGitData({
    fileExists = false,
    emptyRepo = false,
    defaultBranch = 'main',
    patchStatuses = [200],
    fileExistsAfterPatch = false,
    singularRef404 = false
}) {
    const calls = [];
    let patchIndex = 0;
    let contentsGets = 0;
    global.fetch = async (url, options = {}) => {
        const method = (options.method || 'GET').toUpperCase();
        const u = String(url);
        calls.push({ url: u, method });

        if (method === 'GET' && u.includes('/contents/')) {
            contentsGets += 1;
            const exists = contentsGets === 1 ? fileExists : (fileExistsAfterPatch || fileExists);
            if (exists) {
                return jsonResponse(200, {
                    type: 'file',
                    content: Buffer.from('{"findings":[]}').toString('base64'),
                    sha: 'file-sha'
                });
            }
            return jsonResponse(404, { message: 'Not Found' });
        }
        if (method === 'GET' && /\/git\/ref\//.test(u) && !u.includes('/git/refs/')) {
            if (emptyRepo) {
                return jsonResponse(409, { message: 'Git Repository is empty.' });
            }
            if (singularRef404) {
                return jsonResponse(404, { message: 'Not Found' });
            }
            return jsonResponse(200, { object: { sha: 'head-sha' } });
        }
        if (method === 'GET' && u.includes('/git/refs/')) {
            return jsonResponse(200, { object: { sha: 'head-sha' } });
        }
        if (method === 'GET' && u.includes('/git/commits/')) {
            return jsonResponse(200, { tree: { sha: 'tree-sha' } });
        }
        if (method === 'POST' && u.includes('/git/blobs')) {
            return jsonResponse(201, { sha: 'blob-sha' });
        }
        if (method === 'POST' && u.includes('/git/trees')) {
            return jsonResponse(201, { sha: 'new-tree-sha' });
        }
        if (method === 'POST' && u.includes('/git/commits')) {
            return jsonResponse(201, { sha: 'new-commit-sha' });
        }
        if (method === 'PATCH' && u.includes('/git/refs/')) {
            const status = patchStatuses[Math.min(patchIndex, patchStatuses.length - 1)];
            patchIndex += 1;
            if (status >= 200 && status < 300) {
                return jsonResponse(status, { object: { sha: 'new-commit-sha' } });
            }
            return jsonResponse(status, { message: 'Update is not a fast forward' });
        }
        if (method === 'GET' && u.includes('/repos/') && !u.includes('/git/') && !u.includes('/contents/')) {
            return jsonResponse(200, { default_branch: defaultBranch });
        }
        return jsonResponse(500, { message: `unexpected ${method} ${u}` });
    };
    return calls;
}

test.afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.BASELINE_PUT_MAX_ATTEMPTS;
    delete process.env.BASELINE_PUT_RETRY_MS;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_API_URL;
    delete process.env.GITHUB_SERVER_URL;
});

test('githubApiBase usa api.github.com no Cloud e /api/v3 no GHES', () => {
    delete process.env.GITHUB_API_URL;
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    assert.equal(githubApiBase(), 'https://api.github.com');

    process.env.GITHUB_SERVER_URL = 'https://github.empresa.local';
    assert.equal(githubApiBase(), 'https://github.empresa.local/api/v3');

    process.env.GITHUB_API_URL = 'https://github.empresa.local/api/v3';
    assert.equal(githubApiBase(), 'https://github.empresa.local/api/v3');

    process.env.GITHUB_API_URL = 'https://api.github.com';
    assert.equal(githubApiBase(), 'https://api.github.com');
});

test('githubErrorDetail usa message + errors', () => {
    assert.equal(
        githubErrorDetail({ message: 'conflict', errors: [{ code: 'x' }] }, ''),
        'conflict [{"code":"x"}]'
    );
});

test('isEmptyRepoConflict detecta repositório vazio', () => {
    assert.equal(isEmptyRepoConflict('Git Repository is empty.'), true);
    assert.equal(isEmptyRepoConflict('is at aaa but expected bbb'), false);
});

test('baselineContentPath monta org/repo/baseline.json', () => {
    assert.equal(
        baselineContentPath('cogna-somos/test-node'),
        'cogna-somos/test-node/baseline.json'
    );
});

test('putBaseline ignora seed quando o arquivo já existe (GET 200)', async () => {
    const { file } = writeResults();
    mockGitData({ fileExists: true });

    const result = await putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file);
    assert.equal(result.seeded, false);
    assert.equal(result.alreadyExists, true);
});

test('putBaseline grava commit filho em cima do HEAD (README preservado)', async () => {
    const { file } = writeResults();
    const calls = mockGitData({ fileExists: false, patchStatuses: [200] });

    const result = await putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file);
    assert.equal(result.seeded, true);
    assert.equal(result.alreadyExists, false);
    assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('/git/trees')));
    assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('/git/refs/')));
    assert.equal(calls.some((c) => c.method === 'PUT' && c.url.includes('/contents/')), false);
});

test('putBaseline trata conflito como write-once só se o GET posterior achar o arquivo', async () => {
    const { file } = writeResults();
    mockGitData({
        fileExists: false,
        fileExistsAfterPatch: true,
        patchStatuses: [422]
    });

    const result = await putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file);
    assert.equal(result.seeded, false);
    assert.equal(result.alreadyExists, true);
});

test('putBaseline faz retry quando o fast-forward falha e o arquivo ainda não existe', async () => {
    const { file } = writeResults();
    process.env.BASELINE_PUT_MAX_ATTEMPTS = '3';
    process.env.BASELINE_PUT_RETRY_MS = '0';
    const calls = mockGitData({
        fileExists: false,
        patchStatuses: [422, 200]
    });

    const result = await putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file);
    assert.equal(result.seeded, true);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2);
});

test('putBaseline falha após retries se o conflito persistir e o arquivo continuar ausente', async () => {
    const { file } = writeResults();
    process.env.BASELINE_PUT_MAX_ATTEMPTS = '2';
    process.env.BASELINE_PUT_RETRY_MS = '0';
    mockGitData({
        fileExists: false,
        patchStatuses: [422, 422]
    });

    await assert.rejects(
        () => putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file),
        /O README\.md na raiz não precisa ser removido/
    );
});

test('putBaseline no GHES usa /git/refs quando /git/ref retorna 404', async () => {
    const { file } = writeResults();
    const calls = mockGitData({ fileExists: false, singularRef404: true, patchStatuses: [200] });

    const result = await putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file);
    assert.equal(result.seeded, true);
    assert.ok(calls.some((c) => c.method === 'GET' && /\/git\/ref\//.test(c.url) && !c.url.includes('/git/refs/')));
    assert.ok(calls.some((c) => c.method === 'GET' && c.url.includes('/git/refs/')));
});

test('putBaseline falha com mensagem clara se o repositório está vazio', async () => {
    const { file } = writeResults();
    mockGitData({ fileExists: false, emptyRepo: true });

    await assert.rejects(
        () => putBaseline('token', 'cogna-edu', 'Afrika-Veracode-Connect-Baseline', 'cogna-somos/test-node', file),
        /o repositório está vazio/
    );
});
