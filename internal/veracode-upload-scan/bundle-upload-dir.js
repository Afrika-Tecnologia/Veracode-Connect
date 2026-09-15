'use strict';

/**
 * Empacota os arquivos de um diretório plano num ZIP (STORE) para o
 * uploadandscan-action em sandbox: o upstream passa o diretório ao Java
 * sem concatenar o nome do arquivo.
 *
 * Bash: node bundle-upload-dir.js <dir> <out.zip>
 */

const fs = require('fs');
const path = require('path');
const { fail } = require('./messages');

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function localFileHeader(name, data, crc) {
    const nameBuf = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, nameBuf, data]);
}

function centralDirectoryEntry(name, data, crc, offset) {
    const nameBuf = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    return Buffer.concat([header, nameBuf]);
}

function endOfCentralDirectory(count, cdSize, cdOffset) {
    const header = Buffer.alloc(22);
    header.writeUInt32LE(0x06054b50, 0);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(count, 8);
    header.writeUInt16LE(count, 10);
    header.writeUInt32LE(cdSize, 12);
    header.writeUInt32LE(cdOffset, 16);
    header.writeUInt16LE(0, 20);
    return header;
}

function bundleDirectory(dir, outFile) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((ent) => ent.isFile())
        .map((ent) => ent.name)
        .sort();
    if (entries.length === 0) {
        throw fail('FILEPATH_EMPTY_DIR', { path: dir });
    }

    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const name of entries) {
        const data = fs.readFileSync(path.join(dir, name));
        const crc = crc32(data);
        const local = localFileHeader(name, data, crc);
        locals.push(local);
        centrals.push(centralDirectoryEntry(name, data, crc, offset));
        offset += local.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = endOfCentralDirectory(entries.length, cd.length, offset);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.concat([...locals, cd, eocd]));
    return { count: entries.length, names: entries, outFile };
}

if (require.main === module) {
    try {
        const [dir, outFile] = process.argv.slice(2);
        if (!dir || !outFile) {
            throw new Error('Uso: node bundle-upload-dir.js <dir> <out.zip>');
        }
        bundleDirectory(dir, outFile);
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}

module.exports = { bundleDirectory, crc32 };
