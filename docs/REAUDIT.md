# Project re-audit and hardening — 2026-11-08

**Verdict: not ready for a real-money production launch.** Verified defects were repaired locally and independent agent reviews were performed. Integration, real database concurrency, browser/mobile accessibility and deployment validation remain incomplete. This is not a security certification or a claim that every defect was discovered.

## Scope and evidence index

The available historical audit has **46 numbered findings**, not 41. Every item has a disposition, evidence and limitations in [the original findings ledger](REAUDIT-ORIGINAL-FINDINGS.md). The precise historical set of 41 was not supplied, so no speculative mapping to unseen findings is claimed. New issues and their repairs are documented in [financial integrity](REAUDIT-FINANCIAL.md) and [security/DevOps](REAUDIT-SECURITY.md).

Four concurrent agents covered Security/DevOps, Financial Integrity/Database, Frontend/UX/Performance, and coordinating Architecture/Backend/QA. These are review responsibilities, not nine separate independently staffed agents. Security independently reviewed financial and jobs changes; financial independently reviewed frontend financial changes; the coordinator reviewed security/session changes and requested additional race repairs. Frontend independently reviewed shared UI changes. No push, deployment, real provider transaction, live secret or production database access occurred. Initial git status was clean.

## Auto-detection and architecture

High confidence: **marketplace with escrow and staff administration**. Signals: jobs, proposals, services, buyer/seller contracts, milestone approval, payments/refunds/payouts, disputes and a double-entry ledger.

Installed local dependencies, rather than declared ranges, were checked: Next.js 16.3.5, Prisma 6.19.3; React 19 and NestJS 11 families. The architecture is a Next.js client adapter over a NestJS modular monolith, PostgreSQL/Prisma persistent state, Redis/BullMQ background processing and provider interfaces. Double-entry journal and database hardening are useful foundations. The main architectural hazard was a hybrid adapter turning rejected server writes into apparent local success. Financial and marketplace authority now stays at the server, while remaining browser mock domains are explicitly recorded as incomplete.

Architecture/roast: a rejected API request wearing a localStorage success costume is a receipt printer with no cash register. Before launch, durable workflows and recovery evidence must replace the remaining simulations.

## New coordinator findings and repairs

| ID | Severity | Verified defect | Local repair / evidence |
|---|---|---|---|
| JOB-01 | Critical | Public single/list proposal endpoints exposed application text, bids and attachments | Removed public exemptions; participant/specific job-owner checks in service; controller passes authenticated identity; regression tests cover strangers and participants. |
| JOB-02 | Critical | Any authenticated user could hire any proposal, including nonexistent proposals that returned success | Buyer ownership enforced; job-based hiring returns NOT_READY until an atomic job-contract workflow exists. No contract or hired state is fabricated. |
| JOB-03 | High | Proposals existed in three Redis copies; failed writes were swallowed and reported success, withdrawal deleted/rebuilt lists and could lose concurrent changes | Added durable JobProposal table with foreign keys and unique job/seller constraint. Application+counter commit in one transaction; withdrawal row lock and conditional mutation make retries idempotent; persistence failures propagate. |
| JOB-04 | High | Mandatory two-applications-per-day business rule absent; duplicate/self applications accepted; submission lacked seller eligibility | Serialize quota across jobs using seller row lock; enforce 2 per Uzbekistan calendar day, unique job/seller, reject own job; role and seller approval guards. Confirmed-work same-day exclusion cannot be completed until scheduled work/job contracts exist; hiring is disabled. |
| JOB-05 | Medium | Unbounded/unvalidated proposal nested answers, whitespace text and malformed deadline silently discarded | Nested validated DTOs, array/text limits, trimmed text validation and ISO date validation; dedicated input-boundary regressions. |
| JOB-06 | High | Admin job close swallowed audit-log failure | Job update and mandatory audit insert share one transaction; audit failure propagates and rollback is required. Unit verifies failure propagation; real rollback execution remains unproven. |
| QA-01 | High | Integration helpers could FLUSHALL shared Redis and DROP arbitrary database identifiers | Explicit E2E_ISOLATED_INFRA opt-in, loopback endpoints, _e2e database-name validation before destructive helpers; CI disposable integration job opts in. Unit refusal tests pass. Local tunnels/shared Redis still require operator verification. |
| QA-02 | High | Test setup could inherit real financial provider selection and lacked deterministic auth keys | Pin TEST payment/payout, CONSOLE SMS and dummy test-only auth/encryption keys before AppModule import. Production guards are unchanged. |
| UI-01 | Medium | Shared tabs declared panel semantics without associated panels | Filters use pressed-button group semantics; marketplace opts into panel-backed tabs with stable IDs and a persistent labelled panel including loading/error states. Static rendering regression checks semantics and keyboard entry point. |
| UI-02 | Medium | Toast timers continued while user focused/hovered, without unmount cleanup | Per-toast lifecycle timer preserves remaining duration, pauses on hover/focus and cleans up on unmount. Browser/screen-reader timing still requires integration verification. |

**Migration/cutover caution:** `20261108000000_durable_job_proposals` is additive. It was generated/reviewed locally but not applied to any database. Existing Redis proposal data was neither read nor deleted. A reviewed export/import, identity/duplicate/quota reconciliation and rollout plan is mandatory before enabling this code against an existing installation. New table indexes/constraints do not silently import legacy applications.

## Specialist assessments

### Page map and QA lead

The original-findings document lists every discovered page template and route scope. Source review plus adapter tests cover the repaired paths; no claim is made that every button or page was exercised through a browser. Buyer→service contract→fund→deliver→approve and refund/dispute/payout recovery still need isolated full-stack verification. Job hiring, secure cards/payout initiation, KYC, deletion and durable chat remain incomplete.

### UI/UX designer

Error reporting now reflects server rejection, true zero balances remain zero, loading failures are not disguised as empty financial lists. Shared field semantics and tab relationships improved. Pixel layout, contrast ratios and visual hierarchy across all routes were not measured; no fabricated design score is assigned.

### Persona engineer

Day-0 users face explicit unavailable workflows; impatient users receive failure rather than false success; older users need target-size/readability checks; mobile-only users need keyboard/offline/slow-network tests; power users need durable cross-device messaging and profiles. The highest friction is missing server-backed journeys, not cosmetic styling.

### Accessibility engineer

WCAG 2.1 AA **partial/unverified**. Accessible names, field associations, filter/tab semantics and timer control improved. Comprehensive browser axe, keyboard focus restoration, screen-reader announcements, touch targets and contrast remain unexecuted. A 44px target is a product recommendation here, not a blanket statement of WCAG 2.1 AA legal requirements.

### Mobile specialist

Responsive source and menu close behavior reviewed; no measured viewport, virtual-keyboard, thumb-zone, 3G or offline certification. Mobile readiness is unproven.

### Content auditor

UZ/RU/EN dictionaries exist; hardcoded new flow strings and mock-derived profile defaults remain. Provider/legal/support claims need operational validation. No unsupported jurisdictional legal conclusion is made.

### Performance engineer

No LCP/INP/CLS/TTFB or bundle transfer-size measurements were available. Auth now checks live session state per protected request: correctness improves but load/index behavior requires measurement. Complete page reads avoid truncated money totals but require server aggregates/snapshots for scalable official statements. Remaining inbox N+1/mock materialization is recorded in the frontend report.

### Security architect and financial systems

See specialist evidence linked above. Parent-row locks now serialize key financial/session decisions; server authorization is enforced on private proposals. Exact financial exposure, provider recovery, post-payout dispute liability and complete real-world concurrency require more evidence. No numeric security/OWASP coverage score is inferred from source inspection.

### Product manager

Unsupported operations fail explicitly instead of fabricating durable success. This protects correctness but does not deliver the missing functionality. Primary launch gates are atomic job-contract hiring/day exclusion, verified payout destinations, secure KYC/deletion, durable shared messaging/profile/admin workflows and truthful financial statements. No happy-path completion percentage is invented.

### DevOps/release engineer

Local development infrastructure ports now bind loopback; runtime backend image uses node user. Container build/start, TLS, monitoring, recovery drills, backup restore and production configuration have not been exercised. Production readiness remains NO for moving real money.

### A/B strategist

Do not experiment with financial correctness/security controls. After core journeys work, test service-first versus job-first onboarding against completed first verified contract, with abandonment and support load as guardrails. Baseline conversion, minimum detectable effect and traffic are unavailable, so sample size and significance cannot be responsibly asserted. Compute power first and include full weekly cycles.

## Regression tracking and sprint plan

All original IDs remain in the linked ledger; its statuses distinguish source-confirmed fixes, new repairs, obsolete claims and blocked capabilities. Newly repaired critical paths have focused regression coverage. Real DB scheduling, provider crashes and browser journey coverage remain release gates, not green checks.

| Ticket | Priority / owner | Work and done criteria |
|---|---|---|
| REL-01 | P0 / QA + Database | Run full DB authorization, concurrency, migration, rollback and ledger suites on disposable PostgreSQL/Redis; fix actual failures without weakening guards. |
| REL-02 | P0 / Backend + Financial | Atomic idempotent job hiring with work-date semantics, contract linkage and competing application exclusion; two buyers/sellers racing, rollback and forbidden scenarios verified. |
| REL-03 | P0 / Security + Financial | Owner-bound tokenized destinations and sandbox payouts/refunds; no PAN/local identity-document authority; provider early-callback/crash/reconciliation drills. |
| REL-04 | P0 / Database + Operations | Reviewed Redis proposal import and additive schema migration; prove no loss, duplication or stale counts; independent review before cutover. |
| REL-05 | P0 / QA + Frontend | Resolve environment build blocker, run production build and isolated browser buyer/seller/admin journeys including failure recovery. |
| REL-06 | P1 / Full-stack | Complete KYC/deletion, chat/profile/admin durability, accessible content and official exact statements; see frontend/financial reports. |
| REL-07 | P1 / DevOps | Container/runtime, backup restore, alerting and incident/reconciliation runbooks exercised in isolation. |
| REL-08 | Backlog / Performance | Measure CWV, session-query plans and server aggregate/snapshot endpoints under representative load. |

Estimates require implementation design and environment availability; arbitrary hour commitments are omitted. Acceptance evidence includes relevant regression tests and independent review. No tickets were published externally.

## Validation

Final combined results and modified file inventory are appended below after final checks. Earlier failures are retained as evidence rather than silently reclassified as passes.

### Final check results

| Check | Result / limitation |
|---|---|
| `npm test` | PASS: 67 backend suites / **602 tests**, plus **23 adapter + 5 form/fee + 3 UI semantic tests**. Total **633 passed**; no unit-test skips. SMS/provider errors printed by mocked failure scenarios are expected test output, not live provider calls. |
| `npm run lint` | PASS across app and backend after final fixes. Earlier unused assertions/fixture/script naming failures were corrected. |
| `npm run typecheck` | PASS app, backend and generated contracts. Earlier concurrent-edit JSON/fixture/support-category errors were corrected, not suppressed. |
| `npm run build:backend` | PASS after final financial API changes. |
| `npm run build` | FAIL twice: Next.js `Could not parse output from TypeScript's --showConfig`. Direct tsc emits valid configuration; Next's own `runTypeScriptCli` helper returned exit 0 with empty stdout. Root cause not established in this environment; no compiler/type safety setting was disabled. |
| Prisma generate / validate | PASS with dummy local URLs, no DB connection. Schema migration not applied or SQL rollback tested. An attempted migrate-diff command required a shadow DB; additive migration was then authored/reviewed directly. |
| OpenAPI/types | Regenerated directly from Nest route/DTO metadata without app init/listen and with dummy isolated config; 137 paths pass prefix consistency. Exact minor-unit fields and input extensions are included. |
| CSP / API URL | PASS; CSP synchronized, 18 URL cases passed. |
| `git diff --check` | PASS. |
| Backend integration | Initial full run: 20 suites / 364 cases failed during setup (unavailable disposable PostgreSQL and missing test auth configuration). Test setup now supplies dummy keys. Final focused contract run: 1 suite / 20 cases fail at the explicit infrastructure requirement; no contract assertion is claimed executed. Both PostgreSQL TCP and Unix socket bind attempts returned Operation not permitted. Redis startup likewise could not establish a usable test service. |
| Browser E2E / a11y / mobile / true DB concurrency / container | NOT RUN successfully. No full isolated server stack can start. Obsolete mock-session scripts are not accepted as substitutes. No performance vitals or real provider sandbox results claimed. |

Concurrency regressions use actual domain methods with mocked preflight/locked state changes; they verify gates and refusal before writes/provider calls, not actual database scheduling. Independent source review agrees with the shared-lock pattern described in [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) and [Prisma 6 transactions](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions). Production scheduling and rollback behavior must still be proved on disposable infrastructure.

### Exact modified files and purpose

- **Marketplace/database:** durable proposal schema/migration; private ownership, seller/role checks, daily quota, idempotent withdrawal, atomic admin audit and bounded inputs. Existing Redis state was not imported or deleted.
- **Security/operations:** token replay and revocation/issuance locks, live-session access checks, one-time role choice, session endpoint, explicit staff CORS, loopback local ports and nonroot container.
- **Financial:** locked refund/dispute/milestone lifecycle checks, funded resolution gate, checkout retry, exact tiyin serialization and exact award inputs. Legacy whole-so‘m fields remain backward compatible.
- **Frontend:** server-authoritative writes/funding/balance, complete financial pagination, immutable fee snapshots, honest unavailable operations, delivered support acknowledgement, field/tab/toast accessibility.
- **Tests/tooling/contracts/docs:** regression suites are wired into root test; isolated destructive-test guards and dummy provider config; regenerated API contracts; per-finding evidence and current readiness notices.

Every changed/new local path follows (generated files included):

- `.github/workflows/backend-ci.yml`
- `PRODUCTION_READINESS.md`
- `app/(main)/bozor/page.tsx`
- `app/(main)/mutaxassis/billing/page.tsx`
- `app/(main)/mutaxassis/messages/page.tsx`
- `app/(main)/mutaxassis/page.tsx`
- `backend/Dockerfile`
- `backend/docker-compose.yml`
- `backend/prisma/migrations/20261108000000_durable_job_proposals/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/common/http/cors.spec.ts`
- `backend/src/common/http/cors.ts`
- `backend/src/common/money/exact-money-dto.spec.ts`
- `backend/src/common/security/test-infra-safety.spec.ts`
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/auth/guards/jwt-auth.guard.spec.ts`
- `backend/src/modules/auth/guards/jwt-auth.guard.ts`
- `backend/src/modules/auth/refresh-token.service.spec.ts`
- `backend/src/modules/auth/refresh-token.service.ts`
- `backend/src/modules/auth/role-choice.security.spec.ts`
- `backend/src/modules/contract/contract.service.ts`
- `backend/src/modules/contract/milestone-lifecycle.spec.ts`
- `backend/src/modules/dispute/dispute-award.util.spec.ts`
- `backend/src/modules/dispute/dispute-award.util.ts`
- `backend/src/modules/dispute/dispute-funding.spec.ts`
- `backend/src/modules/dispute/dispute.service.ts`
- `backend/src/modules/dispute/dto/dispute-response.dto.ts`
- `backend/src/modules/dispute/dto/resolve-dispute.dto.ts`
- `backend/src/modules/dispute/staff-dispute.controller.ts`
- `backend/src/modules/jobs/dto/create-job.dto.ts`
- `backend/src/modules/jobs/dto/create-proposal.dto.ts`
- `backend/src/modules/jobs/dto/job-input.spec.ts`
- `backend/src/modules/jobs/jobs.controller.ts`
- `backend/src/modules/jobs/jobs.service.spec.ts`
- `backend/src/modules/jobs/jobs.service.ts`
- `backend/src/modules/jobs/proposal-security.spec.ts`
- `backend/src/modules/ledger/dto/ledger-transaction-response.dto.ts`
- `backend/src/modules/ledger/dto/seller-balance-response.dto.ts`
- `backend/src/modules/ledger/seller-balance.controller.ts`
- `backend/src/modules/me/me.controller.ts`
- `backend/src/modules/payment/payment-retry.spec.ts`
- `backend/src/modules/payment/payment.service.ts`
- `backend/src/modules/payout/dto/payout-response.dto.ts`
- `backend/src/modules/refund/dto/refund-response.dto.ts`
- `backend/src/modules/refund/refund-race.spec.ts`
- `backend/src/modules/refund/refund.service.ts`
- `backend/test/jest-e2e.setup.ts`
- `backend/test/support/e2e-infra.ts`
- `backend/test/support/test-safety.ts`
- `components/shared/ReceiptModal.tsx`
- `components/ui/Input.tsx`
- `components/ui/Pagination.tsx`
- `components/ui/PasswordInput.tsx`
- `components/ui/Select.tsx`
- `components/ui/Tabs.tsx`
- `components/ui/Textarea.tsx`
- `components/ui/Toast.tsx`
- `docs/REAUDIT-FINANCIAL.md`
- `docs/REAUDIT-ORIGINAL-FINDINGS.md`
- `docs/REAUDIT-SECURITY.md`
- `docs/REAUDIT.md`
- `lib/api/README.md`
- `lib/api/client.ts`
- `lib/api/mappers.ts`
- `lib/fees.ts`
- `lib/types.ts`
- `package.json`
- `packages/contracts/openapi.json`
- `packages/contracts/src/openapi-types.ts`
- `scripts/test-api-integrity.cjs`
- `scripts/test-form-fees.cjs`
- `scripts/test-ui-semantics.cjs`

### Release decision

**NO for real-money launch.** The reviewed fixes remove specific verified failure modes and regression coverage is materially stronger. Remaining blockers are concrete: unexecuted real DB/browser/container verification; a failing frontend production build; reviewed legacy proposal migration; atomic job hiring/work-date exclusions; secure provider-bound cards/payout initiation; KYC/deletion; durable shared mock domains; UI adoption of exact settlement values; provider recovery and operational drills. No aggregate security, design or performance score is assigned without measurements.
