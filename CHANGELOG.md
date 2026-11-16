# Changelog / Izmaiņu žurnāls

## v14 (audit v13 fixes / audita v13 labojumi)

### Fixed / Labots
- **N-01** `integration.test.js` I18/I20 updated for `withJobLock(jobId, req, fn)`; `npm test` is green.
- **N-03 / F-03 / F-04 "Sākt jauna backupa izveidi" can no longer trap the user**
  - repo→job index (`permrepo:repo-jobs:<repoId>`); optional legacy full SCAN (`JOB_INDEX_LEGACY_SCAN`);
  - orphan owner indexes are deleted, never block;
  - malformed records with unattributable owner → warning only; malformed records of the repo's own index → deleted;
  - `tokenId` mismatch / missing → warning only (ownership is decided by `githubRepositoryId`);
  - the caller's own owner pointer is always removed; `findJobByOwner` treats a corrupt job as absent;
  - owner-index TTL now follows the job's *remaining* TTL (was a full TTL on every read);
  - the cancellation fence is shortened to ≥120 s after a failed purge (was held for 15 min);
  - an unresolved on-chain transaction blocks the purge BEFORE anything is deleted, with job ID, tx hash and the time it becomes possible; a receipt that does not belong to the job, an invalid hash or an expired signature deadline all resolve (no permanent block).
- **N-02** Purge is authorised by the **current NFT owner's wallet signature** (server challenge, single-use, 5 min), `tokenId` is read from the chain (never from the client); GitHub `push`/`admin`, or the repository no longer exists on GitHub. ERC-1271 (smart wallets) accepted.
- **N-04 / F-06** `POST /api/verify-published-artifacts` runs **before** the wallet prompt (manifest + ZIP availability, 15 s timeouts, client retries with countdown); finalisation keeps the same check.
- **A5** Files whose previous ZIP is *definitively* missing on every gateway are re-uploaded; transient gateway errors never trigger mass re-upload; available ZIPs are cached.
- **A6** "Full re-backup" (re-baseline) is offered by a confirmation dialog when the previous manifest cannot be read. Explicit user confirmation required; the previous backup stays on-chain and in the manifest history.
- **N-05** `/api/config.txConfirmations`; the client waits for the same number of confirmations; the server answers `409 {retryable:true}` while confirmations are pending and the client retries.
- **N-06** `FallbackProvider(..., { quorum: 1 })`. **N-07** Base mainnet refuses `REQUIRE_ANS104_LOCATION=false`.
- **C-03 (server side)** `complete-backup` no longer requires `receipt.from/to`; the `BackupAdded` event is the proof (smart-wallet transactions go through a bundler).
- **S-01** JSON body limit 1 MB (10 MB only for `save-manifest-tx`); `urlencoded` removed. **S-06** `PUBLIC_RPC_URL`; internal error texts are hidden from clients (logged server-side). **S-09** wallet masked in logs. **S-11** unknown and foreign job IDs get the same answer.
- **K-01** The generated Master Key must be typed again before the user can continue. **K-04** A readable summary (repository, backup number) is shown before the signature prompt.
- **T-01/T-02/T-03** Behavioural tests with a fake Redis (14), security helpers (6) and new regression tests; CI builds the frontend and runs a non-blocking `npm audit`.

- **F-05 Merkle v2** (`MANIFEST_MERKLE_VERSION=2`): the on-chain root commits to every manifest entry (path, hash, ZIP id) and the deleted files; the server recomputes it. v1 manifests are always accepted. `shared/archive-merkle.js` is identical in backup, client and restore (golden-vector tests in both projects; the vector was also verified with an independent Python implementation).
- **F-07 GitHub App mode** (`GITHUB_AUTH_MODE=app`): no `repo` scope, user tokens are refreshed, repositories are listed through the app installations; default remains `oauth`.
- **S-04** Archived repositories can be backed up (`ALLOW_ARCHIVED_REPOSITORIES`, default true).
- **C-01/C-03/C-07 contracts v2** (`public/contracts/CHANGES-v2.md`): `revokeRepository`, ERC-1271 in `addBackup`, `subscribeWithMaxPrice` (client uses it when `SUBSCRIPTION_SUPPORTS_MAX_PRICE=true`). Not compiled in the build environment — compile and test in Remix.

- **Memory budget** now uses the container memory limit (cgroup / `process.constrainedMemory()`), not `os.totalmem()` (the host's RAM). Found in the first Render logs: the budget showed 19.7 GB. Override with `RESOURCE_TOTAL_MEMORY_BYTES`. Large repositories may now be refused on small instances — that is the intended protection against out-of-memory crashes.

### New environment variables
`PUBLIC_RPC_URL`, `MANIFEST_MERKLE_VERSION`, `GITHUB_AUTH_MODE`, `GITHUB_APP_SLUG`, `ALLOW_ARCHIVED_REPOSITORIES`, `SUBSCRIPTION_SUPPORTS_MAX_PRICE`, `MANIFEST_VERIFY_TIMEOUT_MS`, `MANIFEST_VERIFY_ATTEMPTS`, `ZIP_AVAILABILITY_CONCURRENCY`, `JOB_INDEX_LEGACY_SCAN`, `REPO_JOBS_INDEX_TTL_SECONDS`, `JOB_INDEX_TOUCH_INTERVAL_MS`.

### Upgrade notes / Pārejas piezīmes
1. No data migration is required. Old jobs get indexed when they are next read; keep `JOB_INDEX_LEGACY_SCAN=true`.
2. The "Sākt jauna backupa izveidi" button now asks the NFT owner for one wallet **signature** (no gas).
3. Mainnet = change only server variables (`CHAIN_ID`, `RPC_URL`, `PUBLIC_RPC_URL`, contract addresses, gateways, `REQUIRE_ANS104_LOCATION=true`, `TX_CONFIRMATIONS`).

### Not included / Nav iekļauts
- **Segmented encryption and AAD (S-02/K-02, "crypto v2")** — a manifest/ZIP format change. It was not shipped because a defect would make backups unrecoverable and it must first be validated with a real backup→restore round trip on testnet.
- **Organisation repositories (S-04)** — needs a product decision on who owns an organisation's NFT.
