'use strict';

/**
 * Gera (e remove) um ~/.m2/settings.xml temporário com mirror Maven.
 *
 * Nunca sobrescreve um settings.xml existente: o arquivo gerado leva um marcador
 * e só ele é removido no cleanup (evita deixar credenciais em runners self-hosted).
 *
 * Uso (composite):
 *   node maven-settings.js write    (MAVEN_MIRROR_URL, MAVEN_MIRROR_OF, MAVEN_MIRROR_USERNAME, MAVEN_MIRROR_PASSWORD)
 *   node maven-settings.js cleanup
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { message } = require('./messages');

const MARKER = '<!-- veracode-connect:generated -->';
const MIRROR_ID = 'veracode-connect-mirror';

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function settingsPath(home = os.homedir()) {
    return path.join(home, '.m2', 'settings.xml');
}

function buildSettings({ url, mirrorOf = 'central', username = '', password = '' }) {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        MARKER,
        '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"',
        '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
        '          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">'
    ];
    if (username && password) {
        lines.push(
            '  <servers>',
            '    <server>',
            `      <id>${MIRROR_ID}</id>`,
            `      <username>${xmlEscape(username)}</username>`,
            `      <password>${xmlEscape(password)}</password>`,
            '    </server>',
            '  </servers>'
        );
    }
    lines.push(
        '  <mirrors>',
        '    <mirror>',
        `      <id>${MIRROR_ID}</id>`,
        '      <name>Veracode Connect mirror</name>',
        `      <mirrorOf>${xmlEscape(mirrorOf || 'central')}</mirrorOf>`,
        `      <url>${xmlEscape(url)}</url>`,
        '    </mirror>',
        '  </mirrors>',
        '</settings>',
        ''
    );
    return lines.join('\n');
}

function writeSettings(options, home = os.homedir()) {
    const file = settingsPath(home);
    if (fs.existsSync(file)) {
        return { created: false, file, reason: 'exists' };
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buildSettings(options), { mode: 0o600 });
    return { created: true, file };
}

function cleanupSettings(home = os.homedir()) {
    const file = settingsPath(home);
    if (!fs.existsSync(file)) return { removed: false, file };
    if (!fs.readFileSync(file, 'utf8').includes(MARKER)) return { removed: false, file, reason: 'foreign' };
    fs.unlinkSync(file);
    return { removed: true, file };
}

function setOutput(name, value) {
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

function main(argv = process.argv.slice(2), env = process.env) {
    const command = argv[0];
    if (command === 'write') {
        const url = String(env.MAVEN_MIRROR_URL || '').trim();
        if (!url) {
            setOutput('settings_created', 'false');
            return 0;
        }
        const result = writeSettings({
            url,
            mirrorOf: String(env.MAVEN_MIRROR_OF || 'central').trim() || 'central',
            username: String(env.MAVEN_MIRROR_USERNAME || ''),
            password: String(env.MAVEN_MIRROR_PASSWORD || '')
        });
        if (result.created) {
            console.log(message('success', 'MAVEN_SETTINGS_WRITTEN', { file: result.file, url }));
        } else {
            console.log(`::warning::${message('warning', 'MAVEN_SETTINGS_EXISTS', { file: result.file })}`);
        }
        setOutput('settings_created', String(result.created));
        return 0;
    }
    if (command === 'cleanup') {
        const result = cleanupSettings();
        if (result.removed) {
            console.log(message('success', 'MAVEN_SETTINGS_REMOVED', { file: result.file }));
        }
        return 0;
    }
    console.error('Uso: node maven-settings.js <write|cleanup>');
    return 2;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = {
    MARKER,
    MIRROR_ID,
    buildSettings,
    cleanupSettings,
    main,
    settingsPath,
    writeSettings,
    xmlEscape
};
