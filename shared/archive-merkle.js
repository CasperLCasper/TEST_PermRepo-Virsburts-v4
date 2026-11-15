// shared/archive-merkle.js
// Merkle v2 (audita punkts F-05): sakne saista KATRU manifesta ierakstu — ceļu, faila hash un ZIP ID —
// kā arī dzēstos failus. v1 sakne (tikai faila hash) paliek nemainīta vecajiem backup.
//
// ŠIS FAILS IR KOPĒTS TRĪS VIETĀS (server: ./shared, klients: ./shared (vite), restore: ./archive-merkle.js).
// Saturam jābūt IDENTISKAM — to pārbauda testi ar vienādiem zelta vektoriem.
//
// Konstrukcija:
//   leaf(kind, ...fields)  = keccak256(0x00 || utf8(JSON.stringify([kind, ...fields])))
//   leaves                 = ['P', path, sha256hex, zipId] (sakārtoti pēc ceļa)  ++  ['D', deletedPath] (sakārtoti)
//   node(l, r)             = keccak256(0x01 || l || r)           (nepāra mezgls tiek dubultots)
//   root                   = keccak256(0x02 || uint64BE(leafCount) || treeRoot)
//   tukšs saraksts         = keccak256(utf8('PermRepo/merkle/v2/empty'))

const HEX64 = /^[0-9a-f]{64}$/;
const ARWEAVE_ID = /^[a-zA-Z0-9_-]{43}$/;

function assertSafePath(path, label) {
    if (typeof path !== 'string' || path.length < 1 || path.length > 1000 ||
        path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path) ||
        path.includes('\\') || path.split('/').some(part => part === '..' || part === '.') ||
        /[\x00-\x1f]/.test(path)) {
        throw new Error(`Nederīgs ceļš (${label}).`);
    }
}

function hexToBytes(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function concatBytes(...parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
}

function compareStrings(a, b) {
    return a < b ? -1 : (a > b ? 1 : 0);
}

export function createArchiveMerkleV2(ethers) {
    const { keccak256, toUtf8Bytes } = ethers;
    const hash = bytes => hexToBytes(keccak256(bytes));

    function leaf(kind, fields) {
        return hash(concatBytes(Uint8Array.of(0x00), toUtf8Bytes(JSON.stringify([kind, ...fields]))));
    }

    /** @param manifest objekts ar paths (ceļš → { id|zipId, hash }) un deletedFiles (ceļu masīvs) */
    function calculate(manifest) {
        const paths = manifest?.paths;
        if (!paths || typeof paths !== 'object') throw new Error('Manifestam nav paths.');
        const deleted = manifest.deletedFiles === undefined ? [] : manifest.deletedFiles;
        if (!Array.isArray(deleted)) throw new Error('deletedFiles nav masīvs.');

        const pathEntries = Object.keys(paths).sort(compareStrings).map(path => {
            assertSafePath(path, 'paths');
            const info = paths[path];
            const zipId = info?.id ?? info?.zipId;
            const fileHash = typeof info?.hash === 'string' ? info.hash.toLowerCase() : '';
            if (!HEX64.test(fileHash)) throw new Error(`Nederīgs hash ceļam ${path}.`);
            if (typeof zipId !== 'string' || !ARWEAVE_ID.test(zipId)) throw new Error(`Nederīgs ZIP ID ceļam ${path}.`);
            return leaf('P', [path, fileHash, zipId]);
        });
        const deletedEntries = [...deleted].map(String).sort(compareStrings).map(path => {
            assertSafePath(path, 'deletedFiles');
            return leaf('D', [path]);
        });

        const leaves = [...pathEntries, ...deletedEntries];
        if (leaves.length === 0) return keccak256(toUtf8Bytes('PermRepo/merkle/v2/empty'));

        let level = leaves;
        while (level.length > 1) {
            const next = [];
            for (let i = 0; i < level.length; i += 2) {
                const left = level[i];
                const right = level[i + 1] ?? left;
                next.push(hash(concatBytes(Uint8Array.of(0x01), left, right)));
            }
            level = next;
        }
        const count = new Uint8Array(8);
        new DataView(count.buffer).setBigUint64(0, BigInt(leaves.length), false);
        return keccak256(concatBytes(Uint8Array.of(0x02), count, level[0]));
    }

    return { calculate };
}
