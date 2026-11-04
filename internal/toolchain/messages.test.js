'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
});

test('message resolve os catálogos do toolchain', () => {
    assert.equal(
        message('success', 'TOOL_REUSED', { tool: 'pipeline-scan', dir: '/tmp/x' }),
        'pipeline-scan: reutilizado do cache (/tmp/x) — 0 downloads'
    );
    assert.equal(
        message('warning', 'TOOL_FETCH_FAILED', { tool: 'veracode-cli', url: 'https://x' }),
        'veracode-cli: falha ao baixar https://x; a action oficial fará o download direto.'
    );
    assert.equal(
        message('success', 'SHIMS_READY', { dir: '/tmp/s', count: 5 }),
        'shims instalados em /tmp/s: 5 URL(s) servidas do cache local'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('nope', 'X'), /Catálogo desconhecido/);
    assert.throws(() => message('success', 'NOPE'), /Mensagem desconhecida/);
    assert.match(fail('SHIM_NEXT_MISSING', { bin: 'curl', dir: '/x' }).message, /nenhum curl real/);
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'warning', 'TOOL_VERIFY_FAILED', 'tool=sca-agent', 'detail=x=y'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'sca-agent: verificação de integridade falhou (x=y); a action oficial fará o download direto.');
});

test('CLI falha com chave desconhecida', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'success', 'NAO_EXISTE'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Mensagem desconhecida/);
});

test('catálogos não têm chaves vazias', () => {
    for (const catalog of [errors, warnings, success]) {
        for (const [key, value] of Object.entries(catalog)) {
            assert.ok(String(value).trim(), key);
        }
    }
});
