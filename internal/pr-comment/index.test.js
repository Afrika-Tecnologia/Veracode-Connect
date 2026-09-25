'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { upsertPrComment } = require('./index');

test('atualiza o comentário único após a primeira página e remove só comentários extras da Veracode', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    const scaBody = '<br>![](https://www.veracode.com/sites/default/files/2022-04/logo_1.svg)<br><pre>Veracode SCA Scan finished';
    const iacBody = '<pre>Veracode Container/IaC/Sercets Scan Summary';
    const firstPage = [
        { id: 11, user: { login: 'github-actions[bot]' }, body: scaBody },
        { id: 12, user: { login: 'github-actions[bot]' }, body: iacBody },
        { id: 13, user: { login: 'reviewer' }, body: scaBody },
        { id: 14, user: { login: 'reviewer' }, body: '<!-- veracode-connect-pr-comment --> quoted in a review' },
        ...Array.from({ length: 96 }, (_, index) => ({
            id: 1000 + index,
            user: { login: 'reviewer' },
            body: `review ${index}`
        }))
    ];
    const secondPage = [
        { id: 20, user: { login: 'github-actions[bot]' }, body: '<!-- veracode-connect-pr-comment -->\nold' },
        { id: 21, user: { login: 'github-actions[bot]' }, body: iacBody }
    ];

    global.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', body: options.body });
        if ((options.method || 'GET') === 'GET') {
            return { ok: true, json: async () => url.includes('page=2') ? secondPage : firstPage };
        }
        return { ok: true };
    };

    try {
        const result = await upsertPrComment('test-token', 'org/repo', 7, '<!-- veracode-connect-pr-comment -->\nnew');
        assert.equal(result, 'updated');
        assert.deepEqual(calls.filter((call) => call.method === 'PATCH').map((call) => call.url), [
            'https://api.github.com/repos/org/repo/issues/comments/20'
        ]);
        assert.deepEqual(calls.filter((call) => call.method === 'DELETE').map((call) => call.url), [
            'https://api.github.com/repos/org/repo/issues/comments/11',
            'https://api.github.com/repos/org/repo/issues/comments/12',
            'https://api.github.com/repos/org/repo/issues/comments/21'
        ]);
        assert.equal(calls.some((call) => call.method === 'POST'), false);
    } finally {
        global.fetch = originalFetch;
    }
});

test('cria o comentário consolidado antes de remover comentários extras em um PR novo', async () => {
    const originalFetch = global.fetch;
    const methods = [];
    global.fetch = async (_url, options = {}) => {
        const method = options.method || 'GET';
        methods.push(method);
        if (method === 'GET') {
            return {
                ok: true,
                json: async () => [{
                    id: 31,
                    user: { login: 'github-actions[bot]' },
                    body: '<pre>Veracode Container/IaC/Sercets Scan Summary'
                }]
            };
        }
        return { ok: true };
    };

    try {
        const result = await upsertPrComment('test-token', 'org/repo', 8, '<!-- veracode-connect-pr-comment -->\nnew');
        assert.equal(result, 'created');
        assert.deepEqual(methods, ['GET', 'POST', 'DELETE']);
    } finally {
        global.fetch = originalFetch;
    }
});
