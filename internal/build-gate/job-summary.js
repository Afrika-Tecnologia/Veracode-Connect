'use strict';

const fs = require('fs');
const path = require('path');
const { FRAGMENT_ORDER, fragmentDir } = require('./assemble-summary');

const GROUPS = [
    { fragment: 'pipeline', statuses: ['pipeline_outcome', 'baseline_outcome', 'repo_baseline_outcome'],
        fields: ['pipeline_outcome', 'baseline_outcome', 'repo_baseline_outcome', 'baseline_mode'] },
    { fragment: 'sca', statuses: ['sca_status'], fields: ['sca_status', 'sca_scan_url'] },
    { fragment: 'iac', statuses: ['iac_outcome'], fields: ['iac_outcome', 'iac_policy_status', 'iac_policy_name'] },
    { fragment: 'upload', statuses: ['upload_outcome'], fields: ['upload_outcome'] }
];
const FIELDS = ['fail_build', 'validate_outcome', ...GROUPS.flatMap(group => group.fields)];

function active(status) {
    return Boolean(status) && status !== 'skipped' && status !== 'not_used';
}

function scope(context) {
    return JSON.stringify(['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_WORKSPACE']
        .map(key => context[key] || ''));
}

function statePath(context) {
    return path.join(fragmentDir(context.RUNNER_TEMP), 'job-state.json');
}

function readState(context) {
    if (!context?.RUNNER_TEMP) return null;
    try {
        const state = JSON.parse(fs.readFileSync(statePath(context), 'utf8'));
        return state.scope === scope(context) && state.inputs && state.fragments ? state : null;
    } catch (_) {
        return null;
    }
}

function writeState(context, state) {
    fs.mkdirSync(fragmentDir(context.RUNNER_TEMP), { recursive: true });
    fs.writeFileSync(statePath(context), `${JSON.stringify(state)}\n`);
}

function prepare(context) {
    const prior = readState(context);
    const state = prior || { scope: scope(context), inputs: {}, fragments: {} };
    const enabled = {
        pipeline: context.ENABLE_PIPELINESCAN === 'true' || ['repo', 'portal_afrika'].includes(context.BASELINE_MODE)
            ? 'true' : 'false',
        sca: context.ENABLE_SCA, iac: context.ENABLE_IAC,
        upload: context.ENABLE_UPLOAD_SCAN, packager: context.ENABLE_AUTO_PACKAGER
    };
    for (const name of FRAGMENT_ORDER) {
        if (!prior || enabled[name] === 'true') {
            fs.rmSync(path.join(fragmentDir(context.RUNNER_TEMP), `${name}.md`), { force: true });
            delete state.fragments[name];
        }
    }
    writeState(context, state);
}

function mergeInputs(previous, current) {
    const inputs = { ...current, ...previous };
    for (const group of GROUPS) {
        if (!group.statuses.some(key => active(current[key]))) continue;
        for (const key of group.fields) {
            inputs[key] = current[key] || (group.statuses.includes(key) ? 'skipped' : '');
        }
    }
    inputs.fail_build = previous.fail_build === 'true' || current.fail_build === 'true' ? 'true' : 'false';
    inputs.validate_outcome = previous.validate_outcome === 'failure' || current.validate_outcome === 'failure'
        ? 'failure' : current.validate_outcome || previous.validate_outcome || 'success';
    return inputs;
}

function consolidate(context) {
    const prior = readState(context) || { scope: scope(context), inputs: {}, fragments: {} };
    const current = Object.fromEntries(FIELDS.map(key => [key, context[key.toUpperCase()] || '']));
    const state = { scope: scope(context), inputs: mergeInputs(prior.inputs, current), fragments: { ...prior.fragments } };
    for (const group of GROUPS) {
        if (group.statuses.some(key => active(current[key]))) delete state.fragments[group.fragment];
    }
    for (const name of FRAGMENT_ORDER) {
        const file = path.join(fragmentDir(context.RUNNER_TEMP), `${name}.md`);
        if (fs.existsSync(file)) state.fragments[name] = fs.readFileSync(file, 'utf8');
    }
    writeState(context, state);
    return state;
}

function commentState(context, current) {
    const saved = readState(context);
    return saved ? { ...saved, inputs: mergeInputs(saved.inputs, current) } : null;
}

if (require.main === module) {
    try {
        const command = process.argv[2];
        if (command === 'prepare') prepare(process.env);
        else if (command === 'consolidate-env') {
            const state = consolidate(process.env);
            for (const key of FIELDS) process.stdout.write(`${key.toUpperCase()}\0${state.inputs[key] || ''}\0`);
        } else throw new Error('Uso: node job-summary.js prepare|consolidate-env');
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { commentState };
