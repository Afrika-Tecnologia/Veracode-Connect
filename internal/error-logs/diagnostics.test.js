'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    capture,
    finalize
} = require('./diagnostics');

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-error-logs-'));
    return {
        dir,
        env: {
            RUNNER_TEMP: dir,
            VERACODE_CONNECT_ERROR_LOGS: 'true',
            VERACODE_CONNECT_LOG_ID: 'run-42-job-a',
            GITHUB_REPOSITORY: 'client/app',
            GITHUB_RUN_ID: '42',
            GITHUB_RUN_ATTEMPT: '2',
            GITHUB_JOB: 'scan',
            GITHUB_SHA: 'abc123'
        }
    };
}

test('disabled logging does not persist a failure', () => {
    const { dir, env } = fixture();
    try {
        capture({ ...env, VERACODE_CONNECT_ERROR_LOGS: 'false', VC_COMPONENT: 'auto_packager', VC_STEPS: 'prepare=failure' });
        assert.equal(fs.existsSync(path.join(dir, 'veracode-connect-error-logs')), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('failed steps are recorded without copying arbitrary environment or successful policy checks', () => {
    const { dir, env } = fixture();
    try {
        capture({
            ...env,
            VERACODE_API_KEY: 'must-not-appear',
            VC_COMPONENT: 'pipeline_only',
            VC_STEPS: 'pipeline_set=success\npolicy_check=success\nissues=failure'
        });
        const output = finalize(env);
        const report = JSON.parse(fs.readFileSync(output, 'utf8'));
        assert.deepEqual(report.incidents.map((item) => [item.component, item.stage, item.code]), [
            ['pipeline_only', 'issues', 'STEP_FAILED']
        ]);
        assert.equal(fs.readFileSync(output, 'utf8').includes('must-not-appear'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an unexpected policy-check step failure is a technical incident', () => {
    const { dir, env } = fixture();
    try {
        capture({ ...env, VC_COMPONENT: 'pipeline_only', VC_STEPS: 'policy_check=failure' });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.deepEqual(report.incidents, [
            { component: 'pipeline_only', stage: 'policy_check', code: 'STEP_FAILED' }
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('pipeline diagnostics include final scan errors but exclude policy and recovered retries', () => {
    const { dir, env } = fixture();
    try {
        const manifestPath = path.join(dir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify({ scans: [
            { slot: 1, artifact: 'app.jar', classification: 'policy', scan_status: 'SUCCESS' },
            { slot: 2, artifact: 'retry.jar', classification: 'sem_findings', scan_status: 'SUCCESS' },
            { slot: 3, artifact: 'api.jar', classification: 'scan_error', scan_status: 'MISSING' },
            { slot: 4, artifact: 'docs.zip', classification: 'unscannable', scan_status: 'UNSCANNABLE' }
        ] }));
        capture({ ...env, VC_COMPONENT: 'pipeline_scan_set', VC_SCAN_MANIFEST: manifestPath });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.deepEqual(report.incidents.map((item) => [item.stage, item.code]), [
            ['slot_3', 'SCAN_ERROR'],
            ['slot_4', 'UNSCANNABLE']
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a pipeline step failure remains visible when it produced valid scan results', () => {
    const { dir, env } = fixture();
    try {
        const manifestPath = path.join(dir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify({ scans: [
            { slot: 1, classification: 'sem_findings' },
            { slot: 2, classification: 'sem_findings' },
            { slot: 3, classification: 'policy' }
        ] }));
        capture({
            ...env,
            VC_COMPONENT: 'pipeline_scan_set',
            VC_SCAN_MANIFEST: manifestPath,
            VC_STEPS: [
                'merge=success',
                'slot_1=failure', 'retry_1=skipped',
                'slot_2=failure', 'retry_2=success',
                'slot_3=success', 'retry_3=skipped'
            ].join('\n')
        });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.deepEqual(report.incidents, [
            { component: 'pipeline_scan_set', stage: 'slot_1', code: 'STEP_FAILED' }
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('pipeline rate limit evidence is classified without copying the upstream response', () => {
    const { dir, env } = fixture();
    try {
        const manifestPath = path.join(dir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify({ scans: [
            { slot: 1, classification: 'scan_error', scan_status: 'MISSING' }
        ] }));
        fs.writeFileSync(path.join(dir, 'results-1.txt'), 'HTTP 429 Too Many Requests; token=do-not-copy');
        capture({ ...env, GITHUB_WORKSPACE: dir, VC_COMPONENT: 'pipeline_scan_set', VC_SCAN_MANIFEST: manifestPath });
        const output = fs.readFileSync(finalize(env), 'utf8');
        assert.equal(JSON.parse(output).incidents[0].code, 'RATE_LIMIT');
        assert.equal(output.includes('do-not-copy'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a failed merge does not report incidents from an older manifest', () => {
    const { dir, env } = fixture();
    try {
        const manifestPath = path.join(dir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify({ scans: [
            { slot: 1, classification: 'scan_error' }
        ] }));
        capture({
            ...env,
            VC_COMPONENT: 'pipeline_scan_set',
            VC_STEPS: 'merge=failure',
            VC_SCAN_MANIFEST: manifestPath
        });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.deepEqual(report.incidents, [
            { component: 'pipeline_scan_set', stage: 'merge', code: 'STEP_FAILED' }
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('reports left by an earlier run are ignored', () => {
    const { dir, env } = fixture();
    try {
        const scaPath = path.join(dir, 'scaResults.json');
        fs.writeFileSync(scaPath, JSON.stringify({ records: [{ libraries: [{ name: 'old' }] }] }));
        const oldTime = new Date(Date.now() - 60_000);
        fs.utimesSync(scaPath, oldTime, oldTime);
        const startMarker = path.join(dir, 'started');
        fs.writeFileSync(startMarker, '');
        capture({
            ...env,
            VERACODE_CONNECT_START_MARKER: startMarker,
            VC_COMPONENT: 'sca',
            VC_SCA_RESULT: scaPath
        });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.equal(report.incidents[0].code, 'RESULT_MISSING');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('missing scan results are technical even when the policy check succeeds', () => {
    const { dir, env } = fixture();
    try {
        const resultPath = path.join(dir, 'results.json');
        capture({
            ...env,
            VC_COMPONENT: 'pipeline_only',
            VC_STEPS: 'pipeline_set=success\npolicy_check=success',
            VC_SCAN_ERROR_COUNT: '0',
            VC_PIPELINE_RESULT: resultPath
        });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.deepEqual(report.incidents, [
            { component: 'pipeline_only', stage: 'results', code: 'RESULT_MISSING' }
        ]);
        const malformed = fixture();
        try {
            fs.writeFileSync(resultPath, JSON.stringify({ scan_status: 'SUCCESS' }));
            capture({
                ...malformed.env,
                VC_COMPONENT: 'pipeline_only',
                VC_STEPS: 'pipeline_set=success\npolicy_check=success',
                VC_SCAN_ERROR_COUNT: '0',
                VC_PIPELINE_RESULT: resultPath
            });
            const malformedReport = JSON.parse(fs.readFileSync(finalize(malformed.env), 'utf8'));
            assert.equal(malformedReport.incidents[0].code, 'RESULT_MISSING');
        } finally {
            fs.rmSync(malformed.dir, { recursive: true, force: true });
        }
        const other = fixture();
        try {
            fs.writeFileSync(resultPath, JSON.stringify({ findings: [{ severity: 'high' }] }));
            capture({
                ...other.env,
                VC_COMPONENT: 'pipeline_only',
                VC_STEPS: 'pipeline_set=success\npolicy_check=success',
                VC_SCAN_ERROR_COUNT: '0',
                VC_PIPELINE_RESULT: resultPath
            });
            assert.equal(finalize(other.env), null);
        } finally {
            fs.rmSync(other.dir, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('SCA with zero libraries is recorded, while zero vulnerabilities with libraries is not', () => {
    const { dir, env } = fixture();
    try {
        const resultPath = path.join(dir, 'scaResults.json');
        fs.writeFileSync(resultPath, JSON.stringify({ records: [{ libraries: [], vulnerabilities: [] }] }));
        capture({ ...env, VC_COMPONENT: 'sca', VC_SCA_RESULT: resultPath });
        let report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.equal(report.incidents[0].code, 'NO_LIBRARIES_ANALYZED');
        fs.writeFileSync(resultPath, JSON.stringify({ records: [{ libraries: [{ name: 'lib' }], vulnerabilities: [] }] }));
        const other = fixture();
        try {
            capture({ ...other.env, VC_COMPONENT: 'sca', VC_SCA_RESULT: resultPath });
            assert.equal(finalize(other.env), null);
        } finally {
            fs.rmSync(other.dir, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a valid SCA report larger than one megabyte is still inspected', () => {
    const { dir, env } = fixture();
    try {
        const resultPath = path.join(dir, 'scaResults.json');
        fs.writeFileSync(resultPath, JSON.stringify({
            records: [{ libraries: [{ name: 'large-report' }], vulnerabilities: [] }],
            padding: 'x'.repeat(1024 * 1024)
        }));
        capture({ ...env, VC_COMPONENT: 'sca', VC_SCA_RESULT: resultPath });
        assert.equal(finalize(env), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('SCA checks libraries across all records', () => {
    const { dir, env } = fixture();
    try {
        const resultPath = path.join(dir, 'scaResults.json');
        fs.writeFileSync(resultPath, JSON.stringify({ records: [
            { libraries: [] },
            { libraries: [{ name: 'dependency' }] }
        ] }));
        capture({ ...env, VC_COMPONENT: 'sca', VC_SCA_RESULT: resultPath });
        assert.equal(finalize(env), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('missing IaC result is recorded, but a valid empty findings result is not', () => {
    const { dir, env } = fixture();
    try {
        const resultPath = path.join(dir, 'iac-results.json');
        capture({ ...env, VC_COMPONENT: 'iac', VC_IAC_RESULT: resultPath });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.equal(report.incidents[0].code, 'RESULT_MISSING');
        const other = fixture();
        try {
            fs.writeFileSync(resultPath, JSON.stringify({ vulnerabilities: { matches: [] } }));
            capture({ ...other.env, VC_COMPONENT: 'iac', VC_IAC_RESULT: resultPath });
            assert.equal(finalize(other.env), null);
        } finally {
            fs.rmSync(other.dir, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('SCA text results with analyzed libraries do not create a false incident', () => {
    const { dir, env } = fixture();
    try {
        const textPath = path.join(dir, 'scaResults.txt');
        fs.writeFileSync(textPath, 'Total Libraries 3\nTotal Vulnerabilities 0\n');
        capture({ ...env, VC_COMPONENT: 'sca', VC_SCA_RESULT: path.join(dir, 'missing.json'), VC_SCA_TEXT: textPath });
        assert.equal(finalize(env), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('empty IaC JSON is not accepted as analysis output', () => {
    const { dir, env } = fixture();
    try {
        const resultPath = path.join(dir, 'iac-results.json');
        fs.writeFileSync(resultPath, '{}');
        capture({ ...env, VC_COMPONENT: 'iac', VC_IAC_RESULT: resultPath });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.equal(report.incidents[0].code, 'RESULT_MISSING');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('finalize deduplicates incidents and leaves no artifact for success', () => {
    const { dir, env } = fixture();
    try {
        assert.equal(finalize(env), null);
        capture({ ...env, VC_COMPONENT: 'runtime', VC_STEPS: 'bootstrap=failure' });
        capture({ ...env, VC_COMPONENT: 'runtime', VC_STEPS: 'bootstrap=failure' });
        const report = JSON.parse(fs.readFileSync(finalize(env), 'utf8'));
        assert.equal(report.schema_version, 1);
        assert.equal(report.repository, 'client/app');
        assert.equal(report.run_id, '42');
        assert.equal(report.run_attempt, '2');
        assert.equal(report.incidents.length, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('finalize drops untrusted incident fields and invalid codes', () => {
    const { dir, env } = fixture();
    try {
        const storagePath = path.join(dir, 'veracode-connect-error-logs', env.VERACODE_CONNECT_LOG_ID);
        fs.mkdirSync(storagePath, { recursive: true });
        fs.writeFileSync(path.join(storagePath, 'incidents.jsonl'), [
            JSON.stringify({ component: 'sca', stage: 'analysis', code: 'NO_LIBRARIES_ANALYZED', secret: 'must-not-appear' }),
            JSON.stringify({ component: 'sca', stage: 'analysis', code: 'SECRET_VALUE', message: 'must-not-appear' }),
            'invalid json'
        ].join('\n'));
        const report = fs.readFileSync(finalize(env), 'utf8');
        assert.deepEqual(JSON.parse(report).incidents, [
            { component: 'sca', stage: 'analysis', code: 'NO_LIBRARIES_ANALYZED' }
        ]);
        assert.equal(report.includes('must-not-appear'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
