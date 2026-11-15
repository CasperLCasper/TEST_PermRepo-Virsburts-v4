// Uzvedības testi ar viltotu Redis klientu (nevis avota teksta regex).
// Tie pārbauda, ka "Sākt jaunu backup" vienmēr var izkļūt no strupceļa (N-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    __setRedisClientForTests, deleteJobsForRepository, acquireRepositoryOperationLock,
    releaseRepositoryOperationLock, requestRepositoryCancellation, shortenRepositoryCancellation,
    isRepositoryCancellationRequested, getJob
} from '../accounting-redis.js';

const WALLET = '0x' + 'ab'.repeat(20);
const TX = '0x' + 'cd'.repeat(32);

function globToRegex(pattern) {
    return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

class FakeRedis {
    constructor() { this.kv = new Map(); this.sets = new Map(); this.ttls = new Map(); this.calls = { scan: 0 }; }
    async get(key) { return this.kv.has(key) ? this.kv.get(key) : null; }
    async set(key, value, opts = {}) {
        if (opts.nx && this.kv.has(key)) return null;
        this.kv.set(key, value);
        if (opts.ex) this.ttls.set(key, opts.ex); else this.ttls.delete(key);
        return 'OK';
    }
    async del(...keys) {
        let n = 0;
        for (const key of keys) {
            if (this.kv.delete(key)) n += 1;
            if (this.sets.delete(key)) n += 1;
            this.ttls.delete(key);
        }
        return n;
    }
    async mget(...keys) { return keys.map(key => (this.kv.has(key) ? this.kv.get(key) : null)); }
    async scan(cursor, { match = '*' } = {}) {
        this.calls.scan += 1;
        const re = globToRegex(match);
        return ['0', [...this.kv.keys()].filter(key => re.test(key))];
    }
    async smembers(key) { return [...(this.sets.get(key) || [])]; }
    async sadd(key, member) { const set = this.sets.get(key) || new Set(); set.add(member); this.sets.set(key, set); return 1; }
    async srem(key, member) { return (this.sets.get(key) || new Set()).delete(member) ? 1 : 0; }
    async expire(key, seconds) {
        if (!this.kv.has(key) && !this.sets.has(key)) return 0;
        this.ttls.set(key, seconds); return 1;
    }
    async ttl(key) {
        if (!this.kv.has(key)) return -2;
        return this.ttls.has(key) ? this.ttls.get(key) : -1;
    }
    // Minimāls Lua emulators tieši tiem skriptiem, ko izmanto slēdzenes.
    async eval(script, keys, args) {
        if (script.includes("'EXISTS', KEYS[2]")) {
            if (this.kv.has(keys[1])) return 0;
            if (this.kv.has(keys[0])) return 0;
            this.kv.set(keys[0], args[0]); this.ttls.set(keys[0], Number(args[1])); return 1;
        }
        if (script.includes('"EXPIRE"')) {
            if (this.kv.get(keys[0]) === args[0]) { this.ttls.set(keys[0], Number(args[1])); return 1; }
            return 0;
        }
        if (script.includes('"DEL"')) {
            if (this.kv.get(keys[0]) === args[0]) { this.kv.delete(keys[0]); return 1; }
            return 0;
        }
        throw new Error('FakeRedis.eval: nezināms skripts');
    }
}

function newJobId() { return crypto.randomUUID(); }
function makeJob(over = {}) {
    return {
        status: 'prepared', githubRepositoryId: '42', githubUserId: '1001',
        walletAddress: WALLET, tokenId: '7', version: 0, ...over
    };
}
async function seedJob(redis, job, { index = true, id = newJobId() } = {}) {
    await redis.set(`permrepo:job:${id}`, JSON.stringify(job));
    if (index) await redis.sadd(`permrepo:repo-jobs:${job.githubRepositoryId}`, id);
    await redis.set(`permrepo:job-owner:${job.githubUserId}:${job.githubRepositoryId}:${WALLET}`, id);
    return id;
}
async function setup(repoId = '42') {
    const redis = new FakeRedis();
    __setRedisClientForTests(redis);
    const token = await acquireRepositoryOperationLock(repoId);
    assert.ok(token, 'slēdzene jāiegūst');
    return { redis, token };
}

test('purge deletes all jobs of the repository (indexed and legacy) and nothing else', async () => {
    const { redis, token } = await setup();
    const a = await seedJob(redis, makeJob(), { index: true });
    const legacy = await seedJob(redis, makeJob({ githubUserId: '1002' }), { index: false });
    const other = await seedJob(redis, makeJob({ githubRepositoryId: '99' }));
    const result = await deleteJobsForRepository('42', '7', token);
    assert.equal(result.deletedCount, 2);
    assert.equal(await redis.get(`permrepo:job:${a}`), null);
    assert.equal(await redis.get(`permrepo:job:${legacy}`), null);
    assert.notEqual(await redis.get(`permrepo:job:${other}`), null, 'cita repo job jāpaliek');
    assert.deepEqual(await redis.smembers('permrepo:repo-jobs:42'), []);
});

test('a malformed record elsewhere does NOT block the purge (N-03)', async () => {
    const { redis, token } = await setup();
    await seedJob(redis, makeJob());
    const badId = newJobId();
    await redis.set(`permrepo:job:${badId}`, '{not-json');
    const result = await deleteJobsForRepository('42', '7', token);
    assert.equal(result.deletedCount, 1);
    assert.equal(result.unreadableCount, 1);
    assert.ok(result.warnings.length >= 1);
    assert.notEqual(await redis.get(`permrepo:job:${badId}`), null, 'nenosakāms ieraksts netiek dzēsts');
});

test('a malformed record that the index attributes to the repo IS deleted', async () => {
    const { redis, token } = await setup();
    const badId = newJobId();
    await redis.set(`permrepo:job:${badId}`, 'garbage');
    await redis.sadd('permrepo:repo-jobs:42', badId);
    const result = await deleteJobsForRepository('42', '7', token);
    assert.equal(result.corruptDeletedCount, 1);
    assert.equal(await redis.get(`permrepo:job:${badId}`), null);
});

test('an orphan owner index for the repository is removed and does not block (N-03)', async () => {
    const { redis, token } = await setup();
    const orphanKey = `permrepo:job-owner:1001:42:${WALLET}`;
    await redis.set(orphanKey, newJobId()); // job vairs neeksistē
    const result = await deleteJobsForRepository('42', '7', token);
    assert.equal(result.remainingCount, 0);
    assert.equal(await redis.get(orphanKey), null);
});

test('jobs without tokenId or with a different tokenId are still deleted (warning only)', async () => {
    const { redis, token } = await setup();
    await seedJob(redis, makeJob({ tokenId: undefined }), { index: true });
    await seedJob(redis, makeJob({ tokenId: '8', githubUserId: '1003' }), { index: true });
    const result = await deleteJobsForRepository('42', '7', token);
    assert.equal(result.deletedCount, 2);
    assert.equal(result.tokenMismatchCount, 1);
});

test('unresolved transaction blocks the purge BEFORE any deletion and names the job and tx', async () => {
    const { redis, token } = await setup();
    const a = await seedJob(redis, makeJob({ status: 'blockchain-finalizing', backupTxHash: TX }), { index: true });
    const b = await seedJob(redis, makeJob({ githubUserId: '1002' }), { index: true });
    await assert.rejects(
        () => deleteJobsForRepository('42', '7', token, async () => null),
        error => {
            assert.equal(error.code, 'PURGE_BLOCKED_UNRESOLVED_TX');
            assert.equal(error.unresolvedTransactions[0].jobId, a);
            assert.match(error.message, new RegExp(TX));
            return true;
        }
    );
    assert.notEqual(await redis.get(`permrepo:job:${a}`), null);
    assert.notEqual(await redis.get(`permrepo:job:${b}`), null, 'nekas netiek dzēsts');
});

test('a resolver that proves the transaction completed lets the purge proceed', async () => {
    const { redis, token } = await setup();
    const a = await seedJob(redis, makeJob({ status: 'failed', backupTxHash: TX }), { index: true });
    const result = await deleteJobsForRepository('42', '7', token, async job => ({ ...job, status: 'completed' }));
    assert.equal(result.deletedCount, 1);
    assert.equal(await redis.get(`permrepo:job:${a}`), null);
});

test('a throwing resolver keeps the job and reports the reason', async () => {
    const { redis, token } = await setup();
    await seedJob(redis, makeJob({ status: 'failed', backupTxHash: TX }), { index: true });
    await assert.rejects(
        () => deleteJobsForRepository('42', '7', token, async () => { throw new Error('RPC nav pieejams'); }),
        error => error.code === 'PURGE_BLOCKED_UNRESOLVED_TX' && /RPC nav pieejams/.test(error.message)
    );
});

test('purge aborts when the operation lock was lost', async () => {
    const { redis, token } = await setup();
    await seedJob(redis, makeJob());
    redis.kv.set('permrepo:repo-operation:42', 'someone-else');
    await assert.rejects(() => deleteJobsForRepository('42', '7', token), /lock tika zaudēts/);
});

test('with legacy scan disabled the purge uses the index only (no SCAN)', async () => {
    const { redis, token } = await setup();
    const id = await seedJob(redis, makeJob(), { index: true });
    const result = await deleteJobsForRepository('42', '7', token, null, { legacyScan: false });
    assert.equal(result.deletedCount, 1);
    assert.equal(redis.calls.scan, 0);
    assert.equal(await redis.get(`permrepo:job:${id}`), null);
});

test('operation lock: release needs the token (documents the v12 F-01 failure mode)', async () => {
    const { redis, token } = await setup();
    assert.equal(await releaseRepositoryOperationLock('42'), false, 'bez tokena slēdzene netiek atbrīvota');
    assert.equal(await acquireRepositoryOperationLock('42'), null, 'slēdzene joprojām aiznemta');
    assert.equal(await releaseRepositoryOperationLock('42', token), true);
    assert.ok(await acquireRepositoryOperationLock('42'), 'pēc atbrīvošanas ar tokenu slēdzene ir brīva');
    assert.ok(redis);
});

test('operation lock IDs are canonical: "0042" and 42 address the same lock', async () => {
    await setup();
    assert.equal(await acquireRepositoryOperationLock('0042'), null);
    assert.equal(await acquireRepositoryOperationLock(42), null);
});

test('cancellation fence blocks new operations and can be shortened instead of cleared', async () => {
    const redis = new FakeRedis();
    __setRedisClientForTests(redis);
    await requestRepositoryCancellation('42', 900);
    assert.equal(await acquireRepositoryOperationLock('42'), null, 'karogs bloķē jaunas operācijas');
    assert.equal(await shortenRepositoryCancellation('42', 120), true);
    assert.equal(redis.ttls.get('permrepo:repo-cancel:42'), 120);
    assert.equal(await isRepositoryCancellationRequested('42'), true, 'karogs netiek dzēsts, tikai saīsināts');
});

test('getJob refreshes the owner index with the remaining job TTL, not a full TTL (N-03)', async () => {
    const redis = new FakeRedis();
    __setRedisClientForTests(redis);
    const id = newJobId();
    await redis.set(`permrepo:job:${id}`, JSON.stringify(makeJob()), { ex: 100 });
    const job = await getJob(id);
    assert.equal(job.githubRepositoryId, '42');
    const ownerKey = `permrepo:job-owner:1001:42:${WALLET}`;
    assert.equal(redis.ttls.get(ownerKey), 100, 'owner indeksa TTL = atlikušais job TTL');
    assert.deepEqual(await redis.smembers('permrepo:repo-jobs:42'), [id], 'job tiek pievienots repo indeksam');
});
