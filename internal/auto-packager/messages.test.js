const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { format, message, fail, errors, warnings, success } = require('./messages.js');

const cli = path.join(__dirname, 'messages.js');

test('format interpola placeholders e preserva chaves ausentes', () => {
    assert.equal(format('a={x} b={y}', { x: 1 }), 'a=1 b={y}');
    assert.equal(format('exit code {code}', { code: 42 }), 'exit code 42');
});

test('message resolve catálogo e interpola', () => {
    assert.equal(
        message('error', 'PACKAGE_FILE_MISSING', { file: 'app.zip' }),
        "Falha no Auto Packager: arquivo 'app.zip' não encontrado após o empacotamento."
    );
    assert.equal(
        message('warning', 'PACKAGE_EXIT_FALLBACK', { code: 1 }),
        "'veracode package' retornou exit code 1; tentando fallback."
    );
    assert.equal(
        message('success', 'SCAN_FILE_SET', { file: 'build.zip' }),
        'scan_file=build.zip (Auto Packager ignorado — arquivo já informado)'
    );
});

test('message falha em catálogo ou chave desconhecida', () => {
    assert.throws(() => message('info', 'CLI_NOT_FOUND'), /Catálogo desconhecido/);
    assert.throws(() => message('error', 'NAO_EXISTE'), /Mensagem desconhecida/);
});

test('fail devolve Error com texto do catálogo', () => {
    const err = fail('SCAN_FILE_NOT_FOUND', { file: 'missing.jar' });
    assert.equal(err.message, errors.SCAN_FILE_NOT_FOUND.replace('{file}', 'missing.jar'));
});

test('CLI imprime mensagem interpolada em stdout', () => {
    const result = cp.spawnSync(process.execPath, [
        cli,
        'warning',
        'PACKAGE_EXIT_FALLBACK',
        'code=127'
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, warnings.PACKAGE_EXIT_FALLBACK.replace('{code}', '127'));
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
