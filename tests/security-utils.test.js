import test from 'node:test';
import assert from 'node:assert/strict';
import {
    maskWallet, publicErrorMessage, isInternalErrorMessage, GENERIC_SERVER_ERROR,
    buildPurgeAuthorizationMessage, validatePurgeChallenge, PURGE_CHALLENGE_TTL_MS
} from '../security-utils.js';

test('maskWallet masks a valid address and does not echo invalid input', () => {
    assert.equal(maskWallet('0x1234567890abcdef1234567890abcdef12345678'), '0x1234…5678');
    assert.equal(maskWallet('not-an-address'), '[nederīga adrese]');
    assert.equal(maskWallet(''), '');
});

test('publicErrorMessage keeps user-facing Latvian messages', () => {
    const msg = 'Šim repozitorijam pašlaik notiek cita darbība vai avārijas dzēšana.';
    assert.equal(publicErrorMessage(msg), msg);
    assert.equal(publicErrorMessage(''), 'Nezināma kļūda.');
});

test('publicErrorMessage hides internal technical errors', () => {
    for (const internal of [
        'connect ECONNREFUSED 10.0.0.1:6379',
        'fetch failed',
        'Upstash request failed: WRONGTYPE Operation against a key',
        'could not decode result data (CALL_EXCEPTION)',
        'TypeError: x is not a function',
        'Error at handler (/app/server.js:123:45)'
    ]) {
        assert.equal(isInternalErrorMessage(internal), true, internal);
        assert.equal(publicErrorMessage(internal), GENERIC_SERVER_ERROR, internal);
    }
});

test('publicErrorMessage truncates long safe messages', () => {
    assert.equal(publicErrorMessage('a'.repeat(500)).length, 300);
});

test('purge authorization message is deterministic and binds repo, token, wallet and nonce', () => {
    const base = {
        repositoryId: '42', tokenId: '7', wallet: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
        nonce: 'n'.repeat(32), issuedAt: 1_700_000_000_000, expiresAt: 1_700_000_300_000, host: 'permrepo.app'
    };
    const a = buildPurgeAuthorizationMessage(base);
    assert.equal(a, buildPurgeAuthorizationMessage({ ...base }));
    for (const changed of [{ repositoryId: '43' }, { tokenId: '8' }, { nonce: 'm'.repeat(32) }, { host: 'evil.example' }]) {
        assert.notEqual(a, buildPurgeAuthorizationMessage({ ...base, ...changed }));
    }
    assert.match(a, /abcdefabcdefabcdefabcdefabcdefabcdefabcd/); // maks mazajiem burtiem
});

test('validatePurgeChallenge rejects mismatch, expiry and missing challenge', () => {
    const ch = { repositoryId: '42', tokenId: '7', wallet: '0xAbC', nonce: 'x'.repeat(32), expiresAt: 2000 };
    const req = { repositoryId: '42', tokenId: '7', wallet: '0xabc', now: 1000 };
    assert.deepEqual(validatePurgeChallenge(ch, req), { ok: true, reason: 'ok' });
    assert.equal(validatePurgeChallenge(null, req).reason, 'missing-challenge');
    assert.equal(validatePurgeChallenge(ch, { ...req, repositoryId: '43' }).reason, 'repository-mismatch');
    assert.equal(validatePurgeChallenge(ch, { ...req, tokenId: '8' }).reason, 'token-mismatch');
    assert.equal(validatePurgeChallenge(ch, { ...req, wallet: '0xdef' }).reason, 'wallet-mismatch');
    assert.equal(validatePurgeChallenge(ch, { ...req, now: 2001 }).reason, 'expired');
    assert.equal(validatePurgeChallenge({ ...ch, nonce: 'short' }, req).reason, 'invalid-nonce');
    assert.ok(PURGE_CHALLENGE_TTL_MS >= 60_000);
});
