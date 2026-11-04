'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    MARKER,
    MIRROR_ID,
    buildSettings,
    cleanupSettings,
    settingsPath,
    writeSettings,
    xmlEscape
} = require('./maven-settings.js');

const script = path.join(__dirname, 'maven-settings.js');

function tmpHome() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vc-m2-'));
}

function runCli(args, home, env = {}) {
    const output = path.join(home, 'github-output');
    fs.writeFileSync(output, '');
    const result = cp.spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, GITHUB_OUTPUT: output, ...env }
    });
    return { ...result, outputs: fs.readFileSync(output, 'utf8') };
}

test('buildSettings gera mirror de central por padrão, sem servidor sem credenciais', () => {
    const xml = buildSettings({ url: 'https://nexus.example.com/repository/maven-public/' });
    assert.ok(xml.includes(MARKER));
    assert.match(xml, /<mirrorOf>central<\/mirrorOf>/);
    assert.match(xml, /<url>https:\/\/nexus\.example\.com\/repository\/maven-public\/<\/url>/);
    assert.match(xml, new RegExp(`<id>${MIRROR_ID}</id>`));
    assert.doesNotMatch(xml, /<servers>/);
});

test('buildSettings inclui credenciais escapadas e mirrorOf customizado', () => {
    const xml = buildSettings({ url: 'https://n.example/x?a=1&b=2', mirrorOf: '*,!interno', username: 'ci<bot>', password: 'p&ss"\'' });
    assert.match(xml, /<mirrorOf>\*,!interno<\/mirrorOf>/);
    assert.match(xml, /<url>https:\/\/n\.example\/x\?a=1&amp;b=2<\/url>/);
    assert.match(xml, /<username>ci&lt;bot&gt;<\/username>/);
    assert.match(xml, /<password>p&amp;ss&quot;&apos;<\/password>/);
    assert.equal((xml.match(new RegExp(`<id>${MIRROR_ID}</id>`, 'g')) || []).length, 2, 'server.id == mirror.id');
});

test('xmlEscape cobre os cinco caracteres especiais', () => {
    assert.equal(xmlEscape(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
});

test('writeSettings não sobrescreve settings.xml do usuário e cleanup só remove o gerado', () => {
    const home = tmpHome();
    const file = settingsPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<settings>do usuário</settings>');

    assert.deepEqual(writeSettings({ url: 'https://n.example' }, home), { created: false, file, reason: 'exists' });
    assert.equal(fs.readFileSync(file, 'utf8'), '<settings>do usuário</settings>');
    assert.equal(cleanupSettings(home).removed, false);
    assert.ok(fs.existsSync(file));
});

test('writeSettings cria com permissão restrita e cleanup remove', () => {
    const home = tmpHome();
    const result = writeSettings({ url: 'https://n.example', username: 'u', password: 's3cr3t' }, home);
    assert.equal(result.created, true);
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(result.file).mode & 0o777, 0o600);
    }
    assert.equal(cleanupSettings(home).removed, true);
    assert.ok(!fs.existsSync(result.file));
    assert.equal(cleanupSettings(home).removed, false);
});

test('CLI write/cleanup grava settings_created e mensagens', () => {
    const home = tmpHome();
    const write = runCli(['write'], home, { MAVEN_MIRROR_URL: 'https://n.example/maven', MAVEN_MIRROR_OF: '' });
    assert.equal(write.status, 0, write.stderr);
    assert.match(write.outputs, /settings_created=true/);
    assert.match(write.stdout, /settings\.xml temporário criado/);
    assert.match(fs.readFileSync(settingsPath(home), 'utf8'), /<mirrorOf>central<\/mirrorOf>/);

    const again = runCli(['write'], home, { MAVEN_MIRROR_URL: 'https://n.example/maven' });
    assert.match(again.outputs, /settings_created=false/);
    assert.match(again.stdout, /::warning::maven_mirror_url ignorado/);

    const cleanup = runCli(['cleanup'], home);
    assert.equal(cleanup.status, 0);
    assert.match(cleanup.stdout, /removido/);
    assert.ok(!fs.existsSync(settingsPath(home)));
});

test('CLI write sem URL não cria arquivo', () => {
    const home = tmpHome();
    const result = runCli(['write'], home, { MAVEN_MIRROR_URL: '  ' });
    assert.equal(result.status, 0);
    assert.match(result.outputs, /settings_created=false/);
    assert.ok(!fs.existsSync(settingsPath(home)));
});

test('CLI rejeita comando desconhecido', () => {
    const result = runCli(['nope'], tmpHome());
    assert.equal(result.status, 2);
});
