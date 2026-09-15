'use strict';

const fs = require('fs');
const path = require('path');
const { MARKER } = require('./messages');
const {
    buildSummaryMarkdown,
    countBySeverity,
    loadFindings
} = require('./sast-findings');

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
    if (!fs.existsSync(jsonPath)) {
        return null;
    }
    return countBySeverity(loadFindings(jsonPath));
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
        veryHigh: findings.filter((f) => f.vulnerability?.severity === 'Critical').length,
        high: findings.filter((f) => f.vulnerability?.severity === 'High').length,
        medium: findings.filter((f) => f.vulnerability?.severity === 'Medium').length,
        low: findings.filter((f) => f.vulnerability?.severity === 'Low').length,
        veryLow: findings.filter((f) => f.vulnerability?.severity === 'Negligible').length,
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
        const low = pick(/(?<!Very )Low\s+Risk\s+Vulnerabilities\s+(\d+)/i);
        const libTotal = pick(/Total\s+Libraries\s+(\d+)/i);
        const directLibs = pick(/Direct\s+Libraries\s+(\d+)/i);
        const veryLow = pick(/Very Low\s+Risk\s+Vulnerabilities\s+(\d+)/i);
        return {
            veryHigh: critical,
            high,
            medium,
            low,
            veryLow,
            total: critical + high + medium + low + veryLow,
            vulnLibs: pick(/Vulnerable\s+Libraries\s+(\d+)/i),
            libTotal,
            directLibs,
            transitiveLibs: Math.max(0, libTotal - directLibs)
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

function statusIcon(status) {
    if (status === 'success') {
        return '✅ Success';
    }
    if (status === 'failure' || status === 'failed' || (typeof status === 'string' && status.startsWith('scan_failed'))) {
        return '❌ Failed';
    }
    if (status === 'warning') {
        return '⚠️ Warning';
    }
    if (status === 'skipped' || !status) {
        return '⏭️ Skipped';
    }
    return `❓ ${status}`;
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

function resolveBanner(inputs) {
    const { failures } = collectModuleStatuses(inputs);
    if (failures.length > 0) {
        if (inputs.fail_build === 'true') {
            return '> ❌ **Build travado** - Falhas detectadas';
        }
        return '> ⚠️ **Falhas detectadas** mas build **não travado** (`fail_build=false`)';
    }
    return '> ✅ **Todos os checks ativos passaram com sucesso**';
}

function severityCountTable(counts) {
    return [
        '| Severidade | Quantidade |',
        '|---|---|',
        `| 🔴 Very High | ${counts.veryHigh} |`,
        `| 🟠 High | ${counts.high} |`,
        `| 🟡 Medium | ${counts.medium} |`,
        `| 🔵 Low | ${counts.low} |`,
        `| ⚪ Very Low | ${counts.veryLow} |`,
        `| **Total** | **${counts.total}** |`
    ].join('\n');
}

function pipelineHeading(baselineMode) {
    if (baselineMode === 'portal_afrika') {
        return '### 🔬 Veracode Pipeline Scan (Portal Afrika Baseline)';
    }
    if (baselineMode === 'repo') {
        return '### 🔬 Veracode Pipeline Scan (Repo Baseline)';
    }
    return '### 🔬 Veracode Pipeline Scan';
}

function pipelineSection(workspace, inputs) {
    const heading = pipelineHeading(inputs.baseline_mode);
    const resultsPath = path.join(workspace, 'results.json');
    if (!fs.existsSync(resultsPath)) {
        return `${heading}\n\n> ⚠️ Arquivo results.json não encontrado.\n`;
    }

    const split = hasBaseline(inputs);
    const tables = buildSummaryMarkdown({
        resultsPath,
        baselinePath: path.join(workspace, 'baseline.json'),
        filteredPath: path.join(workspace, 'filtered_results.json'),
        split
    });
    return `${heading}\n\n${tables}`;
}

function scaSection(workspace) {
    const counts = parseScaLog(workspace);
    const lines = ['### 🔍 Veracode SCA (Software Composition Analysis)', ''];
    if (!counts) {
        lines.push('> ⚠️ Nenhum artefato de resultado SCA encontrado.');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }
    lines.push('| Severidade | Quantidade |');
    lines.push('|---|---|');
    lines.push(`| 🔴 Very High | ${counts.veryHigh} |`);
    lines.push(`| 🟠 High | ${counts.high} |`);
    lines.push(`| 🟡 Medium | ${counts.medium} |`);
    lines.push(`| 🔵 Low | ${counts.low} |`);
    lines.push(`| ⚪ Very Low | ${counts.veryLow} |`);
    lines.push(`| **Total Vulnerabilidades** | **${counts.total}** |`);
    lines.push(`| Bibliotecas vulneráveis | ${counts.vulnLibs} |`);
    if (counts.libTotal > 0) {
        lines.push(`| Total de bibliotecas analisadas | ${counts.libTotal} |`);
        lines.push(`| Bibliotecas diretas | ${counts.directLibs} |`);
        lines.push(`| Bibliotecas transitivas | ${counts.transitiveLibs} |`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function iacSection(workspace) {
    const counts = parseIacResults(workspace);
    const lines = ['### 🛡️ Veracode IaC / Secrets', ''];
    if (!counts) {
        lines.push('> ⚠️ Nenhum arquivo de resultado encontrado.');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }
    lines.push('| Severidade | Quantidade |');
    lines.push('|---|---|');
    lines.push(`| 🔴 Very High | ${counts.veryHigh} |`);
    lines.push(`| 🟠 High | ${counts.high} |`);
    lines.push(`| 🟡 Medium | ${counts.medium} |`);
    lines.push(`| 🔵 Low | ${counts.low} |`);
    lines.push(`| ⚪ Very Low | ${counts.veryLow} |`);
    lines.push(`| **Total Findings** | **${counts.total}** |`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function uploadSection(inputs) {
    const appName = inputs.upload_app_name || 'N/A';
    const artifact = inputs.upload_artifact_name || 'N/A';
    const size = inputs.upload_artifact_size || 'N/A';
    const status = inputs.upload_outcome || 'N/A';
    const lines = [
        '### 📤 Veracode Upload & Scan',
        '',
        '| Propriedade | Valor |',
        '|---|---|',
        `| App Name | \`${appName}\` |`
    ];
    if (inputs.upload_enable_sandbox === 'true') {
        lines.push(`| Sandbox | \`${inputs.upload_sandbox_name || 'N/A'}\` |`);
    } else {
        lines.push('| Sandbox | Desativado — app principal |');
    }
    lines.push(`| Artefato | \`${artifact}\` |`);
    lines.push(`| Tamanho | ${size} |`);
    lines.push(`| Status | ${status} |`);
    if (inputs.upload_platform_url) {
        lines.push(`| Plataforma | [Analysis Center](${inputs.upload_platform_url}) |`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function resumoFinalSection(inputs, workflowRunUrl) {
    const rows = [];
    const appendIfActive = (name, status) => {
        if (!isActiveStatus(status)) {
            return;
        }
        rows.push(`| ${name} | ${statusIcon(status)} |`);
    };
    appendIfActive('Veracode SCA', inputs.sca_status);
    appendIfActive('Veracode IaC/Secrets', inputs.iac_outcome);
    appendIfActive('Portal Afrika Baseline', inputs.baseline_outcome);
    appendIfActive('Repo Baseline', inputs.repo_baseline_outcome);
    appendIfActive('Pipeline Scan', inputs.pipeline_outcome);
    appendIfActive('Upload & Scan', inputs.upload_outcome);

    const lines = [
        '---',
        '',
        '## 🛡️ Veracode Connect — Resumo Final',
        '',
        resolveBanner(inputs),
        ''
    ];
    if (rows.length > 0) {
        lines.push('| Scan | Status |');
        lines.push('|---|---|');
        lines.push(...rows);
        lines.push('');
    }
    if (inputs.sca_scan_url) {
        lines.push(`> 🔗 [Relatório completo no Veracode](${inputs.sca_scan_url})`);
        lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push(`[Mais detalhes no Step Summary](${workflowRunUrl})`);
    lines.push('');
    lines.push('*Gerado por [Veracode Connect](https://github.com/Afrika-Tecnologia/Veracode-Connect)*');
    lines.push('');
    return lines.join('\n');
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

    const lines = [MARKER, ''];

    if (pipelineRan(inputs)) {
        lines.push(pipelineSection(workspace, inputs));
    }
    if (isActiveStatus(inputs.sca_status)) {
        lines.push(scaSection(workspace));
    }
    if (isActiveStatus(inputs.iac_outcome)) {
        lines.push(iacSection(workspace));
    }
    if (isActiveStatus(inputs.upload_outcome)) {
        lines.push(uploadSection(inputs));
    }

    lines.push(resumoFinalSection(inputs, workflowRunUrl));

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
    collectModuleStatuses,
    severityCountTable,
    resolveBanner
};
