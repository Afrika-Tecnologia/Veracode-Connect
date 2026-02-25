const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');

const scriptPath = path.join(__dirname, 'index.js');

test('validate-inputs falha quando VKEY nao é fornecido', (t) => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: { VID: '123' }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /veracode_api_key é obrigatório\./);
});

test('validate-inputs falha quando VKEY não é hexa', (t) => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: { VID: '123', VKEY: 'abcxyz' }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /veracode_api_key deve ser uma string hexadecimal válida\./);
});

test('validate-inputs falha quando BU ativo e BU_NAME vazio', (t) => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            ENABLE_BU: 'true',
            ENABLE_UPLOAD: 'true'
        }
    });
    const stdout = result.stdout.toString();
    assert.match(stdout, /enable_business_unit=true requer veracode_business_unit \(nome da BU\)\./);
});

test('validate-inputs passa com credenciais corretas sem BU', (t) => {
    const result = cp.spawnSync(process.execPath, [scriptPath], {
        env: {
            VID: '123',
            VKEY: 'abc123bb',
            ENABLE_BU: 'false',
        }
    });
    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    assert.match(stdout, /Todos os inputs validados com sucesso\./, `Falhou. Stdout: ${stdout}, Stderr: ${stderr}`);
});
