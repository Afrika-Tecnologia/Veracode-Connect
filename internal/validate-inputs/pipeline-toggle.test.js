'use strict';

/**
 * enable_pipelinescan é a condição definitiva do Pipeline Scan, em qualquer
 * baseline_mode. Avalia as condições `if:` reais do action.yml raiz e o
 * validate-inputs para todos os modos de baseline.
 */

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const rootAction = fs.readFileSync(path.join(root, 'action.yml'), 'utf8').replace(/\r\n/g, '\n');
const scriptPath = path.join(__dirname, 'index.js');

const MODES = ['none', 'repo', 'portal_afrika'];
const BOOLS = ['true', 'false'];
const PIPELINE_FLOWS = ['baseline_flow', 'repo_baseline_flow', 'pipeline_only'];

function stepCondition(id) {
    const index = rootAction.indexOf(`\n      id: ${id}\n`);
    assert.notEqual(index, -1, `step ${id} ausente`);
    const start = rootAction.lastIndexOf('\n    - name:', index);
    const next = rootAction.indexOf('\n    - name:', start + 1);
    const block = rootAction.slice(start, next === -1 ? undefined : next);
    const match = block.match(/\n      if: (.+)\n/);
    return match ? match[1] : 'true';
}

// As condições usadas aqui só têm strings, ==, !=, &&, || e parênteses.
function evaluate(condition, ctx) {
    const js = condition
        .replace(/\b(?:success|failure|always)\(\)/g, 'true')
        .replace(/\bsteps\.validate\.outputs\.baseline_mode\b/g, () => JSON.stringify(ctx.mode))
        .replace(/\binputs\.(\w+)\b/g, (_, name) => JSON.stringify(ctx.inputs[name] ?? ''))
        .replace(/!=/g, '!==')
        .replace(/([^!=])==/g, '$1===');
    assert.doesNotMatch(js, /\b(?:steps|inputs|github|env)\./, `contexto não suportado em: ${condition}`);
    return Boolean(Function(`"use strict"; return (${js});`)());
}

function* combinations() {
    for (const mode of MODES) {
        for (const pipeline of BOOLS) {
            for (const upload of BOOLS) {
                for (const sca of BOOLS) {
                    for (const iac of BOOLS) {
                        yield {
                            mode,
                            inputs: {
                                enable_pipelinescan: pipeline, enable_upload_scan: upload,
                                enable_sca: sca, enable_iac: iac, enable_tools_cache: 'true'
                            }
                        };
                    }
                }
            }
        }
    }
}

test('action.yml: enable_pipelinescan decide o Pipeline Scan em todos os modos de baseline', () => {
    const conditions = Object.fromEntries([
        ...PIPELINE_FLOWS, 'pipeline_disabled_status', 'prepare_scan_file', 'veracode_sca', 'veracode_iac', 'upload_and_scan'
    ].map(id => [id, stepCondition(id)]));

    for (const ctx of combinations()) {
        const { enable_pipelinescan: pipeline, enable_upload_scan: upload, enable_sca: sca, enable_iac: iac } = ctx.inputs;
        const label = `mode=${ctx.mode} pipeline=${pipeline} upload=${upload} sca=${sca} iac=${iac}`;
        const runs = id => evaluate(conditions[id], ctx);
        const flows = PIPELINE_FLOWS.filter(runs);

        if (pipeline === 'true') {
            const expected = { none: 'pipeline_only', repo: 'repo_baseline_flow', portal_afrika: 'baseline_flow' }[ctx.mode];
            assert.deepEqual(flows, [expected], label);
        } else {
            assert.deepEqual(flows, [], `nenhum Pipeline Scan com a flag desligada: ${label}`);
        }
        assert.equal(runs('pipeline_disabled_status'), pipeline !== 'true', label);
        assert.equal(runs('prepare_scan_file'), pipeline === 'true' || upload === 'true', label);
        // SCA, IaC e Upload & Scan não dependem do Pipeline Scan.
        assert.equal(runs('veracode_sca'), sca === 'true', label);
        assert.equal(runs('veracode_iac'), iac === 'true', label);
        assert.equal(runs('upload_and_scan'), upload === 'true', label);
    }
});

test('action.yml: baselines SCA e IaC continuam ligados ao baseline_mode, não ao Pipeline Scan', () => {
    for (const id of ['veracode_sca', 'veracode_iac']) {
        const start = rootAction.indexOf(`\n      id: ${id}\n`);
        const block = rootAction.slice(start, rootAction.indexOf('\n    - name:', start));
        assert.match(block, /enable_(?:sca|iac)_baseline: \$\{\{ steps\.validate\.outputs\.baseline_mode == 'repo' &&/);
        assert.doesNotMatch(block, /enable_pipelinescan/);
    }
});

function validate(env) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-validate-toggle-'));
    try {
        const output = path.join(dir, 'output');
        const result = cp.spawnSync(process.execPath, [scriptPath], {
            env: { VID: '123', VKEY: 'abc123bb', GITHUB_OUTPUT: output, ...env }, encoding: 'utf8'
        });
        const outputs = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
        return { status: result.status, stdout: result.stdout, outputs };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

for (const mode of MODES) {
    test(`validate-inputs: mode=${mode} com Pipeline Scan desligado não exige scan_file`, () => {
        // Sem baseline_org no modo repo: a validação falha antes de qualquer chamada de rede.
        const result = validate({ BASELINE_MODE: mode, ENABLE_PIPELINE: 'false', ENABLE_AUTO_PACKAGER: 'false' });
        assert.doesNotMatch(result.stdout, /scan_file é obrigatório/);
        assert.match(result.outputs, new RegExp(`baseline_mode=${mode}`));
        if (mode === 'repo') assert.match(result.stdout, /baseline_mode=repo requer baseline_org/);
        else assert.equal(result.status, 0, result.stdout);
    });

    test(`validate-inputs: mode=${mode} com Pipeline Scan ligado exige scan_file sem Auto Packager`, () => {
        const result = validate({
            BASELINE_MODE: mode, ENABLE_PIPELINE: 'true', ENABLE_AUTO_PACKAGER: 'false', PORTAL_AFRIKA_KEY: 'key'
        });
        assert.equal(result.status, 1);
        assert.match(result.stdout, /scan_file é obrigatório/);
    });

    test(`validate-inputs: mode=${mode} com Upload & Scan ainda exige scan_file sem Pipeline Scan`, () => {
        const result = validate({
            BASELINE_MODE: mode, ENABLE_PIPELINE: 'false', ENABLE_UPLOAD: 'true', ENABLE_AUTO_PACKAGER: 'false'
        });
        assert.equal(result.status, 1);
        assert.match(result.stdout, /scan_file é obrigatório/);
    });
}

test('validate-inputs: portal_afrika com Pipeline Scan desligado avisa e não exige a API key', () => {
    const result = validate({ BASELINE_MODE: 'portal_afrika', ENABLE_PIPELINE: 'false' });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /::warning::enable_pipelinescan=false: o Pipeline Scan não roda e baseline_mode=portal_afrika fica sem efeito/);
    assert.doesNotMatch(result.stdout, /portal_afrika_api_key/);
});

test('validate-inputs: portal_afrika com Pipeline Scan ligado continua exigindo a API key', () => {
    const result = validate({ BASELINE_MODE: 'portal_afrika', ENABLE_PIPELINE: 'true', SCAN_FILE: 'app.zip' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /baseline_mode=portal_afrika requer portal_afrika_api_key/);
});

test('validate-inputs: repo com Pipeline Scan desligado informa que vale só para SCA e IaC', () => {
    const result = validate({ BASELINE_MODE: 'repo', ENABLE_PIPELINE: 'false' });
    assert.match(result.stdout, /::notice::enable_pipelinescan=false: o Pipeline Scan não roda; baseline_mode=repo segue valendo só para os baselines SCA e IaC\/Secrets/);
});

test('validate-inputs: mode=none com Pipeline Scan desligado não emite aviso de baseline', () => {
    const result = validate({ BASELINE_MODE: 'none', ENABLE_PIPELINE: 'false' });
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /enable_pipelinescan=false/);
});
