// memory-limit.js
// Faktiskais atmiņas limits, kas pieejams procesam. Konteineros (Render, Docker) os.totalmem() atgriež
// HOSTA atmiņu, nevis instances limitu, tāpēc resursu kontrolieris bez šī aprēķina nepasargā no OOM.
import fs from 'node:fs';
import os from 'node:os';

const UNLIMITED_THRESHOLD = 1n << 60n; // cgroup v1 "bez limita" vērtība ir ļoti liels skaitlis

function parseLimit(text) {
    const value = String(text ?? '').trim();
    if (!value || value === 'max') return 0;
    try {
        const parsed = BigInt(value);
        if (parsed <= 0n || parsed >= UNLIMITED_THRESHOLD) return 0;
        return Number(parsed);
    } catch {
        return 0;
    }
}

/**
 * @returns {{ bytes: number, source: 'env'|'constrainedMemory'|'cgroup-v2'|'cgroup-v1'|'host' }}
 */
export function detectMemoryLimit({
    env = process.env,
    hostTotal = os.totalmem(),
    constrainedMemory = typeof process.constrainedMemory === 'function' ? () => process.constrainedMemory() : () => 0,
    readFile = path => fs.readFileSync(path, 'utf8')
} = {}) {
    const override = Number(env.RESOURCE_TOTAL_MEMORY_BYTES);
    if (Number.isFinite(override) && override > 0) return { bytes: Math.floor(override), source: 'env' };

    const candidates = [];
    try {
        const limit = Number(constrainedMemory());
        if (Number.isFinite(limit) && limit > 0) candidates.push({ bytes: limit, source: 'constrainedMemory' });
    } catch { /* nav pieejams */ }
    for (const [path, source] of [
        ['/sys/fs/cgroup/memory.max', 'cgroup-v2'],
        ['/sys/fs/cgroup/memory/memory.limit_in_bytes', 'cgroup-v1']
    ]) {
        try {
            const limit = parseLimit(readFile(path));
            if (limit > 0) candidates.push({ bytes: limit, source });
        } catch { /* fails nav pieejams */ }
    }

    const best = candidates
        .filter(candidate => candidate.bytes < hostTotal)
        .sort((a, b) => a.bytes - b.bytes)[0];
    return best || { bytes: hostTotal, source: 'host' };
}
