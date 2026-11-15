// security-utils.js
// Tīras palīdzības funkcijas bez ārējām atkarībām (testējamas ar `node --test`).
// Pure helpers with no external dependencies.

/**
 * Daļēji maskē maka adresi žurnāliem (audita punkts S-09): 0x1234…abcd
 */
export function maskWallet(address) {
    const value = String(address || '');
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return value ? '[nederīga adrese]' : '';
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const INTERNAL_ERROR_PATTERNS = [
    /ECONN(?:RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i,
    /fetch failed|network error|getaddrinfo/i,
    /upstash|ERR_[A-Z_]{3,}|WRONGTYPE|NOSCRIPT|Lua script|redis\.call/i,
    /SERVER_ERROR|CALL_EXCEPTION|UNKNOWN_ERROR|NETWORK_ERROR|BAD_DATA|code=[A-Z_]+/i,
    /\bat\s+[\w.<>$]+\s+\(.*:\d+:\d+\)/,
    /\/(?:home|app|usr|var|opt|srv)\/[^\s]+\.(?:js|mjs|json)/i,
    /JSON\.parse|Unexpected token|is not a function|Cannot read propert/i
];

export const GENERIC_SERVER_ERROR = 'Servera kļūda; mēģiniet vēlreiz vēlāk.';

/** Vai kļūdas teksts izskatās pēc iekšējas tehniskas informācijas (S-06). */
export function isInternalErrorMessage(message) {
    const text = String(message || '');
    return INTERNAL_ERROR_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Klientam drošs kļūdas teksts. Lietotājam paredzētie ziņojumi (latviešu
 * teksti ar skaidru nozīmi) tiek saglabāti; tehniski iekšējie teksti tiek
 * aizstāti ar vispārīgu ziņojumu. Oriģināls paliek servera žurnālos.
 */
export function publicErrorMessage(message, maxLength = 300) {
    const text = String(message || '').trim();
    if (!text) return 'Nezināma kļūda.';
    if (isInternalErrorMessage(text)) return GENERIC_SERVER_ERROR;
    return text.substring(0, maxLength);
}

export const PURGE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Avārijas dzēšanas autorizācijas ziņojums, ko NFT īpašnieks paraksta ar maku
 * (audita punkts N-02). Ziņojums ir deterministisks, lai serveris varētu to
 * atjaunot un pārbaudīt pret saglabāto izaicinājumu.
 */
export function buildPurgeAuthorizationMessage({ repositoryId, tokenId, wallet, nonce, issuedAt, expiresAt, host }) {
    return [
        'PermRepo: avārijas backup stāvokļa dzēšana',
        `Repozitorija GitHub ID: ${repositoryId}`,
        `NFT token ID: ${tokenId}`,
        `Maks: ${String(wallet).toLowerCase()}`,
        `Domēns: ${host}`,
        `Nonce: ${nonce}`,
        `Izsniegts: ${new Date(issuedAt).toISOString()}`,
        `Derīgs līdz: ${new Date(expiresAt).toISOString()}`,
        'Šis paraksts neveic blockchain transakciju un nemaksā gāzi.'
    ].join('\n');
}

/**
 * Pārbauda saglabātā izaicinājuma atbilstību pieprasījumam.
 * @returns {{ok: boolean, reason: string}}
 */
export function validatePurgeChallenge(challenge, { repositoryId, tokenId, wallet, now = Date.now() }) {
    if (!challenge || typeof challenge !== 'object') return { ok: false, reason: 'missing-challenge' };
    if (String(challenge.repositoryId) !== String(repositoryId)) return { ok: false, reason: 'repository-mismatch' };
    if (String(challenge.tokenId) !== String(tokenId)) return { ok: false, reason: 'token-mismatch' };
    if (String(challenge.wallet).toLowerCase() !== String(wallet).toLowerCase()) return { ok: false, reason: 'wallet-mismatch' };
    if (!Number.isFinite(challenge.expiresAt) || now > challenge.expiresAt) return { ok: false, reason: 'expired' };
    if (typeof challenge.nonce !== 'string' || challenge.nonce.length < 16) return { ok: false, reason: 'invalid-nonce' };
    return { ok: true, reason: 'ok' };
}
