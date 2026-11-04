'use strict';

/**
 * Planeja o cache das ferramentas Veracode (CLI, Pipeline Scan, agente SCA).
 *
 * Decide quais ferramentas a execução precisa, onde ficam no runner, quais
 * chaves de cache usar e de onde baixar (oficial ou tools_mirror_url).
 *
 * Uso (composite): node "$GITHUB_ACTION_PATH/plan.js"  → grava em $GITHUB_OUTPUT
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { message } = require('./messages');

const REFRESH_VALUES = ['daily', 'weekly', 'monthly'];

function loadManifest(file = path.join(__dirname, 'tools.json')) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pad(value) {
    return String(value).padStart(2, '0');
}

/** Semana ISO-8601 (ex.: 2026-W45), sempre em UTC. */
function isoWeek(date) {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
    return `${day.getUTCFullYear()}-W${pad(week)}`;
}

/** Janela de renovação das ferramentas "LATEST" (Pipeline Scan e agente SCA). */
function refreshPeriod(refresh, date) {
    if (refresh === 'daily') {
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }
    if (refresh === 'monthly') {
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
    }
    return isoWeek(date);
}

function isTrue(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

/** Ferramentas exigidas pela combinação de inputs, espelhando as condições do action.yml raiz. */
function requiredTools(env) {
    const baselineMode = String(env.BASELINE_MODE || 'none').trim();
    const pipeline = isTrue(env.ENABLE_PIPELINESCAN) || baselineMode === 'repo' || baselineMode === 'portal_afrika';
    const packager = isTrue(env.ENABLE_AUTO_PACKAGER) && (pipeline || isTrue(env.ENABLE_UPLOAD_SCAN));
    return {
        pipeline,
        cli: isTrue(env.ENABLE_IAC) || packager,
        sca: isTrue(env.ENABLE_SCA)
    };
}

function isMusl(osReleaseFile = '/etc/os-release') {
    try {
        return /alpine/i.test(fs.readFileSync(osReleaseFile, 'utf8'));
    } catch {
        return false;
    }
}

function normalizeMirror(raw) {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!value) return { url: '', invalid: false };
    if (!/^https:\/\/[^\s'"`$\\]+$/.test(value)) return { url: '', invalid: true };
    return { url: value, invalid: false };
}

function fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key]);
}

function shortHash(value) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Monta o plano completo. Função pura: tudo que depende do ambiente entra por `env`/`opts`.
 */
function buildPlan(env, opts = {}) {
    const manifest = opts.manifest || loadManifest();
    const now = opts.now || new Date();
    const musl = opts.musl !== undefined ? opts.musl : isMusl();
    const warnings = [];

    const enabled = String(env.ENABLE_TOOLS_CACHE || 'true').trim().toLowerCase() !== 'false';
    const runnerOs = env.RUNNER_OS || '';
    const arch = env.RUNNER_ARCH || '';
    const root = path.posix.join(String(env.RUNNER_TEMP || '/tmp').replace(/\\/g, '/'), 'veracode-connect-tools');

    let refresh = String(env.TOOLS_CACHE_REFRESH || 'weekly').trim().toLowerCase();
    if (!REFRESH_VALUES.includes(refresh)) {
        warnings.push(message('warning', 'TOOLS_REFRESH_INVALID', { value: refresh }));
        refresh = 'weekly';
    }
    const period = refreshPeriod(refresh, now);

    const mirror = normalizeMirror(env.TOOLS_MIRROR_URL);
    if (mirror.invalid) {
        warnings.push(message('warning', 'TOOLS_MIRROR_INVALID', { value: String(env.TOOLS_MIRROR_URL).trim() }));
    }
    const source = (official, mirrorPath, vars = {}) => (
        mirror.url ? `${mirror.url}/${fill(mirrorPath, vars)}` : fill(official, vars)
    );
    const mirrorTag = mirror.url ? `-m${shortHash(mirror.url)}` : '';
    const prefix = `veracode-connect-tools-${manifest.cache_version}`;

    const need = requiredTools(env);
    const plan = {
        enabled: false,
        need_pipeline: false,
        need_cli: false,
        need_sca: false,
        refresh,
        period,
        root,
        mirror_url: mirror.url,
        warnings
    };

    if (!enabled) {
        plan.reason = 'disabled';
        return plan;
    }
    if (runnerOs !== 'Linux') {
        warnings.push(message('warning', 'TOOLS_PLATFORM_UNSUPPORTED', { os: runnerOs || 'desconhecido', arch: arch || 'desconhecida' }));
        plan.reason = 'platform';
        return plan;
    }

    const x64 = arch === 'X64';
    plan.enabled = true;

    if (need.pipeline) {
        plan.need_pipeline = true;
        plan.pipeline_dir = `${root}/pipeline-scan/${period}`;
        plan.pipeline_key = `${prefix}-pipeline-scan-${runnerOs}${mirrorTag}-${period}`;
        plan.pipeline_url = source(manifest.pipeline_scan.url, manifest.pipeline_scan.mirror_path);
        plan.pipeline_intercept_url = manifest.pipeline_scan.url;
    }

    if (need.cli) {
        const platform = 'linux_x86';
        const pin = manifest.veracode_cli.platforms[platform];
        if (!x64 || !pin) {
            warnings.push(message('warning', 'TOOL_PLATFORM_UNSUPPORTED', { tool: 'veracode-cli', reason: `arquitetura ${arch || 'desconhecida'}` }));
        } else {
            const version = manifest.veracode_cli.version;
            plan.need_cli = true;
            plan.cli_version = version;
            plan.cli_dir = `${root}/cli/${version}`;
            plan.cli_key = `${prefix}-cli-${runnerOs}-${arch}-${version}`;
            plan.cli_url = source(manifest.veracode_cli.url, manifest.veracode_cli.mirror_path, { version, platform });
            plan.cli_archive_sha256 = pin.archive_sha256;
            plan.cli_binary_sha256 = pin.binary_sha256;
            plan.cli_install_url = manifest.veracode_cli.install_url;
        }
    }

    if (need.sca) {
        if (!x64 || musl) {
            const reason = musl ? 'Linux musl/Alpine' : `arquitetura ${arch || 'desconhecida'}`;
            warnings.push(message('warning', 'TOOL_PLATFORM_UNSUPPORTED', { tool: 'sca-agent', reason }));
        } else {
            const agent = manifest.sca_agent;
            plan.need_sca = true;
            plan.sca_dir = `${root}/sca/${period}`;
            plan.sca_key = `${prefix}-sca-${runnerOs}-${arch}${mirrorTag}-${period}`;
            plan.sca_ci_url = source(agent.ci_url, agent.ci_mirror_path);
            plan.sca_version_url = source(agent.version_url, agent.version_mirror_path);
            plan.sca_archive_url = source(agent.archive_url, agent.archive_mirror_path, { version: '{version}' });
            plan.sca_ci_intercept_urls = [agent.ci_url, ...(agent.ci_alias_urls || [])].join(' ');
            plan.sca_version_intercept_url = agent.version_url;
            plan.sca_archive_intercept_url = agent.archive_url;
        }
    }

    if (!plan.need_pipeline && !plan.need_cli && !plan.need_sca) {
        plan.enabled = false;
        plan.reason = 'nothing';
    }
    return plan;
}

const OUTPUT_KEYS = [
    'enabled', 'need_pipeline', 'need_cli', 'need_sca', 'refresh', 'period', 'root', 'mirror_url',
    'pipeline_dir', 'pipeline_key', 'pipeline_url', 'pipeline_intercept_url',
    'cli_version', 'cli_dir', 'cli_key', 'cli_url', 'cli_archive_sha256', 'cli_binary_sha256', 'cli_install_url',
    'sca_dir', 'sca_key', 'sca_ci_url', 'sca_version_url', 'sca_archive_url',
    'sca_ci_intercept_urls', 'sca_version_intercept_url', 'sca_archive_intercept_url'
];

function toOutputLines(plan) {
    return OUTPUT_KEYS.map(key => `${key}=${plan[key] === undefined ? '' : plan[key]}`);
}

function main() {
    const plan = buildPlan(process.env);
    for (const warning of plan.warnings) {
        console.log(`::warning::${warning}`);
    }
    if (plan.reason === 'disabled') {
        console.log(message('success', 'TOOLS_DISABLED'));
    }
    console.log(message('success', 'TOOLS_PLAN', {
        pipeline: plan.need_pipeline,
        cli: plan.need_cli,
        sca: plan.need_sca,
        refresh: plan.refresh,
        period: plan.period
    }));
    const lines = toOutputLines(plan);
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    } else {
        console.log(lines.join('\n'));
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    REFRESH_VALUES,
    buildPlan,
    isoWeek,
    isMusl,
    loadManifest,
    normalizeMirror,
    refreshPeriod,
    requiredTools,
    toOutputLines
};
