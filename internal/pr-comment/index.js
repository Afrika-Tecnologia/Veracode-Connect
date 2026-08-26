'use strict';

const fs = require('fs');
const { message } = require('./messages');
const { buildCommentBody, resolvePrNumber, readJsonFile } = require('./build-comment');

const {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_SERVER_URL,
    GITHUB_WORKSPACE,
    GITHUB_EVENT_PATH,
    GITHUB_RUN_ID,
    FAIL_BUILD,
    SCA_STATUS,
    SCA_SCAN_URL,
    IAC_OUTCOME,
    PIPELINE_OUTCOME,
    BASELINE_OUTCOME,
    REPO_BASELINE_OUTCOME,
    UPLOAD_OUTCOME,
    VALIDATE_OUTCOME,
    BASELINE_MODE,
    UPLOAD_APP_NAME,
    UPLOAD_SANDBOX_NAME,
    UPLOAD_ENABLE_SANDBOX,
    UPLOAD_ARTIFACT_NAME,
    UPLOAD_ARTIFACT_SIZE,
    UPLOAD_PLATFORM_URL
} = process.env;

function githubApiBase() {
    const serverUrl = (GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    return serverUrl === 'https://github.com'
        ? 'https://api.github.com'
        : `${serverUrl}/api/v3`;
}

function workflowRunUrl() {
    const server = (GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    const repo = GITHUB_REPOSITORY;
    const runId = GITHUB_RUN_ID;
    return `${server}/${repo}/actions/runs/${runId}`;
}

function githubApiHeaders() {
    return {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
    };
}

async function upsertPrComment(token, repo, prNumber, body) {
    const apiBase = githubApiBase();
    const headers = githubApiHeaders();
    const marker = '<!-- veracode-connect-pr-comment -->';

    const listUrl = `${apiBase}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
    const listResp = await fetch(listUrl, { headers });
    if (!listResp.ok) {
        const detail = await listResp.text();
        throw new Error(message('error', 'LIST_COMMENTS_FAILED', {
            pr: prNumber,
            status: listResp.status,
            detail: detail.slice(0, 200)
        }));
    }

    const comments = await listResp.json();
    const existing = comments.find((c) => c.body && c.body.includes(marker));

    if (existing) {
        const patchUrl = `${apiBase}/repos/${repo}/issues/comments/${existing.id}`;
        const resp = await fetch(patchUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ body })
        });
        if (!resp.ok) {
            const detail = await resp.text();
            throw new Error(message('error', 'UPSERT_COMMENT_FAILED', {
                pr: prNumber,
                status: resp.status,
                detail: detail.slice(0, 200)
            }));
        }
        return 'updated';
    }

    const postUrl = `${apiBase}/repos/${repo}/issues/${prNumber}/comments`;
    const resp = await fetch(postUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body })
    });
    if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(message('error', 'UPSERT_COMMENT_FAILED', {
            pr: prNumber,
            status: resp.status,
            detail: detail.slice(0, 200)
        }));
    }
    return 'created';
}

async function main() {
    console.log('::group::Comentário no PR');

    if (!GITHUB_TOKEN) {
        console.log(`::warning::${message('warning', 'POST_FAILED', { detail: 'GITHUB_TOKEN ausente' })}`);
        console.log('::endgroup::');
        return;
    }

    const event = GITHUB_EVENT_PATH ? readJsonFile(GITHUB_EVENT_PATH) : null;
    const prNumber = resolvePrNumber(event);

    if (!prNumber) {
        console.log(message('success', 'SKIPPED', { reason: 'not_pr' }));
        console.log('::endgroup::');
        return;
    }

    if (!GITHUB_REPOSITORY) {
        console.log(`::warning::${message('warning', 'POST_FAILED', { detail: 'github.repository ausente' })}`);
        console.log('::endgroup::');
        return;
    }

    const workspace = GITHUB_WORKSPACE || process.cwd();
    const inputs = {
        fail_build: FAIL_BUILD,
        sca_status: SCA_STATUS || 'skipped',
        sca_scan_url: SCA_SCAN_URL || '',
        iac_outcome: IAC_OUTCOME || 'skipped',
        pipeline_outcome: PIPELINE_OUTCOME || 'skipped',
        baseline_outcome: BASELINE_OUTCOME || 'skipped',
        repo_baseline_outcome: REPO_BASELINE_OUTCOME || 'skipped',
        upload_outcome: UPLOAD_OUTCOME || 'skipped',
        validate_outcome: VALIDATE_OUTCOME || 'success',
        baseline_mode: BASELINE_MODE || 'none',
        upload_app_name: UPLOAD_APP_NAME || '',
        upload_sandbox_name: UPLOAD_SANDBOX_NAME || '',
        upload_enable_sandbox: UPLOAD_ENABLE_SANDBOX || 'false',
        upload_artifact_name: UPLOAD_ARTIFACT_NAME || '',
        upload_artifact_size: UPLOAD_ARTIFACT_SIZE || '',
        upload_platform_url: UPLOAD_PLATFORM_URL || 'https://analysiscenter.veracode.com/'
    };

    const body = buildCommentBody({
        workspace,
        workflowRunUrl: workflowRunUrl(),
        inputs
    });

    try {
        const action = await upsertPrComment(GITHUB_TOKEN, GITHUB_REPOSITORY, prNumber, body);
        const key = action === 'updated' ? 'UPDATED' : 'CREATED';
        console.log(message('success', key, { pr: prNumber }));
    } catch (err) {
        console.log(`::warning::${message('warning', 'POST_FAILED', { detail: err?.message || String(err) })}`);
    }

    console.log('::endgroup::');
}

if (require.main === module) {
    main().catch((err) => {
        console.log(`::warning::${message('warning', 'POST_FAILED', { detail: err?.message || String(err) })}`);
        console.log('::endgroup::');
        process.exit(0);
    });
}

module.exports = {
    githubApiBase,
    workflowRunUrl,
    upsertPrComment,
    main
};
