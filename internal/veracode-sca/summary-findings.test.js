'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    cvssBand,
    countFromJson,
    countFromText,
    buildSummary
} = require('./summary-findings.js');

test('cvssBand mapeia faixas NVD/Veracode', () => {
    assert.equal(cvssBand(9.1), 'critical');
    assert.equal(cvssBand(7.5), 'high');
    assert.equal(cvssBand(5), 'medium');
    assert.equal(cvssBand(2), 'low');
    assert.equal(cvssBand(0), 'very_low');
});

test('countFromJson conta vulnerabilidades e libs vulneráveis', () => {
    const data = {
        records: [{
            libraries: [
                { name: 'a', versions: [{ version: '1.0.0' }] },
                { name: 'b', versions: [{ version: '2.0.0' }] }
            ],
            graphs: [{ directs: [{}, {}] }],
            vulnerabilities: [
                {
                    cve: '2024-1',
                    title: 'crit',
                    cvss3Score: 9.8,
                    exploitability: { cveFull: 'CVE-2024-1' },
                    libraries: [{ _links: { ref: '/records/0/libraries/0/versions/0' } }]
                },
                {
                    cve: '2024-2',
                    title: 'high',
                    cvss3Score: 7.5,
                    libraries: [{ _links: { ref: '/records/0/libraries/1/versions/0' } }]
                },
                {
                    cve: '2024-3',
                    title: 'also-a',
                    cvssScore: 4.2,
                    libraries: [{ _links: { ref: '/records/0/libraries/0/versions/0' } }]
                }
            ]
        }]
    };
    const { counts, vulns } = countFromJson(data);
    assert.equal(counts.critical, 1);
    assert.equal(counts.high, 1);
    assert.equal(counts.medium, 1);
    assert.equal(counts.total, 3);
    assert.equal(counts.libraries, 2);
    assert.equal(counts.direct, 2);
    assert.equal(counts.vulnerable_libraries, 2);
    assert.equal(vulns[0].library, 'a@1.0.0');
});

test('countFromText lê o formato clássico do scaResults.txt', () => {
    const text = [
        'Critical Risk Vulnerabilities 2',
        'High Risk Vulnerabilities 1',
        'Medium Risk Vulnerabilities 0',
        'Low Risk Vulnerabilities 3',
        'Very Low Risk Vulnerabilities 0',
        'Total Libraries 10',
        'Direct Libraries 4',
        'Vulnerable Libraries 5'
    ].join('\n');
    const { counts } = countFromText(text);
    assert.equal(counts.critical, 2);
    assert.equal(counts.high, 1);
    assert.equal(counts.low, 3);
    assert.equal(counts.total, 6);
    assert.equal(counts.libraries, 10);
    assert.equal(counts.direct, 4);
    assert.equal(counts.vulnerable_libraries, 5);
});

test('buildSummary prefere JSON mesmo com create_issues (sem txt)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-sum-'));
    const jsonPath = path.join(dir, 'scaResults.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
        records: [{
            libraries: [{ name: 'lodash', versions: [{ version: '4.17.0' }] }],
            graphs: [],
            vulnerabilities: [{
                cve: '2021-23337',
                title: 'Command Injection',
                cvss3Score: 7.2,
                exploitability: { cveFull: 'CVE-2021-23337' },
                libraries: [{ _links: { ref: '/records/0/libraries/0/versions/0' } }]
            }]
        }]
    }));
    process.env.CREATE_ISSUES = 'true';
    const md = buildSummary({ jsonPath, txtPath: path.join(dir, 'missing.txt'), createIssues: true });
    assert.match(md, /#### Findings do SCA/);
    assert.match(md, /Very High \| 0/);
    assert.match(md, /High \| 1/);
    assert.match(md, /Total Vulnerabilidades\*\* \| \*\*1\*\*/);
    assert.match(md, /Issues GitHub/);
    assert.match(md, /CVE-2021-23337/);
    assert.match(md, /Findings do SCA \(1\)/);
});

test('buildSummary coloca Findings bloqueados por CVE acima de Findings do SCA', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sca-cve-sum-'));
    const jsonPath = path.join(dir, 'scaResults.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
        records: [{
            libraries: [
                { name: 'log4j-core', versions: [{ version: '2.14.1' }] },
                { name: 'lodash', versions: [{ version: '4.17.0' }] }
            ],
            graphs: [],
            vulnerabilities: [
                {
                    cve: '2021-44228',
                    title: 'Log4Shell',
                    cvss3Score: 10,
                    exploitability: { cveFull: 'CVE-2021-44228' },
                    libraries: [{ _links: { ref: '/records/0/libraries/0/versions/0' } }]
                },
                {
                    cve: '2021-23337',
                    title: 'Command Injection',
                    cvss3Score: 7.2,
                    exploitability: { cveFull: 'CVE-2021-23337' },
                    libraries: [{ _links: { ref: '/records/0/libraries/1/versions/0' } }]
                }
            ]
        }]
    }));
    const md = buildSummary({
        jsonPath,
        txtPath: path.join(dir, 'missing.txt'),
        createIssues: false,
        blocked: {
            requested: ['CVE-2021-44228', 'CVE-2021-45046'],
            matched: ['CVE-2021-44228'],
            missing: ['CVE-2021-45046'],
            findings: [{
                band: 'critical',
                score: 10,
                cve: 'CVE-2021-44228',
                title: 'Log4Shell',
                library: 'log4j-core@2.14.1'
            }]
        }
    });
    const blockedIdx = md.indexOf('#### Findings bloqueados por CVE (1)');
    const scaIdx = md.indexOf('#### Findings do SCA');
    assert.ok(blockedIdx >= 0);
    assert.ok(scaIdx > blockedIdx);
    assert.match(md, /CVE-2021-44228/);
    assert.match(md, /CVEs pedidos sem match: CVE-2021-45046/);
    assert.match(md, /Findings do SCA \(2\)/);
});
