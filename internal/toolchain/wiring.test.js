'use strict';

/**
 * Garante a ligação do toolchain e do cache de dependências no action.yml raiz
 * e nas sub-actions (ordem dos steps, inputs repassados, pins e consistência
 * de versões). Estes contratos não aparecem em testes unitários dos scripts.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const rootAction = read('action.yml');
const manifest = JSON.parse(read('internal/toolchain/tools.json'));

const NEW_INPUTS = {
    enable_tools_cache: "'true'",
    tools_cache_refresh: "'weekly'",
    tools_mirror_url: "''",
    cache_dependencies: "'true'",
    maven_mirror_url: "''",
    maven_mirror_of: "'central'",
    maven_mirror_username: "''",
    maven_mirror_password: "''"
};

function stepIndex(source, id) {
    const index = source.indexOf(`\n      id: ${id}\n`);
    assert.notEqual(index, -1, `step ${id} ausente`);
    return index;
}

function stepBlock(source, id) {
    const start = source.lastIndexOf('\n    - name:', stepIndex(source, id));
    const next = source.indexOf('\n    - name:', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
}

function inputBlock(source, name) {
    const match = source.match(new RegExp(`\\n  ${name}:\\n((?:    .*\\n)+)`));
    assert.ok(match, `input ${name} ausente`);
    return match[1];
}

test('tools.json: versão pinada da CLI com sha256 do pacote e do binário', () => {
    assert.match(manifest.veracode_cli.version, /^\d+\.\d+\.\d+$/);
    const pin = manifest.veracode_cli.platforms.linux_x86;
    assert.match(pin.archive_sha256, /^[0-9a-f]{64}$/);
    assert.match(pin.binary_sha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.veracode_cli.url, /\{version\}.*\{platform\}/);
    assert.match(manifest.sca_agent.archive_url, /\{version\}/);
    for (const url of [manifest.veracode_cli.url, manifest.veracode_cli.install_url, manifest.pipeline_scan.url,
        manifest.sca_agent.ci_url, manifest.sca_agent.version_url, manifest.sca_agent.archive_url]) {
        assert.ok(url.startsWith('https://'), url);
    }
});

test('Auto Packager sem toolchain usa a mesma versão da CLI pinada no tools.json', () => {
    const packager = read('internal/auto-packager/action.yml');
    assert.match(inputBlock(packager, 'cli_version'), new RegExp(`default: '${manifest.veracode_cli.version.replace(/\./g, '\\.')}'`));
});

test('Auto Packager prefere a CLI do toolchain e não instala a CLI dentro do workspace', () => {
    const packager = read('internal/auto-packager/action.yml');
    const cache = stepBlock(packager, 'cli_cache');
    assert.match(cache, /env\.VERACODE_CONNECT_CLI == ''/);
    assert.match(cache, /path: \$\{\{ runner\.temp \}\}\/veracode-connect-cli/);
    assert.doesNotMatch(packager, /github\.workspace \}\}\/veracode\b/);
    assert.doesNotMatch(packager, /echo "\$\{(WORKSPACE|PWD)\}" >> "\$GITHUB_PATH"/);
    const prepare = stepBlock(packager, 'prepare');
    assert.ok(prepare.indexOf('VERACODE_CONNECT_CLI') < prepare.indexOf('command -v veracode'));
    assert.match(prepare, /cd "\$\{CLI_FALLBACK_DIR\}" && curl/);
});

test('IaC com política reutiliza a CLI do toolchain antes de instalar', () => {
    const iac = read('internal/veracode-iac/action.yml');
    const toolchain = iac.indexOf('if [ -n "${VERACODE_CONNECT_CLI:-}" ] && [ -x "${VERACODE_CONNECT_CLI}" ]; then');
    const install = iac.indexOf('curl -fsS https://tools.veracode.com/veracode-cli/install | sh');
    assert.notEqual(toolchain, -1);
    assert.ok(toolchain < install);
});

test('action.yml raiz declara os novos inputs com os defaults documentados', () => {
    for (const [name, value] of Object.entries(NEW_INPUTS)) {
        assert.match(inputBlock(rootAction, name), new RegExp(`default: ${value.replace(/[*]/g, '\\*')}\\n`), name);
    }
});

test('novos inputs chegam ao validate-inputs (with → inputs → env)', () => {
    const validateStep = stepBlock(rootAction, 'validate');
    const validateAction = read('internal/validate-inputs/action.yml');
    for (const name of Object.keys(NEW_INPUTS)) {
        assert.match(validateStep, new RegExp(`\\n        ${name}: \\$\\{\\{ inputs\\.${name} \\}\\}`), `with ${name}`);
        inputBlock(validateAction, name);
        assert.match(validateAction, new RegExp(`\\n        ${name.toUpperCase()}: \\$\\{\\{ inputs\\.${name} \\}\\}`), `env ${name}`);
    }
});

test('toolchain roda depois da validação e antes de todo step que baixa ferramentas', () => {
    const toolchain = stepIndex(rootAction, 'toolchain');
    assert.ok(stepIndex(rootAction, 'validate') < toolchain);
    for (const id of ['veracode_sca', 'veracode_iac', 'prepare_scan_file', 'baseline_flow', 'repo_baseline_flow', 'pipeline_only', 'upload_and_scan']) {
        assert.ok(toolchain < stepIndex(rootAction, id), `toolchain deve vir antes de ${id}`);
    }
    const block = stepBlock(rootAction, 'toolchain');
    assert.match(block, /continue-on-error: true/);
    assert.match(block, /if: inputs\.enable_tools_cache == 'true'/);
    assert.match(block, /uses: Afrika-Tecnologia\/Veracode-Connect\/internal\/toolchain@v1/);
    for (const input of ['enable_pipelinescan', 'enable_upload_scan', 'enable_sca', 'enable_iac', 'enable_auto_packager', 'tools_cache_refresh', 'tools_mirror_url']) {
        assert.match(block, new RegExp(`${input}: \\$\\{\\{ inputs\\.${input} \\}\\}`), input);
    }
    assert.match(block, /baseline_mode: \$\{\{ steps\.validate\.outputs\.baseline_mode \|\| inputs\.baseline_mode \}\}/);
});

test('cache de dependências restaura antes do SCA/Auto Packager e salva depois do Upload & Scan', () => {
    const restore = stepIndex(rootAction, 'deps_cache');
    const save = stepIndex(rootAction, 'deps_cache_save');
    assert.ok(restore < stepIndex(rootAction, 'veracode_sca'));
    assert.ok(restore < stepIndex(rootAction, 'prepare_scan_file'));
    assert.ok(stepIndex(rootAction, 'upload_and_scan') < save);
    assert.ok(save < stepIndex(rootAction, 'policy_decision'));

    const restoreBlock = stepBlock(rootAction, 'deps_cache');
    assert.match(restoreBlock, /mode: restore/);
    assert.match(restoreBlock, /inputs\.enable_sca == 'true' \|\| inputs\.enable_auto_packager == 'true'/);
    const saveBlock = stepBlock(rootAction, 'deps_cache_save');
    assert.match(saveBlock, /if: always\(\)/, 'salva mesmo quando um scan bloqueia a esteira');
    assert.match(saveBlock, /mode: save/);
    for (const output of ['key', 'cache_hit', 'settings_created']) {
        assert.match(saveBlock, new RegExp(`${output}: \\$\\{\\{ steps\\.deps_cache\\.outputs\\.${output} \\}\\}`));
    }
});

test('cache de ferramentas é salvo logo após o download (não depende do job terminar com sucesso)', () => {
    const toolchain = read('internal/toolchain/action.yml');
    assert.doesNotMatch(toolchain, /uses: actions\/cache@/, 'actions/cache com post-save só salva em job bem-sucedido');
    for (const tool of ['pipeline', 'cli', 'sca']) {
        const restore = toolchain.indexOf(`id: restore_${tool}`);
        const fetch = toolchain.indexOf('id: fetch');
        const save = toolchain.indexOf(`steps.fetch.outputs.${tool}_fetched == 'true' && steps.restore_${tool}.outputs.cache-hit != 'true'`);
        const shims = toolchain.indexOf('id: shims');
        assert.ok(restore !== -1 && restore < fetch, tool);
        assert.ok(save > fetch && save < shims, tool);
    }
});

test('actions de terceiros novas estão pinadas por SHA', () => {
    for (const rel of ['internal/toolchain/action.yml', 'internal/dependency-cache/action.yml', 'internal/auto-packager/action.yml']) {
        for (const line of read(rel).split('\n').filter(l => /^\s+uses:/.test(l))) {
            assert.match(line, /uses: [\w-]+\/[\w./-]+@[0-9a-f]{40} # v\d/, `${rel}: ${line.trim()}`);
        }
    }
});

test('scripts shell novos usam LF e o shim carrega o marcador de detecção', () => {
    for (const rel of ['internal/toolchain/toolchain.sh', 'internal/toolchain/curl-shim.sh', 'internal/veracode-upload-scan/prepare-java-wrapper.sh']) {
        assert.ok(!fs.readFileSync(path.join(root, rel), 'utf8').includes('\r'), `${rel} com CRLF`);
    }
    const shim = read('internal/toolchain/curl-shim.sh').split('\n');
    assert.equal(shim[0], '#!/usr/bin/env bash');
    assert.equal(shim[1], '# veracode-connect-shim');
    assert.match(read('internal/toolchain/toolchain.sh'), /SHIM_MARKER='# veracode-connect-shim'/);
    assert.match(read('internal/veracode-upload-scan/prepare-java-wrapper.sh'), /SHIM_MARKER='# veracode-connect-shim'/);
});
