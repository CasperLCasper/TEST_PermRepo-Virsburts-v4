import test from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import { createArchiveMerkleV2 } from '../shared/archive-merkle.js';

const merkle = createArchiveMerkleV2(ethers);
const Z1 = 'A'.repeat(43);
const Z2 = 'B'.repeat(43);
const H1 = 'a1'.repeat(32);
const H2 = 'b2'.repeat(32);
const base = () => ({
    paths: { 'src/a.js': { id: Z1, hash: H1 }, 'README.md': { id: Z2, hash: H2 } },
    deletedFiles: ['old/x.txt']
});

test('v2 root is deterministic and independent of object key order', () => {
    const a = merkle.calculate(base());
    const reordered = { paths: { 'README.md': { id: Z2, hash: H2 }, 'src/a.js': { id: Z1, hash: H1 } }, deletedFiles: ['old/x.txt'] };
    assert.equal(a, merkle.calculate(reordered));
    assert.match(a, /^0x[0-9a-f]{64}$/);
});

test('v2 root commits to path, hash, ZIP id and deleted files (F-05)', () => {
    const root = merkle.calculate(base());
    const renamed = base(); renamed.paths['src/renamed.js'] = renamed.paths['src/a.js']; delete renamed.paths['src/a.js'];
    assert.notEqual(root, merkle.calculate(renamed), 'ceļa maiņa jāatklāj');
    const otherZip = base(); otherZip.paths['src/a.js'].id = Z2;
    assert.notEqual(root, merkle.calculate(otherZip), 'ZIP ID maiņa jāatklāj');
    const otherHash = base(); otherHash.paths['src/a.js'].hash = H2;
    assert.notEqual(root, merkle.calculate(otherHash), 'hash maiņa jāatklāj');
    const noDeleted = base(); noDeleted.deletedFiles = [];
    assert.notEqual(root, merkle.calculate(noDeleted), 'dzēsto failu maiņa jāatklāj');
    const swapped = base();
    [swapped.paths['src/a.js'], swapped.paths['README.md']] = [swapped.paths['README.md'], swapped.paths['src/a.js']];
    assert.notEqual(root, merkle.calculate(swapped), 'ceļu/satura apmaiņa jāatklāj (v1 to neatklāja)');
});

test('v2 odd-leaf duplication cannot be confused with a duplicated leaf (leaf count is committed)', () => {
    const three = { paths: { a: { id: Z1, hash: H1 }, b: { id: Z1, hash: H2 }, c: { id: Z2, hash: H1 } } };
    const withDeleted = { ...three, deletedFiles: [] };
    const four = { paths: { ...three.paths, d: { id: Z2, hash: H1 } } };
    assert.notEqual(merkle.calculate(withDeleted), merkle.calculate(four));
});

test('v2 empty manifest has a fixed domain-separated root; invalid input is rejected', () => {
    const empty = merkle.calculate({ paths: {} });
    assert.equal(empty, ethers.keccak256(ethers.toUtf8Bytes('PermRepo/merkle/v2/empty')));
    assert.throws(() => merkle.calculate({ paths: { '../x': { id: Z1, hash: H1 } } }), /Nederīgs ceļš/);
    assert.throws(() => merkle.calculate({ paths: { x: { id: 'short', hash: H1 } } }), /ZIP ID/);
    assert.throws(() => merkle.calculate({ paths: { x: { id: Z1, hash: 'zz' } } }), /hash/);
    assert.throws(() => merkle.calculate({}), /paths/);
    assert.throws(() => merkle.calculate({ paths: {}, deletedFiles: 'x' }), /deletedFiles/);
});

// ZELTA VEKTORS: tieši tas pats vektors ir restore projekta testos; abas realizācijas jādod vienāds rezultāts.
test('v2 golden vector (must match the restore project test)', () => {
    const root = merkle.calculate(base());
    assert.equal(root, GOLDEN);
});
const GOLDEN = '0x8e29e8ad3b4f11ea8d4b5229bec630abe2175d9745460b43a12f157c35b6646b';
