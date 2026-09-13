'use strict';

/**
 * Remonta o Step Summary na ordem de exibição.
 * A execução dos scans permanece na ordem do orquestrador.
 *
 * GitHub só envia o diretório desta sub-action; o script fica aqui.
 *
 * Bash: node "$GITHUB_ACTION_PATH/assemble-summary.js" assemble [fragDir] [summaryFile]
 */

const fs = require('fs');
const path = require('path');

const FRAGMENT_DIR_NAME = 'veracode-connect-summary';

const FRAGMENT_ORDER = [
    'pipeline',
    'sca',
    'iac',
    'upload',
    'packager'
];

function fragmentDir(runnerTemp) {
    return path.join(runnerTemp, FRAGMENT_DIR_NAME);
}

function assembleFragments(dir) {
    if (!dir || !fs.existsSync(dir)) {
        return '';
    }
    const chunks = [];
    for (const name of FRAGMENT_ORDER) {
        const file = path.join(dir, `${name}.md`);
        if (!fs.existsSync(file)) {
            continue;
        }
        const text = fs.readFileSync(file, 'utf8');
        if (text.length > 0) {
            chunks.push(text);
        }
    }
    return chunks.join('');
}

function appendAssembledSummary(dir, summaryFile) {
    const text = assembleFragments(dir);
    if (text && summaryFile) {
        fs.appendFileSync(summaryFile, text);
    }
    return text;
}

if (require.main === module) {
    try {
        const [cmd, dirArg, summaryArg] = process.argv.slice(2);
        if (cmd !== 'assemble') {
            throw new Error('Uso: node assemble-summary.js assemble [fragDir] [summaryFile]');
        }
        const dir = dirArg || fragmentDir(process.env.RUNNER_TEMP || '');
        const summaryFile = summaryArg || process.env.GITHUB_STEP_SUMMARY || '';
        appendAssembledSummary(dir, summaryFile);
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    FRAGMENT_DIR_NAME,
    FRAGMENT_ORDER,
    fragmentDir,
    assembleFragments,
    appendAssembledSummary
};
