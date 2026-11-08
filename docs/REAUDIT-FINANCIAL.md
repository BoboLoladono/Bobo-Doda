# Financial integrity re-audit — 2026-11-08

Scope: backend payment, contract/milestone, refund, payout, dispute, ledger and reconciliation code; independent cross-review of the frontend API/billing changes. No real provider, deployed service, customer database, or secret was accessed. Findings below are new verified issues; the original UI audit reconciliation is maintained separately.

## Verified and repaired

| ID | Severity | Evidence and root cause | Resolution |
| --- | --- | --- | --- |
| FIN-01 | Critical | `RefundService.create` checked ACTIVE and open disputes before its transaction; a settlement/dispute could commit between that read and refund insertion, followed by an external refund request against allocated funds. | Lock the contract and recheck ACTIVE and open disputes in the same transaction that inserts the refund. Provider remains outside the transaction. |
| FIN-02 | Critical | `DisputeService.resolve` could award 100% to a seller for an unfunded ACTIVE contract. Only the buyer-refund path required a succeeded payment; seller award debited an escrow that was never funded. | Require both succeeded payment and its funding journal before any nonzero pre-settlement award. Preserve intentionally supported opening of unfunded support disputes. |
| FIN-03 | High | Dispute opening checked other disputes but not existing PENDING/PROCESSING refunds. That let the same pre-settlement escrow enter two workflows. | Check active/succeeded refunds while holding the contract lock before opening a pre-settlement dispute. Combined with FIN-01, both orderings serialize. |
| FIN-04 | High | Milestone submit/revision/approval CAS predicates checked milestone status without checking current contract lifecycle. A funded contract cancelled by refund could still receive submissions, revision requests and approvals; open disputes only blocked final approval. | All three mutations acquire the contract lock, require ACTIVE, and reject pending/succeeded refund or open dispute before modifying milestones. |
| FIN-05 | Medium | `PaymentService.create` rejected every existing PENDING payment in an outer preflight check. Its inner code to resume Payme checkout was unreachable. | Remove duplicate preflight payment query; the locked existing-payment check remains authoritative and permits intended checkout resumption without a second payment. Revalidate ACTIVE after locking. |


| FIN-06 | High | Whole-so‘m DTO conversion discarded fractional-so‘m fee/award/balance precision; serialized ledger lines could appear unbalanced. | Added exact decimal-string `amountTiyin` to ledger entries/refund/payout responses, `availableTiyin` to seller balance, and `disputedAmountTiyin`, `heldAmountTiyin`, `buyerAwardAmountTiyin`, `sellerAwardAmountTiyin` to dispute responses. Legacy numeric fields remain unchanged. |

The contract locking pattern follows the existing project convention. PostgreSQL documents that a competing row lock waits until the holding transaction ends and can then observe the updated row: [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html). Application correctness still depends on every conflicting writer taking the same lock.

## Exact files changed by financial review

- `backend/src/modules/refund/refund.service.ts`: locked refund eligibility revalidation.
- `backend/src/modules/dispute/dispute.service.ts`: refund exclusion at opening and funded-ledger gate at resolution.
- `backend/src/modules/contract/contract.service.ts`: shared locked milestone lifecycle gate.
- `backend/src/modules/payment/payment.service.ts`: checkout retry restoration and locked lifecycle revalidation.
- `backend/src/modules/refund/refund-race.spec.ts`: settlement/dispute state changes after preflight, asserting no external provider call or refund creation.
- `backend/src/modules/dispute/dispute-funding.spec.ts`: no payment/no funding journal cannot produce seller awards.
- `backend/src/modules/contract/milestone-lifecycle.spec.ts`: cancelled funded contract rejects each mutation before writes.
- `backend/src/modules/payment/payment-retry.spec.ts`: pending checkout reuse and post-lock lifecycle rejection.

## Verification

- Four new suites: **10 tests passed**. These simulate adversarial interleavings by supplying different preflight and locked states; they do not prove real PostgreSQL scheduling.
- Existing ledger arithmetic and contract validation: **41 tests passed** (46 total when run with the initial refund/dispute tests before test-case consolidation).
- Scoped ESLint across the four services and four new specs passed.
- Backend typecheck passed initially after financial changes. A later concurrent check failed in `jobs.service.ts:319` on a JSON type conversion outside this review's files; final combined check belongs in the main report.
- Real integration/concurrency tests were not run: the environment denies both TCP and Unix socket creation, preventing an isolated database. Existing database e2e suites must be executed against disposable infrastructure before release.
- No tests were changed to suppress a failing business rule. Existing e2e evidence explicitly supports opening an unfunded dispute, so that support journey remains allowed while financial allocation is blocked.

## Independent frontend review

The removal of browser-created financial contracts/payments and funding guesses is sound. Contract funding now uses `isFunded` supplied by the backend; available seller balance comes from `/seller/balance`; withdrawal history and totals use server payout records. Fetching every page avoids the old truncation of totals and propagates page failures.

At cross-review time, card addition/removal still operated only in localStorage and returned success; those records cannot establish a verified payout destination. The coordinating agent was notified to fail these unsupported operations closed. Payout destination references are deliberately opaque at this stage, and only TEST/DISABLED payout providers exist. A real payout integration must verify account ownership and tokenize destinations before acceptance.

## Remaining risks and production blockers

1. No evidence of a real disposable-DB concurrency run for these changes. Exercise simultaneous settlement/refund/dispute and conflicting milestone operations with real PostgreSQL transaction scheduling.
2. Real payout and refund execution/recovery are not implemented for the disabled/test-only provider capabilities. A committed PENDING operation followed by process death before provider invocation needs an explicit operational recovery procedure; never release ambiguous provider reservations automatically.
3. Provider callbacks may arrive before provider references are attached; unknown events are recorded, and reconciliation is needed to recover. Test fast callbacks and crashes between provider acceptance and reference persistence with a provider sandbox.
4. Exact minor-unit strings now preserve fee/award/balance precision across the API. Legacy whole-so‘m numeric fields remain for compatibility and still truncate fractions. Frontend statements and exports must consume the exact `*Tiyin` fields before financial launch; do not reconstruct ledger balances from legacy numeric amounts.
5. Frontend totals gathered across multiple pages are informational and can change during pagination; use a server-side aggregate/snapshot for official statements or reconciliation.
6. Post-settlement disputes only hold currently available seller funds. Previously paid-out funds are not recovered by this implementation; customer promises must reflect this limitation and an operational liability process is required.
7. No provider sandbox, reconciliation outage drill, backup/restore, key rotation, fraud response, or production monitoring was exercised here.

Verdict: financial safety improved materially, but production readiness remains **not established**. Atomic database ledger/state changes and append-only journals are good architectural foundations; passing mock regression tests is insufficient evidence for moving real money.

## Follow-up precision fix verification

Added `backend/src/common/money/exact-money-dto.spec.ts`: **8 tests passed** covering JSON round trips, signed amounts, PostgreSQL bigint maximum, balanced journals with fractional-so‘m lines, customer/staff refund and payout fields, and null versus zero dispute awards. Backend typecheck and scoped ESLint passed after these additions.

Additional modified files: `backend/src/modules/ledger/dto/ledger-transaction-response.dto.ts`, `backend/src/modules/ledger/dto/seller-balance-response.dto.ts`, `backend/src/modules/ledger/seller-balance.controller.ts`, `backend/src/modules/dispute/dto/dispute-response.dto.ts`, `backend/src/modules/refund/dto/refund-response.dto.ts`, `backend/src/modules/payout/dto/payout-response.dto.ts`. The additive fields use decimal strings so JSON never loses bigint precision; 100 tiyin equals 1 UZS. Exact dispute award inputs are also supported as described below; ordinary payout/payment amount requests retain the existing whole-so‘m contract.

## Exact dispute award input extension

FIN-07: Integer-so‘m award inputs could not resolve a post-settlement hold such as 95 tiyin. Staff resolution now accepts either the existing complete `buyerAwardAmount`/`sellerAwardAmount` numeric pair, or a complete `buyerAwardAmountTiyin`/`sellerAwardAmountTiyin` decimal-string pair. The two modes cannot be mixed. Exact values are canonical nonnegative digit strings, bounded by the existing maximum (1,000,000,000,000 tiyin per award), parsed directly to bigint. Both HTTP DTO validation and the domain service reject missing pairs, mixed units, negative/fractional/scientific notation, nulls and oversized inputs. The locked held-amount equality remains authoritative. Staff permission guards and idempotency requirements are unchanged.

Modified `backend/src/modules/dispute/dto/resolve-dispute.dto.ts`, `backend/src/modules/dispute/staff-dispute.controller.ts`, `backend/src/modules/dispute/dispute.service.ts`; added `backend/src/modules/dispute/dispute-award.util.ts` and `.spec.ts`. Added 21 passing tests, including a real service resolution path for a 95-tiyin seller award and rejection of a 94-tiyin mismatched sum. Typecheck passes. Existing frontend inputs remain whole-so‘m; the API can resolve fractional holds, but staff UI must adopt the exact fields to expose that capability interactively.
