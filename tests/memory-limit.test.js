import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMemoryLimit } from '../memory-limit.js';

const GB = 1024 ** 3;
const base = { env: {}, hostTotal: 32 * GB, constrainedMemory: () => 0, readFile: () => { throw new Error('nav faila'); } };

test('uses the host memory when no container limit exists', () => {
    assert.deepEqual(detectMemoryLimit(base), { bytes: 32 * GB, source: 'host' });
});

test('prefers the container limit over the host memory (Render case)', () => {
    assert.deepEqual(detectMemoryLimit({ ...base, constrainedMemory: () => 2 * GB }), { bytes: 2 * GB, source: 'constrainedMemory' });
});

test('reads cgroup v2 and v1 files and ignores "max"/unlimited', () => {
    const v2 = detectMemoryLimit({ ...base, readFile: path => (path.endsWith('memory.max') ? String(4 * GB) : (() => { throw new Error('x'); })()) });
    assert.deepEqual(v2, { bytes: 4 * GB, source: 'cgroup-v2' });
    const v1 = detectMemoryLimit({ ...base, readFile: path => (path.includes('limit_in_bytes') ? String(1 * GB) : (() => { throw new Error('x'); })()) });
    assert.deepEqual(v1, { bytes: 1 * GB, source: 'cgroup-v1' });
    const unlimited = detectMemoryLimit({ ...base, readFile: path => (path.endsWith('memory.max') ? 'max' : '9223372036854771712') });
    assert.equal(unlimited.source, 'host');
});

test('chooses the smallest valid limit and never exceeds the host memory', () => {
    const r = detectMemoryLimit({ ...base, constrainedMemory: () => 3 * GB, readFile: p => (p.endsWith('memory.max') ? String(2 * GB) : '') });
    assert.equal(r.bytes, 2 * GB);
    assert.equal(detectMemoryLimit({ ...base, hostTotal: 1 * GB, constrainedMemory: () => 4 * GB }).source, 'host');
});

test('RESOURCE_TOTAL_MEMORY_BYTES overrides detection', () => {
    assert.deepEqual(detectMemoryLimit({ ...base, env: { RESOURCE_TOTAL_MEMORY_BYTES: String(8 * GB) } }), { bytes: 8 * GB, source: 'env' });
});
