# Security, authorization and DevOps re-audit — 2026-11-08

Scope: direct review of marketplace auth/refresh/role flows, global JWT guard,
staff permission guard, OTP implementation, account status guard, profile/session
controllers, CORS, logger, environment validation, Docker/Compose and CI. No live
credentials, database, cloud service or financial provider was accessed.

## Verified and repaired

| ID | Finding | Evidence / repair |
|---|---|---|
| SEC-01 | Revoked refresh tokens minted sibling sessions for 15 seconds | Removed replay grace that created untracked descendants; reuse revokes family and rejects. |
| SEC-02 | Logout/password reset left signed access tokens usable | Global marketplace JWT guard now requires a live, unexpired refresh row in the same user/family. Rotation keeps family continuity. |
| SEC-03 | Logout with an older cookie revoked only that row | Resolve token owner/family and revoke descendants; supplied user ownership is checked. |
| SEC-04 | Rotation could insert a successor behind revocation's MVCC snapshot | Rotation, family/user/session revocation serialize on user row; rotation revalidates token after acquiring lock. Password reset updates the same user row before revoking sessions. |
| SEC-05 | Concurrent first-role selection could grant both roles | Conditional update requires roleChosen=false and sets one-element roles array; losers fail before session issue. |
| SEC-06 | Session-list handler had no route decorator | Restored GET /me/sessions and response metadata. |
| SEC-08 | Login credential validation could race password reset | Compare verified hash under user row lock before session issuance; reset revokes sessions after the same row lock. |
| SEC-07 | Staff CORS silently trusted public apex domains beyond configured allowlist | Removed hardcoded origins; only STAFF_CORS_ORIGINS is authoritative. Configure intended staff origin explicitly. |
| OPS-01 | Local Compose databases/storage with default development passwords published on every interface | Bind PostgreSQL, Redis and MinIO host ports to 127.0.0.1; internal container connectivity unchanged. |
| OPS-02 | Runtime backend container ran as root | Select existing node user after image assembly. Container build/runtime validation unavailable locally. |

Refresh replay policy follows [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2): invalidate the old token, retain family relationship, revoke active descendants on replay. This application is not asserted to implement the full OAuth protocol.

## Independent cross-validation

Financial changes: contract-first row locks align refund creation, dispute opening,
and milestone settlement decisions; the new funding ledger check prevents unfunded
pre-settlement disputes. No conflicting lock order was observed in the changed paths.
Real PostgreSQL interleavings remain an integration-test requirement.

Jobs changes: seller row lock serializes application quotas across different jobs;
job row lock serializes job closure with submission; uniqueness enforces one
proposal per seller/job. Private proposal reads are ownership checked; authenticated
role guards cover creation, withdrawal, hiring and buyer lists; seller eligibility
is required for submission. Nested answer validation bounds answer count/size and
rejects unknown properties through the global validation pipe. Attached image
strings are bounded but upload ownership/scanning is not implemented by that DTO.

## Residual risks and blockers

- Credential race repaired after independent review: login passes its verified
  password hash to session issuance. Issuance locks the user and checks the current
  hash before creating a refresh token. If reset won, issuance rejects; if issuance
  won, reset waits on the same user row and then revokes the new session. A regression
  models reset winning between verification and issuance. Real DB lock scheduling
  remains untested locally.
- User role selection mutation and replacement-session creation remain separate
  transactions: an infrastructure failure can consume onboarding session after
  saving role. Relogin recovers the saved role; no privilege expansion results.
- Strict refresh reuse detection deliberately forces reauthentication for duplicate
  parallel refresh requests. Client refresh must be single-flight; cross-tab
  coordination remains worth integration testing.
- New session guard adds a DB read per authenticated request. Correctness takes
  precedence; measure load and index plans before caching revocation state.
- Jobs hire intentionally returns NOT_READY: job-contract linkage and confirmed
  work-day exclusion are incomplete. Legacy Redis proposals require a reviewed
  export/import before any production cutover; additive SQL does not migrate them.
- Existing local Compose credentials are development-only. Images include floating
  tags; pin reviewed digests for production supply-chain reproducibility.
- Unit tests do not establish real DB isolation, real browser CORS, or deployed TLS,
  backup/restore, secret management and network isolation. No deployment was made.

## Validation

New tests cover revoked-token replay, old-cookie family logout, cross-user logout
ownership, rotation revalidation after logout, live-family access checks, public
route exemption, one-time role CAS and exact CORS allowlists. The combined backend suite passed 63 suites / 565 tests after security, jobs
and financial changes. Backend typecheck passed after credential binding and
session locking changes.
Final aggregate results are recorded in the parent re-audit report.

Production verdict: not proven ready. Complete isolated DB/browser integration,
supported user journeys and operational checks
before considering launch. No numeric security score is claimed from static review.
