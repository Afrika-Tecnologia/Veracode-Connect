const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('{steps}', { steps: 'SCA IaC' }), 'SCA IaC');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('error', 'STEPS_FAILED', { steps: 'SCA IaC' }),
        'Os seguintes steps falharam: SCA IaC'
    );
    assert.equal(
        message('warning', 'STEPS_WARNED', { steps: 'SCA' }),
        'Os seguintes steps geraram alertas: SCA'
    );
    assert.equal(
        message('success', 'ALL_PASSED'),
        'Verificação final concluída: nenhum módulo ativo falhou.'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'ALL_PASSED'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('STEPS_FAILED', { steps: 'SCA' });
    assert.equal(err.message, errors.STEPS_FAILED.replace('{steps}', 'SCA'));
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'warning',
        'STEPS_WARNED',
        'steps=SCA IaC'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, warnings.STEPS_WARNED.replace('{steps}', 'SCA IaC'));
});

test('CLI falha com chave desconhecida', () => {
    const result = cp.spawnSync(process.execPath, [cli, 'error', 'NAO_EXISTE'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Mensagem desconhecida/);
});

test('catálogos não têm chaves vazias', () => {
    for (const [name, catalog] of [['errors', errors], ['warnings', warnings], ['success', success]]) {
        for (const [key, value] of Object.entries(catalog)) {
            assert.equal(typeof value, 'string', `${name}.${key}`);
            assert.ok(value.length > 0, `${name}.${key} vazio`);
        }
    }
});
