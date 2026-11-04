'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    buildPlan,
    isoWeek,
    isMusl,
    loadManifest,
    normalizeMirror,
    refreshPeriod,
    requiredTools
} = require('./plan.js');

const NOW = new Date('2026-11-04T12:00:00Z');
const LINUX = { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', RUNNER_TEMP: '/home/runner/work/_temp' };
const ALL = { ENABLE_PIPELINESCAN: 'true', ENABLE_SCA: 'true', ENABLE_IAC: 'true', ENABLE_AUTO_PACKAGER: 'true' };

function plan(env, opts = {}) {
    return buildPlan({ ...LINUX, ...env }, { now: NOW, musl: false, ...opts });
}

test('isoWeek segue a ISO-8601 nas viradas de ano', () => {
    assert.equal(isoWeek(new Date('2026-11-04T00:00:00Z')), '2026-W45');
    assert.equal(isoWeek(new Date('2026-01-01T00:00:00Z')), '2026-W01');
    assert.equal(isoWeek(new Date('2024-12-30T00:00:00Z')), '2025-W01');
    assert.equal(isoWeek(new Date('2021-01-03T23:59:59Z')), '2020-W53');
    assert.equal(isoWeek(new Date('2027-01-01T00:00:00Z')), '2026-W53');
});

test('refreshPeriod gera janelas diária, semanal e mensal em UTC', () => {
    assert.equal(refreshPeriod('daily', NOW), '2026-11-04');
    assert.equal(refreshPeriod('weekly', NOW), '2026-W45');
    assert.equal(refreshPeriod('monthly', NOW), '2026-11');
});

test('requiredTools espelha as condições do action.yml raiz', () => {
    assert.deepEqual(requiredTools({}), { pipeline: false, cli: false, sca: false });
    assert.deepEqual(requiredTools({ ENABLE_PIPELINESCAN: 'true' }), { pipeline: true, cli: false, sca: false });
    assert.deepEqual(requiredTools({ BASELINE_MODE: 'repo' }), { pipeline: true, cli: false, sca: false });
    assert.deepEqual(requiredTools({ BASELINE_MODE: 'portal_afrika' }), { pipeline: true, cli: false, sca: false });
    assert.deepEqual(requiredTools({ ENABLE_IAC: 'true' }), { pipeline: false, cli: true, sca: false });
    assert.deepEqual(requiredTools({ ENABLE_SCA: 'true' }), { pipeline: false, cli: false, sca: true });
    // Auto Packager só roda quando pipeline/upload/baseline precisam de artefato.
    assert.deepEqual(requiredTools({ ENABLE_AUTO_PACKAGER: 'true' }), { pipeline: false, cli: false, sca: false });
    assert.deepEqual(requiredTools({ ENABLE_AUTO_PACKAGER: 'true', ENABLE_UPLOAD_SCAN: 'true' }), { pipeline: false, cli: true, sca: false });
    assert.deepEqual(requiredTools({ ENABLE_AUTO_PACKAGER: 'true', ENABLE_PIPELINESCAN: 'true' }), { pipeline: true, cli: true, sca: false });
});

test('plano completo no Linux X64 usa URLs oficiais, diretórios em RUNNER_TEMP e chaves estáveis', () => {
    const p = plan(ALL);
    const manifest = loadManifest();
    assert.equal(p.enabled, true);
    assert.equal(p.period, '2026-W45');
    assert.equal(p.pipeline_dir, '/home/runner/work/_temp/veracode-connect-tools/pipeline-scan/2026-W45');
    assert.equal(p.pipeline_key, 'veracode-connect-tools-v1-pipeline-scan-Linux-2026-W45');
    assert.equal(p.pipeline_url, 'https://downloads.veracode.com/securityscan/pipeline-scan-LATEST.zip');
    assert.equal(p.pipeline_intercept_url, p.pipeline_url);
    assert.equal(p.cli_version, manifest.veracode_cli.version);
    assert.equal(p.cli_dir, `/home/runner/work/_temp/veracode-connect-tools/cli/${manifest.veracode_cli.version}`);
    assert.equal(p.cli_key, `veracode-connect-tools-v1-cli-Linux-X64-${manifest.veracode_cli.version}`);
    assert.equal(p.cli_url, `https://tools.veracode.com/veracode-cli/veracode-cli_${manifest.veracode_cli.version}_linux_x86.tar.gz`);
    assert.equal(p.cli_archive_sha256, manifest.veracode_cli.platforms.linux_x86.archive_sha256);
    assert.equal(p.cli_install_url, 'https://tools.veracode.com/veracode-cli/install');
    assert.equal(p.sca_key, 'veracode-connect-tools-v1-sca-Linux-X64-2026-W45');
    assert.equal(p.sca_ci_url, 'https://download.sourceclear.com/ci.sh');
    assert.equal(p.sca_archive_url, 'https://sca-downloads.veracode.com/srcclr-{version}-linux.tgz');
    assert.equal(p.sca_ci_intercept_urls, 'https://download.sourceclear.com/ci.sh https://sca-downloads.veracode.com/ci.sh');
    assert.deepEqual(p.warnings, []);
});

test('a chave da CLI não muda com a janela de renovação (versão pinada)', () => {
    const daily = plan({ ...ALL, TOOLS_CACHE_REFRESH: 'daily' });
    const nextDay = buildPlan({ ...LINUX, ...ALL, TOOLS_CACHE_REFRESH: 'daily' }, { now: new Date('2026-11-05T00:00:01Z'), musl: false });
    assert.equal(daily.cli_key, nextDay.cli_key);
    assert.notEqual(daily.pipeline_key, nextDay.pipeline_key);
    assert.notEqual(daily.sca_key, nextDay.sca_key);
});

test('tools_mirror_url troca a origem dos downloads, mas os shims seguem interceptando as URLs oficiais', () => {
    const p = plan({ ...ALL, TOOLS_MIRROR_URL: 'https://mirror.example.com/veracode/' });
    const version = loadManifest().veracode_cli.version;
    assert.equal(p.mirror_url, 'https://mirror.example.com/veracode');
    assert.equal(p.pipeline_url, 'https://mirror.example.com/veracode/securityscan/pipeline-scan-LATEST.zip');
    assert.equal(p.cli_url, `https://mirror.example.com/veracode/veracode-cli/veracode-cli_${version}_linux_x86.tar.gz`);
    assert.equal(p.sca_ci_url, 'https://mirror.example.com/veracode/sca/ci.sh');
    assert.equal(p.sca_version_url, 'https://mirror.example.com/veracode/sca/LATEST_VERSION');
    assert.equal(p.sca_archive_url, 'https://mirror.example.com/veracode/sca/srcclr-{version}-linux.tgz');
    assert.equal(p.pipeline_intercept_url, 'https://downloads.veracode.com/securityscan/pipeline-scan-LATEST.zip');
    assert.match(p.pipeline_key, /-pipeline-scan-Linux-m[0-9a-f]{8}-2026-W45$/);
    assert.equal(p.cli_key, `veracode-connect-tools-v1-cli-Linux-X64-${version}`, 'CLI tem sha pinado: mesma chave');
});

test('normalizeMirror aceita só https sem caracteres de shell', () => {
    assert.deepEqual(normalizeMirror(''), { url: '', invalid: false });
    assert.deepEqual(normalizeMirror('https://a.b/c//'), { url: 'https://a.b/c', invalid: false });
    assert.equal(normalizeMirror('http://a.b').invalid, true);
    assert.equal(normalizeMirror('https://a.b/$(id)').invalid, true);
    assert.equal(normalizeMirror("https://a.b/'x").invalid, true);
    assert.equal(normalizeMirror('https://a b').invalid, true);
});

test('mirror inválido gera warning e cai nas URLs oficiais', () => {
    const p = plan({ ...ALL, TOOLS_MIRROR_URL: 'http://inseguro.local' });
    assert.equal(p.mirror_url, '');
    assert.equal(p.pipeline_url, 'https://downloads.veracode.com/securityscan/pipeline-scan-LATEST.zip');
    assert.match(p.warnings.join('\n'), /tools_mirror_url ignorado/);
});

test('tools_cache_refresh inválido vira weekly com warning', () => {
    const p = plan({ ...ALL, TOOLS_CACHE_REFRESH: 'hourly' });
    assert.equal(p.refresh, 'weekly');
    assert.equal(p.period, '2026-W45');
    assert.match(p.warnings.join('\n'), /tools_cache_refresh inválido/);
});

test('enable_tools_cache=false desliga o plano', () => {
    const p = plan({ ...ALL, ENABLE_TOOLS_CACHE: 'false' });
    assert.equal(p.enabled, false);
    assert.equal(p.reason, 'disabled');
    assert.equal(p.need_pipeline, false);
});

test('runners não Linux ficam fora do cache e seguem o fluxo oficial', () => {
    for (const runnerOs of ['Windows', 'macOS']) {
        const p = buildPlan({ ...ALL, RUNNER_OS: runnerOs, RUNNER_ARCH: 'X64' }, { now: NOW, musl: false });
        assert.equal(p.enabled, false, runnerOs);
        assert.equal(p.reason, 'platform');
        assert.match(p.warnings[0], /requer Linux/);
    }
});

test('Linux ARM64 mantém só o Pipeline Scan (CLI e agente SCA são x86_64)', () => {
    const p = plan({ ...ALL, RUNNER_ARCH: 'ARM64' });
    assert.equal(p.enabled, true);
    assert.equal(p.need_pipeline, true);
    assert.equal(p.need_cli, false);
    assert.equal(p.need_sca, false);
    assert.equal(p.warnings.length, 2);
});

test('Alpine (musl) não usa cache do agente SCA', () => {
    const p = plan({ ENABLE_SCA: 'true' }, { musl: true });
    assert.equal(p.need_sca, false);
    assert.equal(p.enabled, false);
    assert.equal(p.reason, 'nothing');
    assert.match(p.warnings[0], /musl/);
});

test('isMusl lê /etc/os-release', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-osrel-'));
    const alpine = path.join(tmp, 'alpine');
    const ubuntu = path.join(tmp, 'ubuntu');
    fs.writeFileSync(alpine, 'ID=alpine\nVERSION_ID=3.20.0\n');
    fs.writeFileSync(ubuntu, 'ID=ubuntu\nVERSION_ID="24.04"\n');
    assert.equal(isMusl(alpine), true);
    assert.equal(isMusl(ubuntu), false);
    assert.equal(isMusl(path.join(tmp, 'ausente')), false);
});

test('nenhum scan que use ferramentas → plano desligado sem warnings', () => {
    const p = plan({ ENABLE_UPLOAD_SCAN: 'true' });
    assert.equal(p.enabled, false);
    assert.equal(p.reason, 'nothing');
    assert.deepEqual(p.warnings, []);
});

test('CLI do plan.js grava todas as chaves em GITHUB_OUTPUT', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-plan-'));
    const out = path.join(tmp, 'output');
    const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'plan.js')], {
        env: { ...process.env, ...LINUX, ...ALL, GITHUB_OUTPUT: out },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /toolchain: pipeline=true cli=true sca=true refresh=weekly/);
    const outputs = Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map(line => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
    }));
    assert.equal(outputs.enabled, 'true');
    assert.equal(outputs.need_cli, 'true');
    assert.ok(outputs.cli_key.startsWith('veracode-connect-tools-v1-cli-Linux-X64-'));
    for (const value of Object.values(outputs)) {
        assert.ok(!value.includes('\n'));
    }
});
