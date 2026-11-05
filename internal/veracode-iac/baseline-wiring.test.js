'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const iac = read('veracode-iac', 'action.yml');
const root = fs.readFileSync(path.resolve(__dirname, '..', '..', 'action.yml'), 'utf8').replace(/\r\n/g, '\n');

function step(yml, id) {
    const block = yml.split(`      id: ${id}\n`)[1];
    assert.ok(block, `step ${id} ausente`);
    return block.split('\n    - name:')[0];
}

const order = (yml, ids) => ids.map((id) => yml.indexOf(`      id: ${id}\n`));

test('baseline IaC é lido fora do workspace, antes do scan', () => {
    assert.match(step(iac, 'get_iac_baseline'), /BASELINE_FILE: \$\{\{ runner\.temp \}\}\/veracode-connect-iac-baseline\/iac-baseline\.json/);
    const [get, scan] = order(iac, ['get_iac_baseline', 'iac_scan']);
    assert.ok(get > 0 && get < scan);
});

test('comparação, seed e status rodam depois da coleta e antes do upload e do summary', () => {
    const positions = order(iac, ['collect_results', 'iac_baseline', 'iac_seed_gate', 'iac_seed', 'baseline_state', 'status', 'upload_iac_artifact', 'iac_summary']);
    assert.ok(positions.every((p) => p > 0), positions.join(','));
    assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));
});

test('seed do baseline IaC só roda sem baseline (write-once) e usa o store compartilhado', () => {
    assert.match(step(iac, 'iac_seed_gate'), /if: always\(\) && steps\.iac_baseline\.outputs\.iac_baseline_status == 'deferred'/);
    const seed = step(iac, 'iac_seed');
    assert.match(seed, /steps\.iac_seed_gate\.outputs\.can_seed == 'true'/);
    assert.match(seed, /baseline-store\/cli\.js" put --kind iac/);
    assert.match(seed, /continue-on-error: true/);
});

test('o orquestrador só liga o baseline IaC no modo repo e repassa o estado ao resumo e ao PR', () => {
    assert.match(root, /enable_iac_baseline: \$\{\{ steps\.validate\.outputs\.baseline_mode == 'repo' && inputs\.enable_iac_baseline \|\| 'false' \}\}/);
    assert.equal((root.match(/iac_baseline_status: \$\{\{ steps\.veracode_iac\.outputs\.iac_baseline_status \|\| 'not_used' \}\}/g) || []).length, 2);
    assert.match(root, /enable_iac_baseline:\n    description: .*\n    required: false\n    default: 'false'/);
});
