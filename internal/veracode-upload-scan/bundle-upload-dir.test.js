const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bundleDirectory, crc32 } = require('./bundle-upload-dir.js');

test('crc32 é estável para buffer conhecido', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('bundleDirectory grava um zip STORE com os nomes na raiz', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-upload-'));
    const out = path.join(dir, 'out.zip');
    const src = path.join(dir, 'files');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.zip'), 'aaa');
    fs.writeFileSync(path.join(src, 'b.zip'), 'bbbb');
    const result = bundleDirectory(src, out);
    assert.equal(result.count, 2);
    assert.deepEqual(result.names, ['a.zip', 'b.zip']);
    const zip = fs.readFileSync(out);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.ok(zip.includes(Buffer.from('a.zip')));
    assert.ok(zip.includes(Buffer.from('b.zip')));
    assert.ok(zip.includes(Buffer.from('aaa')));
    assert.ok(zip.includes(Buffer.from('bbbb')));
});
