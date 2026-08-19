const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { resolveBaselineMode } = require('./baseline-auth');
const { baselineContentPath } = require('../repo-baseline-flow/github-baseline.js');

const scriptPath = path.join(__dirname, 'index.js');

test('validate-inputs falha quando VKEY nao é fornecido', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: { VID: '123', BASELINE_MODE: 'none' }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /veracode_api_key é obrigatório\./);
});

test('validate-inputs falha quando VKEY não é hexa', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: { VID: '123', VKEY: 'abcxyz', BASELINE_MODE: 'none' }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /veracode_api_key deve ser uma string hexadecimal válida\./);
});

test('validate-inputs falha quando SCA ativo sem token', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            ENABLE_SCA: 'true',
            BASELINE_MODE: 'none'
        }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /enable_sca=true requer veracode_sca_token\./);
});

test('validate-inputs passa com credenciais corretas e baseline none', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            BASELINE_MODE: 'none'
        }
    });
    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    assert.match(stdout, /validação=ok/, `Falhou. Stdout: ${stdout}, Stderr: ${stderr}`);
    assert.match(stdout, /baseline_mode=none/);
});

test('validate-inputs falha quando baseline_mode=portal_afrika sem portal_afrika_api_key', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            BASELINE_MODE: 'portal_afrika',
            ENABLE_AUTO_PACKAGER: 'true'
        }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /baseline_mode=portal_afrika requer portal_afrika_api_key\./);
});

test('validate-inputs falha quando baseline_mode=repo sem baseline_org', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            BASELINE_MODE: 'repo',
            BASELINE_GITHUB_TOKEN: 'ghp_test',
            ENABLE_AUTO_PACKAGER: 'true'
        }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /baseline_mode=repo requer baseline_org/);
});

test('validate-inputs falha quando baseline_mode=repo sem credenciais', () => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            BASELINE_MODE: 'repo',
            BASELINE_ORG: 'Acme',
            ENABLE_AUTO_PACKAGER: 'true'
        }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /baseline_mode=repo requer GitHub App/);
});

test('resolveBaselineMode: default e none', () => {
    const result = resolveBaselineMode({});
    assert.equal(result.mode, 'none');
});

test('resolveBaselineMode: portal_afrika explicito', () => {
    const result = resolveBaselineMode({ BASELINE_MODE: 'portal_afrika' });
    assert.equal(result.mode, 'portal_afrika');
});

test('resolveBaselineMode: repo explicito', () => {
    const result = resolveBaselineMode({ BASELINE_MODE: 'repo' });
    assert.equal(result.mode, 'repo');
});

test('baselineContentPath monta ORG/REPO/baseline.json', () => {
    assert.equal(baselineContentPath('Afrika-Tecnologia/meu-app'), 'Afrika-Tecnologia/meu-app/baseline.json');
});
