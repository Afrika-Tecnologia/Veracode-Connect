'use strict';

const fs = require('fs');
const path = require('path');
const { MARKER } = require('./messages');
const {
    buildSummaryMarkdown,
    countBySeverity,
    loadFindings
} = require('./sast-findings');
const { extractMatches, countFromMatches, policyLabel, baselineNote } = require('../veracode-iac/summary-findings');
const { renderComparedMarkdown } = require('../iac-baseline/iac-baseline');
const {
    buildSummary: buildScaSummary,
    loadBlockedArtifact
} = require('../veracode-sca/summary-findings');
const { commentState } = require('../build-gate/job-summary');
const { accessLink } = require('../build-gate/access-link');

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

function parseIacResults(workspace) {
    const filePath = path.join(workspace, 'iac-results', 'results.json');
    const data = readJsonFile(filePath);
    if (!data) {
        return null;
    }
    const { counts } = countFromMatches(extractMatches(data));

    return {
        veryHigh: counts.critical,
        high: counts.high,
        medium: counts.medium,
        low: counts.low,
        veryLow: counts.very_low,
        total: counts.total
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

function statusIcon(status) {
    if (status === 'success' || status === 'passed') {
        return '✅ Success';
    }
    if (status === 'failure' || status === 'failed' || (typeof status === 'string' && status.startsWith('scan_failed'))) {
        return '❌ Failed';
    }
    if (status === 'warning' || status === 'error') {
        return '⚠️ Warning';
    }
    if (status === 'deferred') {
        return '⏸️ Sem baseline IaC (não bloqueia)';
    }
    if (status === 'skipped' || !status) {
        return '⏭️ Skipped';
    }
    return `❓ ${status}`;
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

function scaSection(workspace, inputs = {}) {
    const jsonPath = path.join(workspace, 'scaResults.json');
    const txtPath = path.join(workspace, 'scaResults.txt');
    const blockedPath = process.env.CVE_BLOCKED_PATH
        || (process.env.RUNNER_TEMP
            ? path.join(process.env.RUNNER_TEMP, 'veracode-connect-summary', 'sca-cve-blocked.json')
            : '');
    const blocked = loadBlockedArtifact(blockedPath);

    if (fs.existsSync(jsonPath) || blocked) {
        return buildScaSummary({
            jsonPath,
            txtPath,
            createIssues: false,
            blocked
        });
    }

    const counts = parseScaLog(workspace);
    const lines = ['### 🔍 Veracode SCA (Software Composition Analysis)', ''];
    if (!counts) {
        lines.push('> ⚠️ Nenhum artefato de resultado SCA encontrado.');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }
    lines.push('#### Findings do SCA');
    lines.push('');
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

function iacSection(workspace, inputs) {
    const baselineStatus = inputs.iac_baseline_status || 'not_used';
    if (baselineStatus === 'compared') {
        const diff = readJsonFile(path.join(workspace, 'iac-results', 'iac-baseline-diff.json'));
        if (diff) {
            // O comentário tem limite de tamanho: detalha só os novos, com teto de linhas.
            return renderComparedMarkdown(diff, { detailsLimit: 30, groups: ['new_policy', 'new_other'] });
        }
    }
    const counts = parseIacResults(workspace);
    const baselineActive = baselineStatus !== 'not_used';
    const lines = [baselineActive ? '### 🛡️ Veracode IaC / Secrets (Repo Baseline)' : '### 🛡️ Veracode IaC / Secrets', ''];
    const note = baselineActive ? baselineNote({ baselineStatus, canSeed: '' }) : '';
    if (note) {
        lines.push(note);
        lines.push('');
    }
    if (inputs.iac_policy_status && inputs.iac_policy_status !== 'not_used' && inputs.iac_policy_status !== 'skipped') {
        const policyName = String(inputs.iac_policy_name || '').replace(/[\r\n]/g, ' ').replace(/[`|]/g, '\\$&');
        lines.push(`**Política IaC${policyName ? ` (${policyName})` : ''}:** ${policyLabel(inputs.iac_policy_status)}`);
        lines.push('');
    }
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
    if (inputs.iac_policy_status && inputs.iac_policy_status !== 'not_used' && inputs.iac_policy_status !== 'skipped') {
        const policyName = String(inputs.iac_policy_name || '').replace(/[\r\n]/g, ' ').replace(/[`|]/g, '\\$&');
        rows.push(`| Política IaC${policyName ? ` — ${policyName}` : ''} | ${statusIcon(inputs.iac_policy_status)} |`);
    }
    appendIfActive('Pipeline Scan (Portal Afrika Baseline)', inputs.baseline_outcome);
    appendIfActive('Pipeline Scan (Repo Baseline)', inputs.repo_baseline_outcome);
    appendIfActive('Pipeline Scan', inputs.pipeline_outcome);
    appendIfActive('Upload & Scan', inputs.upload_outcome);

    const lines = [
        '---',
        '',
        '## 🛡️ Veracode Connect — Resumo Final',
        '',
        accessLink(inputs.veracode_url),
        ''
    ];
    if (rows.length > 0) {
        lines.push('| Scan | Status |');
        lines.push('|---|---|');
        lines.push(...rows);
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
        inputs: currentInputs,
        summaryContext
    } = options;
    const saved = commentState(summaryContext, currentInputs);
    const inputs = saved?.inputs || currentInputs;

    const lines = [MARKER, ''];

    if (pipelineRan(inputs)) {
        lines.push(saved ? saved.fragments.pipeline || `${pipelineHeading(inputs.baseline_mode)}\n\n> ⚠️ Resumo do Pipeline Scan indisponível.\n`
            : pipelineSection(workspace, inputs));
    }
    if (isActiveStatus(inputs.sca_status)) {
        lines.push(scaSection(workspace, inputs));
    }
    if (isActiveStatus(inputs.iac_outcome)) {
        lines.push(iacSection(workspace, inputs));
    }
    if (isActiveStatus(inputs.upload_outcome)) {
        lines.push(saved?.fragments.upload || uploadSection(inputs));
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
    severityCountTable
};
