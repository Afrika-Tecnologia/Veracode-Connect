'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getIacConfig } = require('./github-baseline');
const run = promisify(execFile);

const config = 'misconfiguration:\n  enabled: true\n';

function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-config-'));
    const file = path.join(dir, 'veracode.yml');
    const output = path.join(dir, 'output.txt');
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    process.env.GITHUB_OUTPUT = output;
    process.env.GITHUB_API_URL = 'https://api.github.com';
    t.after(() => {
        global.fetch = originalFetch;
        process.env = originalEnv;
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, file, output };
}

function response(status, json) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) };
}

function fileResponse() {
    return response(200, {
        type: 'file', name: 'veracode.yml', path: 'veracode.yml', encoding: 'base64',
        content: Buffer.from(config).toString('base64'), size: Buffer.byteLength(config), sha: 'config-sha'
    });
}

test('downloads root config from the baseline default branch and replaces the workspace config', async (t) => {
    const { file, output, dir } = setup(t);
    fs.writeFileSync(file, 'local configuration');
    const requests = [];
    global.fetch = async (url, options) => {
        requests.push(String(url));
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        if (String(url) === 'https://api.github.com/repos/Acme/store') {
            return response(200, { default_branch: 'master' });
        }
        assert.equal(String(url), 'https://api.github.com/repos/Acme/store/contents/veracode.yml?ref=master');
        return fileResponse();
    };
    const result = await getIacConfig('test-token', 'Acme', 'store', file, '');
    assert.equal(result.hasConfig, true);
    assert.equal(fs.readFileSync(file, 'utf8'), config);
    assert.equal(requests.length, 2);
    assert.match(fs.readFileSync(output, 'utf8'), /iac_config_downloaded=true/);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['output.txt', 'veracode.yml']);
});

test('honors an explicit store branch and GHES API without querying the default branch', async (t) => {
    const { file } = setup(t);
    process.env.GITHUB_API_URL = 'https://github.acme.test/api/v3/';
    let calls = 0;
    global.fetch = async (url) => {
        calls++;
        assert.equal(String(url), 'https://github.acme.test/api/v3/repos/Acme/store/contents/veracode.yml?ref=rules%2Fproduction');
        return fileResponse();
    };
    await getIacConfig('test-token', 'Acme', 'store', file, 'rules/production');
    assert.equal(calls, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), config);
});

test('missing baseline config is reported as absent without using or overwriting a local config', async (t) => {
    const { file, output } = setup(t);
    fs.writeFileSync(file, 'local configuration');
    global.fetch = async () => response(404, { message: 'Not Found' });
    const result = await getIacConfig('test-token', 'Acme', 'store', file, 'main');
    assert.equal(result.hasConfig, false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'local configuration');
    assert.match(fs.readFileSync(output, 'utf8'), /iac_config_downloaded=false/);
});

test('replacing workspace config does not modify another file hard-linked to the destination', async (t) => {
    const { dir, file } = setup(t);
    const otherFile = path.join(dir, 'other.yml');
    fs.writeFileSync(otherFile, 'original content');
    fs.linkSync(otherFile, file);
    global.fetch = async () => fileResponse();
    await getIacConfig('test-token', 'Acme', 'store', file, 'main');
    assert.equal(fs.readFileSync(file, 'utf8'), config);
    assert.equal(fs.readFileSync(otherFile, 'utf8'), 'original content');
});

for (const status of [401, 403, 500]) {
    test(`HTTP ${status} does not replace local config or expose the response body`, async (t) => {
        const { file, output } = setup(t);
        fs.writeFileSync(file, 'local configuration');
        global.fetch = async () => response(status, { message: 'sensitive-response-body' });
        await assert.rejects(getIacConfig('test-token', 'Acme', 'store', file, 'main'), (err) => {
            assert.match(err.message, new RegExp(`HTTP ${status}`));
            assert.doesNotMatch(err.message, /test-token|sensitive-response-body/);
            return true;
        });
        assert.equal(fs.readFileSync(file, 'utf8'), 'local configuration');
        assert.match(fs.readFileSync(output, 'utf8'), /iac_config_downloaded=false/);
    });
}

for (const json of [
    [{ type: 'file' }],
    { type: 'dir' },
    { type: 'file', encoding: 'none', content: '' },
    { type: 'file', encoding: 'base64', content: 'invalid%%%base64' },
    { type: 'file', encoding: 'base64', content: '' }
]) {
    test(`invalid Contents API response does not overwrite local config: ${JSON.stringify(json)}`, async (t) => {
        const { file } = setup(t);
        fs.writeFileSync(file, 'local configuration');
        global.fetch = async () => response(200, json);
        await assert.rejects(getIacConfig('test-token', 'Acme', 'store', file, 'main'));
        assert.equal(fs.readFileSync(file, 'utf8'), 'local configuration');
    });
}

for (const auth of ['pat', 'github_app']) {
    test(`CLI downloads IaC rules using ${auth} with baseline_mode=none and no scan artifact`, async (t) => {
        const { dir, file, output } = setup(t);
        const requests = [];
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const server = http.createServer((req, res) => {
            requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
            res.setHeader('Content-Type', 'application/json');
            if (req.method === 'POST' && req.url === '/app/installations/456/access_tokens') {
                res.end(JSON.stringify({ token: 'installation-test-token' }));
            } else if (req.method === 'GET' && req.url === '/repos/Acme/store') {
                res.end(JSON.stringify({ default_branch: 'master' }));
            } else if (req.method === 'GET' && req.url === '/repos/Acme/store/contents/veracode.yml?ref=master') {
                res.end(JSON.stringify({
                    type: 'file', encoding: 'base64', content: Buffer.from(config).toString('base64'),
                    path: 'veracode.yml', name: 'veracode.yml', sha: 'config-sha', size: Buffer.byteLength(config)
                }));
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ message: 'Not Found' }));
            }
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        t.after(() => new Promise((resolve) => server.close(resolve)));
        const env = {
            ...process.env,
            GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
            GITHUB_WORKSPACE: dir,
            GITHUB_OUTPUT: output,
            BASELINE_ORG: 'Acme', BASELINE_REPO_NAME: 'store', BASELINE_REPO_BRANCH: '',
            BASELINE_GITHUB_TOKEN: auth === 'pat' ? 'test-token' : '',
            BASELINE_GITHUB_APP_ID: auth === 'github_app' ? '123' : '',
            BASELINE_GITHUB_APP_INSTALLATION_ID: auth === 'github_app' ? '456' : '',
            BASELINE_GITHUB_APP_PRIVATE_KEY: auth === 'github_app' ? privateKey.export({ type: 'pkcs8', format: 'pem' }) : '',
            BASELINE_MODE: 'none', ENABLE_IAC: 'true', ENABLE_IAC_CONFIGS: 'true',
            ENABLE_PIPELINE: 'false', ENABLE_UPLOAD: 'false', ENABLE_AUTO_PACKAGER: 'false',
            VID: '123', VKEY: 'abc123bb', SCAN_FILE: '', CREATE_ISSUES: 'false', COMMENT_PR: 'false'
        };
        await run(process.execPath, [path.join(__dirname, '../validate-inputs/index.js')], { env });
        requests.length = 0;
        const result = await run(process.execPath, [path.join(__dirname, 'github-baseline.js'), 'get-iac-config'], { env });
        assert.equal(fs.readFileSync(file, 'utf8'), config);
        assert.match(fs.readFileSync(output, 'utf8'), /iac_config_downloaded=true/);
        assert.doesNotMatch(result.stdout + result.stderr, /installation-test-token|test-token|PRIVATE KEY/);
        assert.deepEqual(requests.filter((req) => req.method === 'GET').map((req) => req.url), [
            '/repos/Acme/store', '/repos/Acme/store/contents/veracode.yml?ref=master'
        ]);
        const expectedToken = auth === 'pat' ? 'test-token' : 'installation-test-token';
        for (const req of requests.filter((req) => req.method === 'GET')) {
            assert.equal(req.authorization, `Bearer ${expectedToken}`);
        }
        if (auth === 'github_app') {
            const jwt = requests[0].authorization.slice('Bearer '.length).split('.');
            assert.equal(requests[0].method, 'POST');
            assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).iss, '123');
            assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${jwt[0]}.${jwt[1]}`), publicKey, Buffer.from(jwt[2], 'base64url')), true);
        }
    });
}
