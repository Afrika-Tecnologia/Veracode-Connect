'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const action = fs.readFileSync(path.join(__dirname, '../../action.yml'), 'utf8');
function forwardedStatus(step, input, context) {
    const block = action.split(`      id: ${step}`)[1].split('\n    - name:')[0];
    const expression = block.match(new RegExp(`^        ${input}: \\$\\{\\{(.*?)\\}\\}`, 'm'))[1];
    const resolved = expression.replace(/\b(?:inputs|steps)\.[\w.]+/g,
        key => JSON.stringify(context[key] ?? ''));
    return Function(`"use strict"; return (${resolved});`)();
}

for (const step of ['build_gate', 'pr_comment']) {
    for (const [input, scan] of [['sca_status', 'veracode_sca'], ['iac_outcome', 'veracode_iac'], ['upload_outcome', 'upload_and_scan']]) {
        test(`${step} shows a warning when ${scan} fails before exporting a result`, () => {
            assert.equal(forwardedStatus(step, input, { [`steps.${scan}.outcome`]: 'failure' }), 'warning');
        });
        test(`${step} preserves skipped ${scan} as skipped`, () => {
            assert.equal(forwardedStatus(step, input, { [`steps.${scan}.outcome`]: 'skipped' }), 'skipped');
        });
    }
    test(`${step} preserves a completed SCA policy failure`, () => {
        assert.equal(forwardedStatus(step, 'sca_status', {
            'steps.veracode_sca.outcome': 'failure', 'steps.veracode_sca.outputs.sca_status': 'failure'
        }), 'failure');
    });
}
