'use strict';

const fs = require('fs');
const path = require('path');
const { MARKER } = require('./messages');

function readJsonFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (_) {
        /* ignore parse errors */
    }
    return null;
}

function countPipelineFindings(jsonPath) {
    const data = readJsonFile(jsonPath);
    if (!data || !Array.isArray(data.findings)) {
        return null;
    }
    const findings = data.findings;
    return {
        veryHigh: findings.filter((f) => f.severity === 5).length,
        high: findings.filter((f) => f.severity === 4).length,
        medium: findings.filter((f) => f.severity === 3).length,
        low: findings.filter((f) => f.severity <= 2).length,
        total: findings.length
    };
}

function extractIacFindings(data) {
    if (!data) {
        return [];
    }
    if (Array.isArray(data.vulnerabilities?.matches)) {
        return data.vulnerabilities.matches;
    }
    if (Array.isArray(data.matches)) {
        return data.matches;
    }
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data.findings)) {
        return data.findings;
    }
    if (Array.isArray(data.results)) {
        return data.results;
    }
    return [];
}

function parseIacResults(workspace) {
    const filePath = path.join(workspace, 'iac-results', 'results.json');
    const data = readJsonFile(filePath);
    if (!data) {
        return null;
    }
    const findings = extractIacFindings(data);

    return {
        critical: findings.filter((f) => f.vulnerability?.severity === 'Critical').length,
        high: findings.filter((f) => f.vulnerability?.severity === 'High').length,
        medium: findings.filter((f) => f.vulnerability?.severity === 'Medium').length,
        low: findings.filter((f) => /^(Low|Negligible)$/i.test(f.vulnerability?.severity || '')).length,
        total: findings.length
    };
}

function parseScaLog(workspace) {
    const candidates = ['scaResults.txt', 'veracode_sca.log'];
    for (const name of candidates) {
        const filePath = path.join(workspace, name);
        if (!fs.existsSync(filePath)) {
            continue;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const pick = (re) => {
            const match = content.match(re);
            return match ? parseInt(match[1], 10) : 0;
        };
        const critical = pick(/Critical\s+Risk\s+Vulnerabilities\s+(\d+)/i);
        const high = pick(/High\s+Risk\s+Vulnerabilities\s+(\d+)/i);
        const medium = pick(/Medium\s+Risk\s+Vulnerabilities\s+(\d+)/i);
        const low = pick(/Low\s+Risk\s+Vulnerabilities\s+(\d+)/i);
        return {
            critical,
            high,
            medium,
            low,
            total: critical + high + medium + low,
            vulnLibs: pick(/Vulnerable\s+Libraries\s+(\d+)/i)
        };
    }
    return null;
}

function isActiveStatus(status) {
    return Boolean(status) && status !== 'skipped';
}

function isFailureStatus(status) {
    return status === 'failure' || status === 'failed' || (typeof status === 'string' && status.startsWith('scan_failed'));
}

function resolveBanner(failures, warnings) {
    if (failures.length > 0) {
        return `> ❌ **Falhas detectadas** — ${failures.join(', ')}`;
    }
    if (warnings.length > 0) {
        return `> ⚠️ **Warnings** — ${warnings.join(', ')}`;
    }
    return '> ✅ **Todos os scans ativos passaram**';
}

function collectModuleStatuses(inputs) {
    const failures = [];
    const warnings = [];

    const check = (name, status) => {
        if (!isActiveStatus(status)) {
            return;
        }
        if (isFailureStatus(status)) {
            failures.push(name);
        } else if (status === 'warning') {
            warnings.push(name);
        }
    };

    check('Validação', inputs.validate_outcome);
    check('SCA', inputs.sca_status);
    check('IaC/Secrets', inputs.iac_outcome);
    check('Portal Afrika Baseline', inputs.baseline_outcome);
    check('Repo Baseline', inputs.repo_baseline_outcome);
    check('Pipeline Scan', inputs.pipeline_outcome);
    check('Upload & Scan', inputs.upload_outcome);

    return { failures, warnings };
}

function pipelineSection(workspace, hasBaseline) {
    const resultsPath = path.join(workspace, 'results.json');
    const counts = countPipelineFindings(resultsPath);
    if (!counts) {
        return '### SAST (Pipeline Scan)\n\n> Arquivo `results.json` não encontrado.\n';
    }

    let section = '### SAST (Pipeline Scan)\n\n';
    section += '| Severidade | Qtd |\n|---|---|\n';
    section += `| Very High | ${counts.veryHigh} |\n`;
    section += `| High | ${counts.high} |\n`;
    section += `| Medium | ${counts.medium} |\n`;
    section += `| Low / Very Low | ${counts.low} |\n`;
    section += `| **Total** | **${counts.total}** |\n`;

    if (hasBaseline) {
        const filteredPath = path.join(workspace, 'filtered_results.json');
        const filtered = countPipelineFindings(filteredPath);
        if (filtered) {
            section += `\n> **Novas (pós-baseline):** ${filtered.total}\n`;
        }
    }

    return `${section}\n`;
}

function scaSection(workspace, scanUrl) {
    const counts = parseScaLog(workspace);
    let section = '### SCA\n\n';
    if (scanUrl) {
        section += `> [Relatório no Veracode](${scanUrl})\n\n`;
    }
    if (!counts) {
        section += '> Arquivo de resultados SCA não encontrado.\n';
        return `${section}\n`;
    }
    section += '| Severidade | Qtd |\n|---|---|\n';
    section += `| Critical | ${counts.critical} |\n`;
    section += `| High | ${counts.high} |\n`;
    section += `| Medium | ${counts.medium} |\n`;
    section += `| Low | ${counts.low} |\n`;
    section += `| **Total** | **${counts.total}** |\n`;
    if (counts.vulnLibs > 0) {
        section += `\n> Bibliotecas vulneráveis: ${counts.vulnLibs}\n`;
    }
    return `${section}\n`;
}

function iacSection(workspace) {
    const counts = parseIacResults(workspace);
    let section = '### IaC / Secrets\n\n';
    if (!counts) {
        section += '> Arquivo `iac-results/results.json` não encontrado.\n';
        return `${section}\n`;
    }
    section += '| Severidade | Qtd |\n|---|---|\n';
    section += `| Critical | ${counts.critical} |\n`;
    section += `| High | ${counts.high} |\n`;
    section += `| Medium | ${counts.medium} |\n`;
    section += `| Low / Negligible | ${counts.low} |\n`;
    section += `| **Total** | **${counts.total}** |\n`;
    return `${section}\n`;
}

function uploadSection(inputs) {
    const appName = inputs.upload_app_name || 'N/A';
    const sandbox = inputs.upload_enable_sandbox === 'true'
        ? (inputs.upload_sandbox_name || 'N/A')
        : 'app principal';
    const artifact = inputs.upload_artifact_name || 'N/A';
    const size = inputs.upload_artifact_size || 'N/A';
    const status = inputs.upload_outcome || 'N/A';
    const platformUrl = inputs.upload_platform_url || 'https://analysiscenter.veracode.com/';

    let section = '### Upload & Scan\n\n';
    section += '| Campo | Valor |\n|---|---|\n';
    section += `| App | \`${appName}\` |\n`;
    section += `| Sandbox | ${sandbox} |\n`;
    section += `| Artefato | \`${artifact}\` |\n`;
    section += `| Tamanho | ${size} |\n`;
    section += `| Status | ${status} |\n`;
    section += `| Plataforma | [Analysis Center](${platformUrl}) |\n`;
    return `${section}\n`;
}

function pipelineRan(inputs) {
    return isActiveStatus(inputs.pipeline_outcome)
        || isActiveStatus(inputs.baseline_outcome)
        || isActiveStatus(inputs.repo_baseline_outcome);
}

function hasBaseline(inputs) {
    return inputs.baseline_mode === 'portal_afrika' || inputs.baseline_mode === 'repo';
}

function buildCommentBody(options) {
    const {
        workspace,
        workflowRunUrl,
        inputs
    } = options;

    const { failures, warnings } = collectModuleStatuses(inputs);
    const lines = [
        MARKER,
        '',
        '## Veracode Connect',
        '',
        resolveBanner(failures, warnings),
        '',
        `[Workflow run](${workflowRunUrl})`,
        ''
    ];

    if (pipelineRan(inputs)) {
        lines.push(pipelineSection(workspace, hasBaseline(inputs)));
    }
    if (isActiveStatus(inputs.sca_status)) {
        lines.push(scaSection(workspace, inputs.sca_scan_url));
    }
    if (isActiveStatus(inputs.iac_outcome)) {
        lines.push(iacSection(workspace));
    }
    if (isActiveStatus(inputs.upload_outcome)) {
        lines.push(uploadSection(inputs));
    }

    lines.push('---');
    lines.push(`[Mais detalhes](${workflowRunUrl})`);
    lines.push('');

    return lines.join('\n');
}

function resolvePrNumber(event) {
    if (!event) {
        return null;
    }
    if (event.pull_request?.number) {
        return event.pull_request.number;
    }
    if (event.number && event.pull_request) {
        return event.number;
    }
    return null;
}

module.exports = {
    readJsonFile,
    countPipelineFindings,
    parseScaLog,
    parseIacResults,
    buildCommentBody,
    resolvePrNumber,
    isActiveStatus,
    isFailureStatus,
    collectModuleStatuses
};
