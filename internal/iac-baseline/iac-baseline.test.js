'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {
    FINGERPRINT_VERSION,
    extractFindings,
    buildBaseline,
    compareFindings,
    buildDiff,
    renderComparedMarkdown,
    evaluate
} = require('./iac-baseline');

const SECRET_VALUE = 'AKIAIOSFODNN7EXAMPLE';

function vuln(id, name, version, severity, policy = 'not evaluated', location = '/package-lock.json') {
    return {
        artifact: { name, version, type: 'npm', purl: `pkg:npm/${name}@${version}`, locations: [{ path: location }] },
        vulnerability: { id, severity },
        relatedVulnerabilities: [{ id: `CVE-2024-${id.slice(-4)}` }],
        customerPolicyResult: { Status: policy }
    };
}

function config(id, target, severity, { policy = 'not evaluated', resource = '', start = 1, lines = ['x'] } = {}) {
    return {
        ID: id,
        Target: target,
        Title: `regra ${id}`,
        Severity: severity,
        Status: 'FAIL',
        CauseMetadata: {
            Resource: resource || undefined,
            StartLine: start,
            Code: { Lines: lines.map((content, i) => ({ Number: start + i, Content: content, IsCause: true })) }
        },
        customerPolicyResult: { Status: policy }
    };
}

function secret(rule, target, severity, policy = 'not evaluated', line = 3) {
    return {
        RuleID: rule,
        Target: target,
        Title: `segredo ${rule}`,
        Severity: severity,
        StartLine: line,
        Match: `aws_access_key_id = ${SECRET_VALUE.slice(0, 4)}****************`,
        Code: { Lines: [{ Content: `key = "${SECRET_VALUE}"` }] },
        customerPolicyResult: { Status: policy }
    };
}

function results({ matches = [], secrets = [], configs = [], passed = 'not evaluated' } = {}) {
    return { vulnerabilities: { matches }, secrets, configs, 'policy-passed': passed };
}

test('extractFindings normaliza as três categorias e ignora configs PASS', () => {
    const findings = extractFindings(results({
        matches: [vuln('GHSA-aaaa-0001', 'lodash', '4.17.20', 'HIGH', 'failed')],
        secrets: [secret('aws-access-key-id', 'main.tf', 'CRITICAL', 'failed')],
        configs: [config('DS-0002', 'Dockerfile', 'HIGH'), { ...config('DS-0001', 'Dockerfile', 'LOW'), Status: 'PASS' }]
    }));
    assert.deepEqual(findings.map((f) => [f.category, f.id, f.severity, f.policy]), [
        ['vulnerability', 'GHSA-aaaa-0001', 'high', 'failed'],
        ['secret', 'aws-access-key-id', 'critical', 'failed'],
        ['config', 'DS-0002', 'high', 'not evaluated']
    ]);
});

test('baseline e diff nunca carregam o segredo nem o trecho Code/Match', () => {
    const scan = results({ secrets: [secret('aws-access-key-id', 'main.tf', 'CRITICAL', 'failed')] });
    const doc = buildBaseline(scan, { repository: 'org/app', commit: 'abc' });
    const diff = buildDiff(buildBaseline(results()), scan, 'Pol');
    for (const text of [JSON.stringify(doc), JSON.stringify(diff), renderComparedMarkdown(diff)]) {
        assert.doesNotMatch(text, new RegExp(SECRET_VALUE));
        assert.doesNotMatch(text, /AKIA\*/);
        assert.doesNotMatch(text, /"(Code|Match)"/);
    }
    assert.equal(doc.fingerprint_version, FINGERPRINT_VERSION);
    assert.equal(doc.findings[0].policy, undefined);
});

test('scans idênticos não geram findings novos nem corrigidos', () => {
    const scan = results({
        matches: [vuln('GHSA-aaaa-0001', 'lodash', '4.17.20', 'HIGH')],
        configs: [config('AVD-AWS-0086', 'aws/s3.tf', 'HIGH', { resource: 'aws_s3_bucket.a' })]
    });
    const diff = buildDiff(buildBaseline(scan), scan, 'Pol');
    assert.deepEqual(diff.counts, { new_policy: 0, new_other: 0, backlog: 2, fixed: 0 });
});

test('deslocar linhas ou editar o recurso mantém a configuração no backlog', () => {
    const before = results({ configs: [
        config('AVD-AWS-0077', 'aws/db.tf', 'HIGH', { resource: 'aws_db_instance.default', start: 18, lines: ['resource "aws_db_instance" "default" {', '  engine = "mysql"'] }),
        config('DS-0002', 'Dockerfile', 'HIGH', { start: 1, lines: ['FROM node:latest'] })
    ] });
    const after = results({ configs: [
        config('AVD-AWS-0077', 'aws/db.tf', 'HIGH', { policy: 'failed', resource: 'aws_db_instance.default', start: 24, lines: ['resource "aws_db_instance" "default" {', '  # editado', '  engine = "mysql"'] }),
        config('DS-0002', 'Dockerfile', 'HIGH', { policy: 'failed', start: 7, lines: ['FROM node:latest'] })
    ] });
    const diff = buildDiff(buildBaseline(before), after, 'Pol');
    assert.deepEqual(diff.counts, { new_policy: 0, new_other: 0, backlog: 2, fixed: 0 });
});

test('subir a versão sem corrigir a vulnerabilidade continua sendo backlog', () => {
    const before = results({ matches: [vuln('GHSA-aaaa-0001', 'lodash', '4.17.20', 'HIGH')] });
    const after = results({ matches: [vuln('GHSA-aaaa-0001', 'lodash', '4.17.21', 'HIGH', 'failed')] });
    assert.deepEqual(buildDiff(buildBaseline(before), after, 'Pol').counts,
        { new_policy: 0, new_other: 0, backlog: 1, fixed: 0 });
});

test('repetições do mesmo fingerprint são casadas como multiconjunto', () => {
    const base = results({ matches: [
        vuln('GHSA-aaaa-0001', 'ajv', '6.12.6', 'MEDIUM'),
        vuln('GHSA-aaaa-0001', 'ajv', '8.6.3', 'MEDIUM')
    ] });
    const current = results({ matches: [
        vuln('GHSA-aaaa-0001', 'ajv', '6.12.6', 'MEDIUM'),
        vuln('GHSA-aaaa-0001', 'ajv', '8.6.3', 'MEDIUM'),
        vuln('GHSA-aaaa-0001', 'ajv', '8.11.0', 'MEDIUM', 'passed')
    ] });
    const diff = buildDiff(buildBaseline(base), current, 'Pol');
    assert.deepEqual(diff.counts, { new_policy: 0, new_other: 1, backlog: 2, fixed: 0 });
    assert.equal(diff.new_other[0].title, 'ajv@8.11.0');
});

test('classifica novos pela política e conta corrigidos sem listá-los', () => {
    const base = results({ configs: [
        config('AVD-AWS-0001', 'aws/a.tf', 'HIGH', { resource: 'r.a' }),
        config('AVD-AWS-0002', 'aws/b.tf', 'LOW', { resource: 'r.b' })
    ] });
    const current = results({
        configs: [config('AVD-AWS-0001', 'aws/a.tf', 'HIGH', { policy: 'failed', resource: 'r.a' })],
        secrets: [secret('github-pat', 'ci.yml', 'CRITICAL', 'failed')],
        matches: [vuln('GHSA-aaaa-0009', 'minimist', '1.2.0', 'MEDIUM', 'passed')]
    });
    const diff = buildDiff(buildBaseline(base), current, 'Pol');
    assert.deepEqual(diff.counts, { new_policy: 1, new_other: 1, backlog: 1, fixed: 1 });
    assert.equal(diff.new_policy[0].id, 'github-pat');
    assert.equal(diff.new_other[0].id, 'GHSA-aaaa-0009');
    assert.equal(diff.backlog[0].id, 'AVD-AWS-0001');
});

test('compareFindings prefere o casamento exato antes do casamento só por fingerprint', () => {
    const base = [{ fingerprint: 'f', detail: 'v1' }, { fingerprint: 'f', detail: 'v2' }];
    const current = [{ fingerprint: 'f', detail: 'v2', policy: 'failed' }, { fingerprint: 'f', detail: 'v3', policy: 'failed' }];
    const result = compareFindings(base, current);
    assert.equal(result.backlog.length, 2);
    assert.equal(result.fixedCount, 0);
});

test('o card mostra a política e os três grupos por severidade, sem veredito', () => {
    const diff = buildDiff(
        buildBaseline(results({ configs: [config('AVD-1', 'a.tf', 'LOW', { resource: 'r' })] })),
        results({
            configs: [config('AVD-1', 'a.tf', 'LOW', { resource: 'r' })],
            matches: [vuln('GHSA-aaaa-0001', 'lodash', '4.17.20', 'CRITICAL', 'failed')]
        }),
        'Container IaC Policy - N2'
    );
    const md = renderComparedMarkdown(diff);
    assert.match(md, /\*\*Política IaC:\*\* Container IaC Policy - N2\r?$/m);
    assert.doesNotMatch(md, /Passou|Não passou/);
    assert.match(md, /\| Grupo \| 🔴 Very High \| 🟠 High \| 🟡 Medium \| 🔵 Low \| ⚪ Very Low \| Total \|/);
    assert.match(md, /\| ❌ Novos \(afetam a política\) \| 1 \| 0 \| 0 \| 0 \| 0 \| \*\*1\*\* \|/);
    assert.match(md, /\| 🆕 Novos \(não afetam\) \| 0 \| 0 \| 0 \| 0 \| 0 \| \*\*0\*\* \|/);
    assert.match(md, /\| 📦 Backlog \| 0 \| 0 \| 0 \| 1 \| 0 \| \*\*1\*\* \|/);
    assert.match(md, /<summary>Backlog \(1\)<\/summary>/);
    assert.doesNotMatch(md, /<summary>Novos que não afetam a política/);
});

test('sem política nenhum finding novo afeta a política', () => {
    const diff = buildDiff(buildBaseline(results()), results({ matches: [vuln('GHSA-aaaa-0001', 'x', '1', 'HIGH')] }), 'none');
    assert.equal(diff.counts.new_policy, 0);
    assert.match(renderComparedMarkdown(diff), /\*\*Política IaC:\*\* nenhuma\r?$/m);
});

test('o detalhamento respeita o limite de linhas', () => {
    const matches = Array.from({ length: 5 }, (_, i) => vuln(`GHSA-aaaa-000${i}`, `p${i}`, '1', 'LOW'));
    const diff = buildDiff(buildBaseline(results()), results({ matches }), 'none');
    const md = renderComparedMarkdown(diff, { detailsLimit: 2 });
    assert.match(md, /Exibindo 2 de 5/);
});

function withTemp(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-iac-baseline-'));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('evaluate: leitura do baseline com falha vira error e não compara', () => withTemp((dir) => {
    const result = evaluate({ getOutcome: 'failure', hasBaseline: '', scanOk: 'true', diffPath: path.join(dir, 'd.json') });
    assert.equal(result.status, 'error');
    assert.equal(fs.existsSync(path.join(dir, 'd.json')), false);
}));

test('evaluate: sem baseline fica deferred', () => {
    assert.equal(evaluate({ getOutcome: 'success', hasBaseline: 'false', scanOk: 'true' }).status, 'deferred');
});

test('evaluate: scan inválido ou resultado que não é IaC vira error', () => withTemp((dir) => {
    const resultsPath = path.join(dir, 'results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({ findings: [] }));
    const base = { getOutcome: 'success', hasBaseline: 'true', resultsPath, baselinePath: resultsPath, diffPath: path.join(dir, 'd.json') };
    assert.equal(evaluate({ ...base, scanOk: 'false' }).status, 'error');
    assert.equal(evaluate({ ...base, scanOk: 'true' }).status, 'error');
}));

test('evaluate: fingerprint_version diferente não compara e pede para apagar o arquivo', () => withTemp((dir) => {
    const resultsPath = path.join(dir, 'results.json');
    const baselinePath = path.join(dir, 'iac-baseline.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results()));
    fs.writeFileSync(baselinePath, JSON.stringify({ ...buildBaseline(results()), fingerprint_version: 999 }));
    const logs = [];
    const original = console.log;
    console.log = (line) => logs.push(line);
    try {
        const result = evaluate({ getOutcome: 'success', hasBaseline: 'true', scanOk: 'true', resultsPath, baselinePath,
            diffPath: path.join(dir, 'd.json'), storeFile: 'org/app/iac-baseline.json' });
        assert.equal(result.status, 'error');
    } finally {
        console.log = original;
    }
    assert.match(logs.join('\n'), /apague org\/app\/iac-baseline\.json/);
}));

test('CLI build + evaluate gravam baseline, diff e outputs', () => withTemp((dir) => {
    const script = path.join(__dirname, 'iac-baseline.js');
    const before = path.join(dir, 'before.json');
    const after = path.join(dir, 'after.json');
    const baseline = path.join(dir, 'iac-baseline.json');
    const diffFile = path.join(dir, 'diff.json');
    const output = path.join(dir, 'output');
    fs.writeFileSync(before, JSON.stringify(results({ configs: [config('DS-0002', 'Dockerfile', 'HIGH')] })));
    fs.writeFileSync(after, JSON.stringify(results({ configs: [
        config('DS-0002', 'Dockerfile', 'HIGH', { policy: 'failed' }),
        config('DS-0026', 'Dockerfile', 'HIGH', { policy: 'failed' })
    ] })));
    const env = { ...process.env, GITHUB_OUTPUT: output, GITHUB_SHA: 'abc1234', SCAN_REPOSITORY: 'org/app' };

    let run = cp.spawnSync(process.execPath, [script, 'build', '--results', before, '--out', baseline], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(fs.readFileSync(baseline, 'utf8')).commit, 'abc1234');

    run = cp.spawnSync(process.execPath, [script, 'evaluate'], {
        env: { ...env, GET_OUTCOME: 'success', HAS_BASELINE: 'true', SCAN_OK: 'true', RESULTS_FILE: after,
            BASELINE_FILE: baseline, DIFF_FILE: diffFile, IAC_POLICY: 'Pol' },
        encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    const outputs = fs.readFileSync(output, 'utf8');
    assert.match(outputs, /^iac_baseline_status=compared$/m);
    assert.match(outputs, /^new_policy_count=1$/m);
    assert.match(outputs, /^backlog_count=1$/m);
    assert.equal(JSON.parse(fs.readFileSync(diffFile, 'utf8')).counts.new_policy, 1);

    run = cp.spawnSync(process.execPath, [script, 'summary-md', '--diff', diffFile], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Repo Baseline/);
}));

test('CLI build recusa resultado que não é IaC', () => withTemp((dir) => {
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, '{"findings":[]}');
    const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'iac-baseline.js'), 'build', '--results', file, '--out', path.join(dir, 'o.json')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Resultado IaC inválido/);
}));
