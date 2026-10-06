'use strict';

const DEFAULT_VERACODE_URL = 'https://analysiscenter.veracode.com/';

function accessLink(value) {
    let url = DEFAULT_VERACODE_URL;
    try {
        const input = String(value || DEFAULT_VERACODE_URL).trim();
        if (/[\r\n]/.test(input)) throw new Error('Multiline URL');
        const parsed = new URL(input);
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
        url = parsed.href.replace(/[()<>]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    } catch {
        // Preserve a usable login link when the supplied URL cannot be rendered safely.
    }
    return `Link de acesso para Veracode: [Acesse Aqui](${url})`;
}

if (require.main === module) process.stdout.write(`${accessLink(process.env.VERACODE_URL)}\n`);

module.exports = { accessLink };
