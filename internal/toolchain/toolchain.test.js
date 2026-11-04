'use strict';

/**
 * Executa o toolchain.sh e o curl-shim.sh de verdade (bash) com um "curl real"
 * falso: sem mapa ele responde como rede indisponível (exit 7) e registra cada
 * chamada. Assim os testes provam que os comandos idênticos aos das actions
 * oficiais da Veracode funcionam sem nenhuma requisição de rede.
 */

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { bundleDirectory } = require('../veracode-upload-scan/bundle-upload-dir.js');

const root = path.resolve(__dirname, '../..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const bashAvailable = cp.spawnSync(bash, ['--version']).status === 0;
const skip = bashAvailable ? false : 'bash indisponível';

const URLS = {
    pipeline: 'https://downloads.veracode.com/securityscan/pipeline-scan-LATEST.zip',
    cliInstall: 'https://tools.veracode.com/veracode-cli/install',
    cliArchive: 'https://tools.veracode.com/veracode-cli/veracode-cli_2.54.1_linux_x86.tar.gz',
    scaCi: 'https://download.sourceclear.com/ci.sh',
    scaCiAlias: 'https://sca-downloads.veracode.com/ci.sh',
    scaVersion: 'https://sca-downloads.veracode.com/LATEST_VERSION',
    scaArchive: 'https://sca-downloads.veracode.com/srcclr-{version}-linux.tgz',
    wrapperMeta: 'https://repo1.maven.org/maven2/com/veracode/vosp/api/wrappers/vosp-api-wrappers-java/maven-metadata.xml'
};
const SCA_VERSION = '3.8.123';

function toPosix(p) {
    if (process.platform !== 'win32') return p;
    return p.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/');
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeExec(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.replace(/\r\n/g, '\n'), { mode: 0o755 });
}

function runBash(script, { env = {}, cwd } = {}) {
    const result = cp.spawnSync(bash, ['-c', script], {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 60000
    });
    if (result.error) throw result.error;
    return result;
}

function readOutputs(file) {
    const outputs = {};
    if (!fs.existsSync(file)) return outputs;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1);
    }
    return outputs;
}

/** "curl"/"wget" reais falsos + uname=Linux. Com FAKE_CURL_MAP, serve fixtures; sem ele, rede indisponível. */
function fakeBin(dir) {
    writeExec(path.join(dir, 'curl'), `#!/usr/bin/env bash
echo "curl $*" >> "\${FAKE_NET_LOG}"
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2; continue ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
src=""
if [ -n "\${FAKE_CURL_MAP:-}" ] && [ -f "\${FAKE_CURL_MAP}" ]; then
  src="$(awk -F'\\t' -v u="$url" '$1==u {print $2; exit}' "\${FAKE_CURL_MAP}")"
fi
if [ -z "$src" ] || [ ! -f "$src" ]; then
  echo "curl: (7) Failed to connect: rede bloqueada no teste ($url)" >&2
  exit 7
fi
if [ -n "$out" ]; then cp "$src" "$out"; else cat "$src"; fi
`);
    writeExec(path.join(dir, 'wget'), `#!/usr/bin/env bash
echo "wget $*" >> "\${FAKE_NET_LOG}"
echo "wget: rede bloqueada no teste" >&2
exit 4
`);
    writeExec(path.join(dir, 'uname'), `#!/usr/bin/env bash
case "\${1:-}" in -m) echo x86_64 ;; *) echo Linux ;; esac
`);
}

/** Pacotes falsos com o mesmo layout dos oficiais. */
function buildFixtures(dir) {
    const f = { dir };

    const cliRoot = path.join(dir, 'cli-src');
    const cliPkg = path.join(cliRoot, 'veracode-cli_2.54.1_linux_x86');
    writeExec(path.join(cliPkg, 'veracode'), '#!/bin/sh\necho "veracode-cli-fake 2.54.1 $*"\n');
    fs.writeFileSync(path.join(cliPkg, 'LICENSE'), 'fake license\n');
    fs.writeFileSync(path.join(cliPkg, 'VERSION'), '2.54.1\n');
    f.cliArchive = path.join(dir, 'cli.tgz');
    const tarCli = runBash(`tar czf "${toPosix(f.cliArchive)}" -C "${toPosix(cliRoot)}" veracode-cli_2.54.1_linux_x86`);
    assert.equal(tarCli.status, 0, tarCli.stderr);
    f.cliArchiveSha = sha256(f.cliArchive);
    f.cliBinarySha = sha256(path.join(cliPkg, 'veracode'));

    const zipSrc = path.join(dir, 'zip-src');
    fs.mkdirSync(zipSrc, { recursive: true });
    fs.writeFileSync(path.join(zipSrc, 'pipeline-scan.jar'), 'PK-fake-jar');
    fs.writeFileSync(path.join(zipSrc, 'README.md'), 'pipeline scan fake\n');
    f.pipelineZip = path.join(dir, 'pipeline-scan-LATEST.zip');
    bundleDirectory(zipSrc, f.pipelineZip);

    // Mesmo fluxo e mesmas chamadas de curl do ci.sh oficial (check_and_set_latest_version/download/extract/run_scan).
    f.scaCi = path.join(dir, 'ci.sh');
    writeExec(f.scaCi, `#!/usr/bin/env sh
# fixture do srcclr ci.sh
CACHE_DIR=\${CACHE_DIR:-/tmp}
NOSCAN=\${NOSCAN:-0}
FOLDER="$(mktemp -d)"
if curl -m30 -f -v -o "$FOLDER/version" https://sca-downloads.veracode.com/LATEST_VERSION 2>"$FOLDER/curl-output"; then
  version=$(cat "$FOLDER/version")
else
  echo "warning: LATEST_VERSION indisponível" >&2
  cat "$FOLDER/curl-output" >&2
  exit 1
fi
if [ ! -e "\${CACHE_DIR}/srcclr-\${version}-linux.tgz" ]; then
  if ! curl -m 300 -f -v -o "$FOLDER/srcclr-\${version}-linux.tgz" "https://sca-downloads.veracode.com/srcclr-\${version}-linux.tgz" 2>"$FOLDER/curl-output"; then
    echo "We were not able to download your installation package" >&2
    exit 1
  fi
  mv "$FOLDER/srcclr-\${version}-linux.tgz" "\${CACHE_DIR}"
fi
rm -rf "\${CACHE_DIR}/srcclr"
mkdir -p "\${CACHE_DIR}/srcclr"
tar xzf "\${CACHE_DIR}/srcclr-\${version}-linux.tgz" -C "\${CACHE_DIR}/srcclr" --strip-components=1
if [ "\${NOSCAN}" -ne 0 ]; then
  echo "agent=\${version}"
  exit 0
fi
exec "\${CACHE_DIR}/srcclr/bin/srcclr" "$@"
`);
    f.scaVersionFile = path.join(dir, 'LATEST_VERSION');
    fs.writeFileSync(f.scaVersionFile, `${SCA_VERSION}\n`);
    const scaRoot = path.join(dir, 'sca-src');
    writeExec(path.join(scaRoot, `srcclr-${SCA_VERSION}`, 'bin', 'srcclr'), '#!/bin/sh\necho "srcclr-fake $*"\n');
    f.scaArchive = path.join(dir, `srcclr-${SCA_VERSION}-linux.tgz`);
    const tarSca = runBash(`tar czf "${toPosix(f.scaArchive)}" -C "${toPosix(scaRoot)}" srcclr-${SCA_VERSION}`);
    assert.equal(tarSca.status, 0, tarSca.stderr);
    return f;
}

function writeNetMap(file, fixtures, overrides = {}) {
    const entries = {
        [URLS.pipeline]: fixtures.pipelineZip,
        [URLS.cliArchive]: fixtures.cliArchive,
        [URLS.scaCi]: fixtures.scaCi,
        [URLS.scaVersion]: fixtures.scaVersionFile,
        [URLS.scaArchive.replace('{version}', SCA_VERSION)]: fixtures.scaArchive,
        ...overrides
    };
    const lines = Object.entries(entries)
        .filter(([, value]) => value)
        .map(([url, local]) => `${url}\t${toPosix(local)}`);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function setup() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-toolchain-'));
    const ctx = {
        tmp,
        fake: path.join(tmp, 'fake-bin'),
        runnerTemp: path.join(tmp, 'runner-temp'),
        netLog: path.join(tmp, 'net.log'),
        netMap: path.join(tmp, 'net-map.tsv'),
        output: path.join(tmp, 'github-output'),
        ghPath: path.join(tmp, 'github-path'),
        ghEnv: path.join(tmp, 'github-env')
    };
    fs.mkdirSync(ctx.runnerTemp, { recursive: true });
    fs.writeFileSync(ctx.netLog, '');
    fakeBin(ctx.fake);
    ctx.fixtures = buildFixtures(path.join(tmp, 'fixtures'));
    ctx.toolsRoot = path.join(ctx.runnerTemp, 'veracode-connect-tools');
    ctx.dirs = {
        pipeline: path.join(ctx.toolsRoot, 'pipeline-scan', '2026-W45'),
        cli: path.join(ctx.toolsRoot, 'cli', '2.54.1'),
        sca: path.join(ctx.toolsRoot, 'sca', '2026-W45')
    };
    ctx.shimDir = path.join(ctx.runnerTemp, 'veracode-connect-tool-shims');
    return ctx;
}

function baseEnv(ctx, extra = {}) {
    return {
        FAKE_NET_LOG: toPosix(ctx.netLog),
        GITHUB_OUTPUT: toPosix(ctx.output),
        GITHUB_PATH: toPosix(ctx.ghPath),
        GITHUB_ENV: toPosix(ctx.ghEnv),
        RUNNER_TEMP: toPosix(ctx.runnerTemp),
        FAKE_DIR: toPosix(ctx.fake),
        ...extra
    };
}

function fetch(ctx, extra = {}) {
    fs.writeFileSync(ctx.output, '');
    const env = baseEnv(ctx, {
        FAKE_CURL_MAP: toPosix(ctx.netMap),
        TOOLS_ROOT: toPosix(ctx.toolsRoot),
        NEED_PIPELINE: 'true',
        PIPELINE_DIR: toPosix(ctx.dirs.pipeline),
        PIPELINE_URL: URLS.pipeline,
        NEED_CLI: 'true',
        CLI_DIR: toPosix(ctx.dirs.cli),
        CLI_URL: URLS.cliArchive,
        CLI_ARCHIVE_SHA256: ctx.fixtures.cliArchiveSha,
        CLI_BINARY_SHA256: ctx.fixtures.cliBinarySha,
        NEED_SCA: 'true',
        SCA_DIR: toPosix(ctx.dirs.sca),
        SCA_CI_URL: URLS.scaCi,
        SCA_VERSION_URL: URLS.scaVersion,
        SCA_ARCHIVE_URL: URLS.scaArchive,
        ...extra
    });
    const result = runBash(`export PATH="$FAKE_DIR:$PATH"; bash "${toPosix(path.join(__dirname, 'toolchain.sh'))}" fetch`, { env });
    return { result, outputs: readOutputs(ctx.output) };
}

function installShims(ctx, outputs, extra = {}) {
    fs.writeFileSync(ctx.output, '');
    const env = baseEnv(ctx, {
        PIPELINE_READY: outputs.pipeline_ready || 'false',
        PIPELINE_DIR: toPosix(ctx.dirs.pipeline),
        PIPELINE_INTERCEPT_URL: URLS.pipeline,
        CLI_READY: outputs.cli_ready || 'false',
        CLI_DIR: toPosix(ctx.dirs.cli),
        CLI_VERSION: '2.54.1',
        CLI_INSTALL_URL: URLS.cliInstall,
        SCA_READY: outputs.sca_ready || 'false',
        SCA_DIR: toPosix(ctx.dirs.sca),
        SCA_VERSION: outputs.sca_version || '',
        SCA_CI_INTERCEPT_URLS: `${URLS.scaCi} ${URLS.scaCiAlias}`,
        SCA_VERSION_INTERCEPT_URL: URLS.scaVersion,
        SCA_ARCHIVE_INTERCEPT_URL: URLS.scaArchive,
        ...extra
    });
    const result = runBash(`export PATH="$FAKE_DIR:$PATH"; bash "${toPosix(path.join(__dirname, 'toolchain.sh'))}" shims`, { env });
    return { result, outputs: readOutputs(ctx.output) };
}

/** Executa um comando como as actions oficiais fariam: shim na frente do PATH e rede bloqueada. */
function upstream(ctx, command, { cwd, pathPrefix } = {}) {
    const prefix = pathPrefix || [toPosix(ctx.shimDir)];
    return runBash(`export PATH="${prefix.join(':')}:$FAKE_DIR:$PATH"; ${command}`, {
        cwd,
        env: baseEnv(ctx)
    });
}

function netCalls(ctx) {
    return fs.readFileSync(ctx.netLog, 'utf8').split(/\r?\n/).filter(Boolean);
}

function readyToolchain() {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    const fetched = fetch(ctx);
    assert.equal(fetched.result.status, 0, fetched.result.stderr + fetched.result.stdout);
    const shims = installShims(ctx, fetched.outputs);
    assert.equal(shims.result.status, 0, shims.result.stderr + shims.result.stdout);
    fs.writeFileSync(ctx.netLog, '');
    return { ctx, fetched, shims };
}

test('fetch baixa cada ferramenta uma única vez, verifica e sela o diretório', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(outputs.pipeline_ready, 'true');
    assert.equal(outputs.pipeline_fetched, 'true');
    assert.equal(outputs.cli_ready, 'true');
    assert.equal(outputs.cli_fetched, 'true');
    assert.equal(outputs.sca_ready, 'true');
    assert.equal(outputs.sca_fetched, 'true');
    assert.equal(outputs.sca_version, SCA_VERSION);
    assert.equal(netCalls(ctx).length, 5, 'pipeline + cli + ci.sh + LATEST_VERSION + agente');
    for (const dir of Object.values(ctx.dirs)) {
        assert.ok(fs.existsSync(path.join(dir, '.complete')), `${dir} sem .complete`);
    }
    assert.equal(sha256(path.join(ctx.dirs.cli, 'veracode')), ctx.fixtures.cliBinarySha);
    assert.deepEqual(fs.readdirSync(ctx.toolsRoot).filter(name => name.startsWith('.tmp')), []);
});

test('fetch reaproveita o cache restaurado sem nenhuma chamada de rede', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    assert.equal(fetch(ctx).result.status, 0);
    fs.writeFileSync(ctx.netLog, '');
    fs.rmSync(ctx.netMap);

    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(netCalls(ctx), []);
    assert.equal(outputs.pipeline_fetched, 'false');
    assert.equal(outputs.cli_fetched, 'false');
    assert.equal(outputs.sca_fetched, 'false');
    assert.equal(outputs.pipeline_ready, 'true');
    assert.equal(outputs.cli_ready, 'true');
    assert.equal(outputs.sca_ready, 'true');
    assert.match(result.stdout, /reutilizado do cache/);
});

test('fetch só baixa as ferramentas exigidas pela execução', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    const { result, outputs } = fetch(ctx, { NEED_CLI: 'false', NEED_SCA: 'false' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.pipeline_ready, 'true');
    assert.equal(outputs.cli_ready, 'false');
    assert.equal(outputs.sca_ready, 'false');
    assert.equal(netCalls(ctx).length, 1);
    assert.ok(!fs.existsSync(ctx.dirs.cli));
});

test('fetch recusa a Veracode CLI com sha256 diferente do pinado e não derruba o step', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    const { result, outputs } = fetch(ctx, { CLI_ARCHIVE_SHA256: '0'.repeat(64) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.cli_ready, 'false');
    assert.equal(outputs.cli_fetched, 'false');
    assert.match(result.stdout, /::warning::veracode-cli: verificação de integridade falhou/);
    assert.ok(!fs.existsSync(path.join(ctx.dirs.cli, 'veracode')));
    assert.equal(outputs.pipeline_ready, 'true');
});

test('fetch marca ferramenta indisponível quando o download falha', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures, { [URLS.pipeline]: '' });
    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.pipeline_ready, 'false');
    assert.match(result.stdout, /::warning::pipeline-scan: falha ao baixar/);
    assert.equal(outputs.cli_ready, 'true');
});

test('fetch rejeita zip do Pipeline Scan sem pipeline-scan.jar', { skip }, () => {
    const ctx = setup();
    const bogusSrc = path.join(ctx.tmp, 'bogus-src');
    fs.mkdirSync(bogusSrc);
    fs.writeFileSync(path.join(bogusSrc, 'index.html'), '<html>erro</html>');
    const bogusZip = path.join(ctx.tmp, 'bogus.zip');
    bundleDirectory(bogusSrc, bogusZip);
    writeNetMap(ctx.netMap, ctx.fixtures, { [URLS.pipeline]: bogusZip });
    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.pipeline_ready, 'false');
    assert.match(result.stdout, /zip inválido ou sem pipeline-scan.jar/);
});

test('fetch descarta cache adulterado e baixa de novo', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    assert.equal(fetch(ctx).result.status, 0);
    fs.appendFileSync(path.join(ctx.dirs.pipeline, 'pipeline-scan-LATEST.zip'), 'lixo');
    fs.appendFileSync(path.join(ctx.dirs.cli, 'veracode'), '\necho adulterado\n');
    fs.writeFileSync(ctx.netLog, '');

    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.pipeline_fetched, 'true');
    assert.equal(outputs.cli_fetched, 'true');
    assert.equal(outputs.sca_fetched, 'false');
    assert.match(result.stdout, /conteúdo em cache inválido/);
    assert.equal(sha256(path.join(ctx.dirs.pipeline, 'pipeline-scan-LATEST.zip')), sha256(ctx.fixtures.pipelineZip));
    assert.equal(sha256(path.join(ctx.dirs.cli, 'veracode')), ctx.fixtures.cliBinarySha);
});

test('fetch rejeita CLI trocada mesmo com .complete refeito (sha256 pinado do binário)', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    assert.equal(fetch(ctx).result.status, 0);
    const binary = path.join(ctx.dirs.cli, 'veracode');
    fs.writeFileSync(binary, '#!/bin/sh\necho binario-trocado\n');
    const reseal = runBash(`cd "${toPosix(ctx.dirs.cli)}" && sha256sum veracode > .complete`);
    assert.equal(reseal.status, 0, reseal.stderr);
    fs.writeFileSync(ctx.netLog, '');

    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.cli_fetched, 'true', 'binário fora do pin deve ser baixado de novo');
    assert.equal(sha256(binary), ctx.fixtures.cliBinarySha);
    assert.equal(netCalls(ctx).length, 1);
});

test('fetch rejeita LATEST_VERSION do SCA com caracteres inválidos', { skip }, () => {
    const ctx = setup();
    const evil = path.join(ctx.tmp, 'evil-version');
    fs.writeFileSync(evil, '1.0;rm -rf /\n');
    writeNetMap(ctx.netMap, ctx.fixtures, { [URLS.scaVersion]: evil });
    const { result, outputs } = fetch(ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.sca_ready, 'false');
    assert.match(result.stdout, /LATEST_VERSION inválido/);
});

test('shims publicam PATH, VERACODE_CONNECT_CLI e o map de URLs', { skip }, () => {
    const { ctx, shims } = readyToolchain();
    assert.equal(shims.outputs.shims_installed, 'true');
    assert.equal(shims.outputs.shim_dir, toPosix(ctx.shimDir));
    assert.equal(fs.readFileSync(ctx.ghPath, 'utf8').trim(), toPosix(ctx.shimDir));
    const ghEnv = fs.readFileSync(ctx.ghEnv, 'utf8');
    assert.match(ghEnv, new RegExp(`VERACODE_CONNECT_CLI=${toPosix(ctx.dirs.cli)}/veracode`));
    assert.match(ghEnv, /VERACODE_CONNECT_SHIM_DIR=/);
    const map = fs.readFileSync(path.join(ctx.shimDir, 'map.tsv'), 'utf8');
    for (const url of [URLS.pipeline, URLS.cliInstall, URLS.scaCi, URLS.scaCiAlias, URLS.scaVersion, URLS.scaArchive.replace('{version}', SCA_VERSION)]) {
        assert.ok(map.includes(`${url}\t`), `map sem ${url}`);
    }
    assert.match(fs.readFileSync(path.join(ctx.shimDir, 'curl'), 'utf8'), /^#!\/usr\/bin\/env bash\n# veracode-connect-shim/);
});

test('Pipeline Scan: "curl -sSO" + unzip do upstream usam o cache em todos os slots sem rede', { skip }, () => {
    const { ctx } = readyToolchain();
    const work = path.join(ctx.tmp, 'workspace');
    fs.mkdirSync(work);
    // Mesmo comando de veracode/Veracode-pipeline-scan-action (src/pipeline-scan.ts) — repetido como em 6 slots.
    for (let slot = 1; slot <= 6; slot++) {
        const result = upstream(ctx, 'curl -sSO https://downloads.veracode.com/securityscan/pipeline-scan-LATEST.zip && unzip -o pipeline-scan-LATEST.zip >/dev/null', { cwd: work });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '', 'shim silencioso: o SCA oficial publica stderr como erro');
    }
    const verbose = upstream(ctx, `VERACODE_CONNECT_SHIM_VERBOSE=1 curl -sSO ${URLS.pipeline}`, { cwd: work });
    assert.match(verbose.stderr, /servido do cache local \(sem rede\)/);
    assert.equal(fs.readFileSync(path.join(work, 'pipeline-scan.jar'), 'utf8'), 'PK-fake-jar');
    assert.deepEqual(netCalls(ctx), []);
    const served = fs.readFileSync(path.join(ctx.shimDir, 'served.log'), 'utf8').trim().split('\n');
    assert.equal(served.length, 7, "6 slots + chamada verbose");
});

test('IaC: instalador "curl -fsS .../install | sh" do upstream copia a CLI do cache', { skip }, () => {
    const { ctx } = readyToolchain();
    const work = path.join(ctx.tmp, 'work', 'repo');
    fs.mkdirSync(work, { recursive: true });
    // Mesmo comando de veracode/container_iac_secrets_scanning (src/install_cli.ts + run_command.ts).
    const result = upstream(ctx,
        'cd ..;mkdir veracode-cli; cd veracode-cli; curl -fsS https://tools.veracode.com/veracode-cli/install | sh && cd ../repo && ../veracode-cli/veracode version',
        { cwd: work });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /veracode-cli-fake 2\.54\.1 version/);
    assert.match(result.stdout, /instalada a partir do cache do Veracode Connect/);
    assert.deepEqual(netCalls(ctx), []);
    assert.ok(!fs.existsSync(path.join(work, 'LICENSE')), 'não deve escrever arquivos no workspace');
});

test('SCA: "curl -sSL ci.sh | sh -s -- scan" usa agente e LATEST_VERSION do cache', { skip }, () => {
    const { ctx } = readyToolchain();
    const work = path.join(ctx.tmp, 'sca-work');
    fs.mkdirSync(work);
    // Mesmo comando de veracode/veracode-sca (src/srcclr.ts).
    const result = upstream(ctx, 'curl -sSL https://download.sourceclear.com/ci.sh | sh -s -- scan --allow-dirty --recursive --json=scaResults.json', { cwd: work });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /srcclr-fake scan --allow-dirty --recursive --json=scaResults.json/);
    assert.doesNotMatch(result.stderr, /veracode-connect/, "nada do shim no stderr capturado pela action SCA");
    assert.deepEqual(netCalls(ctx), []);
    assert.ok(fs.existsSync(path.join(ctx.dirs.sca, 'srcclr', 'bin', 'srcclr')), 'agente extraído no CACHE_DIR do toolchain');
});

test('shim delega URLs desconhecidas, HEAD e múltiplas URLs ao próximo curl', { skip }, () => {
    const { ctx } = readyToolchain();
    const cases = [
        'curl -fsS https://api.github.com/repos/x/y',
        `curl -I ${URLS.pipeline}`,
        `curl --head ${URLS.pipeline}`,
        `curl -O ${URLS.pipeline} -O https://example.com/other.zip`
    ];
    for (const command of cases) {
        fs.writeFileSync(ctx.netLog, '');
        const result = upstream(ctx, command, { cwd: ctx.tmp });
        assert.equal(result.status, 7, `${command}: ${result.stderr}`);
        assert.equal(netCalls(ctx).length, 1, command);
    }
});

test('shim respeita -o, -oARQ, --output, --output= e stdout', { skip }, () => {
    const { ctx } = readyToolchain();
    const out = path.join(ctx.tmp, 'outs');
    fs.mkdirSync(out);
    const variants = [
        `curl -fsSL -o a.zip ${URLS.pipeline}`,
        `curl -sSoa2.zip ${URLS.pipeline}`,
        `curl --output b.zip ${URLS.pipeline}`,
        `curl --output=c.zip ${URLS.pipeline}?ts=1`,
        `curl -m30 -f -v ${URLS.pipeline} > d.zip`,
        `curl --connect-timeout 15 -H "Accept: */*" -sS ${URLS.pipeline} -o e.zip`
    ];
    for (const command of variants) {
        const result = upstream(ctx, command, { cwd: out });
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    }
    for (const name of ['a.zip', 'a2.zip', 'b.zip', 'c.zip', 'd.zip', 'e.zip']) {
        assert.equal(sha256(path.join(out, name)), sha256(ctx.fixtures.pipelineZip), name);
    }
    assert.deepEqual(netCalls(ctx), []);
});

test('shim cai para a rede quando o arquivo em cache sumiu', { skip }, () => {
    const { ctx } = readyToolchain();
    fs.rmSync(ctx.dirs.pipeline, { recursive: true, force: true });
    const result = upstream(ctx, `curl -sSO ${URLS.pipeline}`, { cwd: ctx.tmp });
    assert.equal(result.status, 7);
    assert.equal(netCalls(ctx).length, 1);
});

test('shims de chamadas anteriores no mesmo job são mesclados e o PATH não é duplicado', { skip }, () => {
    const ctx = setup();
    writeNetMap(ctx.netMap, ctx.fixtures);
    const { outputs } = fetch(ctx);
    installShims(ctx, { ...outputs, cli_ready: 'false', sca_ready: 'false' });
    let map = fs.readFileSync(path.join(ctx.shimDir, 'map.tsv'), 'utf8');
    assert.ok(map.includes(URLS.pipeline));
    assert.ok(!map.includes(URLS.cliInstall));

    fs.writeFileSync(ctx.ghPath, '');
    const second = installShims(ctx, { ...outputs, pipeline_ready: 'false' }, {});
    assert.equal(second.result.status, 0, second.result.stderr);
    map = fs.readFileSync(path.join(ctx.shimDir, 'map.tsv'), 'utf8');
    for (const url of [URLS.pipeline, URLS.cliInstall, URLS.scaCi]) {
        assert.ok(map.includes(`${url}\t`), `map sem ${url}`);
    }
    assert.equal(map.split('\n').filter(line => line.startsWith(`${URLS.pipeline}\t`)).length, 1);

    fs.writeFileSync(ctx.ghPath, '');
    const env = baseEnv(ctx, { PIPELINE_READY: 'true', PIPELINE_DIR: toPosix(ctx.dirs.pipeline), PIPELINE_INTERCEPT_URL: URLS.pipeline });
    const again = runBash(`export PATH="${toPosix(ctx.shimDir)}:$FAKE_DIR:$PATH"; bash "${toPosix(path.join(__dirname, 'toolchain.sh'))}" shims`, { env });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(fs.readFileSync(ctx.ghPath, 'utf8'), '', 'diretório já no PATH não é reinserido');
});

test('segunda chamada sem ferramentas novas preserva o map da chamada anterior', { skip }, () => {
    const { ctx } = readyToolchain();
    const before = fs.readFileSync(path.join(ctx.shimDir, 'map.tsv'), 'utf8');
    const { result, outputs } = installShims(ctx, {});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.shims_installed, 'true');
    assert.equal(fs.readFileSync(path.join(ctx.shimDir, 'map.tsv'), 'utf8'), before);
    const pipeline = upstream(ctx, `curl -sSO ${URLS.pipeline}`, { cwd: ctx.tmp });
    assert.equal(pipeline.status, 0, pipeline.stderr);
    assert.deepEqual(netCalls(ctx), []);
});

test('shims sem nenhuma ferramenta pronta não alteram o PATH', { skip }, () => {
    const ctx = setup();
    const { result, outputs } = installShims(ctx, {});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.shims_installed, 'false');
    assert.match(result.stdout, /shims de rede não instalados/);
    assert.ok(!fs.existsSync(ctx.ghPath) || fs.readFileSync(ctx.ghPath, 'utf8') === '');
});

test('shim do toolchain encadeia com o shim do wrapper Java (Upload & Scan) sem loop', { skip }, () => {
    const { ctx } = readyToolchain();
    const uploadTemp = path.join(ctx.tmp, 'upload-temp');
    const workspace = path.join(ctx.tmp, 'upload-ws');
    fs.mkdirSync(uploadTemp);
    fs.mkdirSync(workspace);
    const prepareEnv = baseEnv(ctx, {
        GITHUB_ACTION_PATH: toPosix(path.join(root, 'internal', 'veracode-upload-scan')),
        GITHUB_WORKSPACE: toPosix(workspace),
        RUNNER_TEMP: toPosix(uploadTemp),
        GITHUB_PATH: toPosix(path.join(ctx.tmp, 'upload-github-path'))
    });
    const prepare = runBash(`export PATH="${toPosix(ctx.shimDir)}:$FAKE_DIR:$PATH"; bash "$GITHUB_ACTION_PATH/prepare-java-wrapper.sh"`, { env: prepareEnv });
    assert.equal(prepare.status, 0, prepare.stderr + prepare.stdout);
    const uploadShim = toPosix(path.join(uploadTemp, 'veracode-connect-wrapper-shims'));
    const version = fs.readFileSync(path.join(root, 'internal', 'veracode-upload-scan', 'vendor', 'VERSION'), 'utf8').trim();

    // Ordem de um segundo Connect no mesmo job: shim do wrapper na frente, shim do toolchain repetido.
    const prefix = [uploadShim, toPosix(ctx.shimDir), uploadShim, toPosix(ctx.shimDir)];
    const meta = upstream(ctx, `curl ${URLS.wrapperMeta}`, { pathPrefix: prefix, cwd: workspace });
    assert.equal(meta.status, 0, meta.stderr);
    assert.match(meta.stdout, new RegExp(`<latest>${version.replace(/\./g, '\\.')}</latest>`));

    const jarUrl = `https://repo1.maven.org/maven2/com/veracode/vosp/api/wrappers/vosp-api-wrappers-java/${version}/vosp-api-wrappers-java-${version}.jar`;
    const jar = upstream(ctx, `wget ${jarUrl}`, { pathPrefix: prefix, cwd: workspace });
    assert.equal(jar.status, 0, jar.stderr);

    const pipeline = upstream(ctx, `curl -sSO ${URLS.pipeline}`, { pathPrefix: prefix, cwd: workspace });
    assert.equal(pipeline.status, 0, pipeline.stderr);
    assert.ok(fs.existsSync(path.join(workspace, 'pipeline-scan-LATEST.zip')));
    assert.deepEqual(netCalls(ctx), [], 'wrapper e pipeline sem rede');

    const unknown = upstream(ctx, 'curl -fsS https://example.com/x', { pathPrefix: prefix, cwd: workspace });
    assert.equal(unknown.status, 7, unknown.stderr);
    assert.equal(netCalls(ctx).length, 1, 'URL desconhecida chega exatamente uma vez ao curl real');
});
