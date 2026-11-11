# Independent original-findings review — 2026-11-08

The supplied `report.md` contains **46 numbered findings**, including 3.4b (7 P0, 17 P1, 14 P2, 8 P3), not 41. Every numbered item is accounted for below. Its historical “fixed” labels are not acceptance evidence. Paths moved from the old Uzbek routes to the `(main)` route group and English cabinet segments. This review checks current source and isolated adapter behavior; it does **not** certify all pages through a live browser/backend journey.

Status vocabulary: **verified fixed** = current code removes the reported defect, with evidence shown; **fixed now** = regression/new failure repaired in this change; **blocked** = a real backend capability, browser measurement or broader product work remains; **disproven** = original claim does not describe current implementation. A static confirmation is explicitly distinguished from an executed test. Multiple-part findings retain limitations in the evidence column.

## Original findings ledger

| ID | Original concern | Disposition | Independent evidence and limits |
|---|---|---|---|
| 1.1 | Second card spinner never resets | Verified fixed; binding blocked | `components/shared/cards.tsx` uses `finally { setSaving(false) }`. Tokenized card binding is absent: adapter add/remove now reject `FEATURE_DISABLED`; local cards are not presented as bound payment instruments. |
| 1.2 | Cannot publish draft | Fixed now | `ServiceCard` and `ServiceWizard` have explicit submit actions. Removed adapter auto-submit on create, fabricated ACTIVE local fallback, and forced ACTIVE mapping after submit. Server DRAFT/PENDING_REVIEW is preserved; isolated regression verifies create remains draft and rejection propagates. |
| 1.3 | Password reset falsely succeeds | Disproven in active adapter | Current auth pages use registration/reset grants and `/auth/password-reset/*`; old mock reset is no longer the active password-reset boundary. Backend auth review/tests cover actual grant handling; SMS delivery not tested here. |
| 1.4 | Role screen hangs without session | Fixed now | Role page refreshes/redirects unauthenticated users and catches errors. Additional adapter regression found: role rejection fabricated `verified:true` and user `me`. Removed; only server response writes session, no error-to-switch fallback. Mocked rejection and success tests pass. |
| 1.5 | Buyer spent totals disagree | Verified fixed | `(main)/xaridor/page.tsx` and `billing/page.tsx` aggregate approved milestones. Adapter now retrieves all contract pages rather than silently truncating at 100. Actual settlement history still needs integration validation. |
| 1.6 | Dispute freezes forever | Verified fixed at source; operationally blocked | Staff dispute module exists, participant cancellation uses `/me/disputes/:id/cancel`; staff resolution is server-side. Availability/SLA staffing and full money recovery journey require isolated DB/provider integration. |
| 1.7 | Workroom outage shown as missing contract | Verified fixed | Seller contract page has `loadError` and retry `ErrorState`; adapter contract get only maps NOT_FOUND to null. |
| 2.1 | Buyer sees seller-directed funding copy | Verified fixed | Buyer workroom uses `cfund.awaitingDesc`; seller workroom uses `cfund.awaitingSeller`. |
| 2.2 | Unfunded contract payment stage green | Fixed now | Workrooms use current simplified status UI. Removed legacy localStorage funding inference and approved-milestone guess in hydration; funding uses server `isFunded` and `fundedAt` only. |
| 2.3 | Declined/withdrawn offer lacks explanation | Verified fixed at source | Seller incoming-offer detail includes `soffer.declinedNote` / `soffer.withdrawnNote` and next-step links. Legacy offers remain browser-backed; accepting them is disabled until durable contracts exist. |
| 2.4 | Inbox offers lead to hidden chat | Fixed now | Seller inbox now includes only `status === "yuborilgan"` offer threads, matching the detail page's pending chat. Closed offers no longer create dead inbox destinations. |
| 2.5 | Submission succeeds but subsequent message fails | Verified fixed | Seller workroom submits deliverable as one backend milestone request; no second `messagesService.send` is part of submission handler. |
| 2.6 | Disputed escrow disappears | Fixed now | Buyer billing includes `faol` and `nizo`; seller billing had regressed to `faol` only, now includes both. No UI runtime/escrow settlement assertion is claimed. |
| 2.7 | Seller categories immutable | Blocked | Settings has categories editor; extra profile fields remain browser-local because backend profile DTO does not persist the full seller profile. UI edit is present, durable cross-device category updates are incomplete. |
| 2.8 | Autosave leaks unsaved name | Verified fixed at source | Settings `saveSellerData` uses `overrides.fullName ?? persisted.fullName`, not unsaved input. Adapter PATCH errors now propagate rather than falsely confirming persistence. |
| 2.9 | Unhandled preference/availability rejection | Verified fixed at UI; persistence blocked | Account controls catch errors; settings catches availability failure. Availability/preferences remain local-only and need backend support. |
| 2.10 | Login silent on unfamiliar failure | Verified fixed | Current login handler catches failures and sets form feedback. Actual auth behavior covered by backend review; browser keyboard/SR feedback not executed here. |
| 2.11 | Interview invite has no usable chat | Blocked | Dedicated proposal-chat route/component exists, but proposal status change lacks a durable server endpoint and chat remains browser-backed. Adapter status changes now explicitly fail rather than fabricate an interview. |
| 2.12 | Hiring amount differs without warning | Verified fixed at source; hiring blocked | Hiring page compares milestone total to `proposal.bidAmount` and renders warning. Adapter hiring now fails closed: no atomic job-proposal-to-contract backend workflow exists; removed pre-emptive local hired mutations and unrelated contract creation. |
| 2.13 | Mobile menu remains open | Verified fixed | Both TopNav components close on pathname change and Escape. Mobile viewport behavior not rerun here. |
| 2.14 | Conflicting completeness percentages | Verified fixed | Shared `lib/profile-completeness.ts` is used for common criteria and settings tab destinations. Local-only seller fields limit cross-device accuracy. |
| 2.15 | Export contains plaintext password | Verified fixed at active boundary | Active export explicitly selects `/me` response + seller application rather than mock User password. Backend DTO excludes passwordHash. Complete DSAR export remains incomplete (not all user data included). |
| 2.16 | Payment result unreachable / no legal cabinet links | Verified fixed at source | Payme callback/return flow and cabinet footer exist. End-to-end merchant redirects were not invoked; no real payment was initiated. |
| 2.17 | Unconfigured support silently fails | Blocked | Support API/configuration and explicit offline support exist. Additional regression fixed now: ticket creation awaits support acknowledgement before recording browser success; delivery errors propagate. Real support delivery still depends on configured transport. No external Telegram messages were sent in this audit. |
| 3.1 | Unnamed hamburger | Verified fixed | Both TopNav buttons have translated accessible names and `aria-expanded`. |
| 3.2 | Untranslated common accessible names | Fixed now; broader content work remains | Modal, Stepper, Breadcrumb and LangSwitch use i18n. Pagination default nav name now uses `a11y.pagination`; both password toggle implementations now reuse translated `auth.showPassword`/`auth.hidePassword`. New hardcoded names still occur elsewhere in page source. |
| 3.3 | Untranslated Me/CL/SP abbreviations | Disproven as exact old locations | Current dashboards/workrooms were restructured; old snippets/locations are obsolete. This does not establish complete current localization: source still contains Uzbek-only copy in new flows. |
| 3.4 | Popular searches Uzbek-only | Disproven as exact old feature | Unified `/bozor` replaces old buyer marketplace; old POPULAR_SEARCHES list is absent. Current marketplace still needs multilingual runtime review. |
| 3.4b | Settings skills guidance hardcoded | Verified fixed at original scope | Settings uses dictionary keys for skills/category guidance. Other newly added settings strings remain outside the original two snippets. |
| 3.5 | Inconsistent image alt localization | Blocked | Existing translated image labels coexist with new hardcoded profile/image names; comprehensive UZ/RU/EN image semantics and decorative-image review remains. No blanket alt compliance claim. |
| 3.6 | Error/hint disconnected from input | Verified fixed at shared-component source | Input/Select/PasswordInput use generated message IDs and `aria-describedby`, errors have role alert. Caller-provided descriptions are now composed with generated message IDs across Input, Select, Textarea and PasswordInput; SSR tests execute all four components. |
| 3.7 | Unnamed budget/deletion fields | Verified fixed at original scope | Unified marketplace min/max fields have translated `aria-label`; account deletion confirmation is labelled. Deletion itself now rejects unsupported operation instead of merely logging out. |
| 3.8 | Select has no chevron | Verified fixed | Select renders decorative chevron with `aria-hidden`; native select behavior retained. |
| 3.9 | Incomplete tab pattern | Fixed now at source | Root repaired Tabs to use pressed-button groups for filters and opt-in linked tabs/panels for actual content switching; unified marketplace owns a stable associated panel. Three SSR semantic tests pass. Full keyboard/screen-reader runtime verification remains. |
| 3.10 | Notification count not announced | Verified fixed at source | NotificationBell accessible name includes unread count; browser/screen-reader speech not measured. |
| 3.11 | Toast timing/accessibility | Fixed now at source | Root added per-toast timer cleanup and remaining-time pause during hover/focus. Existing alert/status semantics and dismiss controls retained. Independently reviewed source; real timer/assistive-technology runtime verification remains. |
| 3.12 | Time forced to Russian | Verified fixed | `formatTime(iso, lang = "uz")` chooses locale; chat callers pass lang in current shared components. |
| 3.13 | Milestone/pipeline low contrast | Verified fixed at original source; measurement blocked | MilestoneItem no longer dims waiting rows with opacity; semantic deep colors used on tinted backgrounds. Current contrast ratios across all screens require browser measurements. |
| 4.1 | Missing text-3xs token | Verified fixed | `tailwind.config.ts` contains `3xs`; consumers resolve a declared token. |
| 4.2 | Button tone outside palette / unused | Disproven in current implementation | Button uses semantic palette classes; tone now serves administrative actions. Original dead-code assumption is obsolete. |
| 4.3 | Non-token visual styles | Blocked | Shared components improved, but new pages still introduce raw styles. Project-wide consistent visual treatment requires screenshot-based design review rather than mechanical class substitutions. |
| 4.4 | Duplicated 5% fee constants | Fixed now; exact settlement display remains limited | Landing/FAQ/help import `PLATFORM_FEE_PERCENT`. Removed browser-admin settings from fee arithmetic; immutable server contract fee rates now accompany mapped milestones and drive historical fee/net estimates and receipts. Floor-to-tiyin calculation matches backend rate rule. Actual available cash uses only ledger. Backend settles the whole contract on final approval; per-milestone net is still a rate-based estimate, not proof of cash release. |
| 4.5 | Obsolete documentation | Fixed now in audit documentation; legacy docs remain | This ledger explicitly records current hybrid architecture and feature gaps. Old `lib/api/README.md` and root production checklist still describe a prior mock-only integration and must not serve as current launch evidence. |
| 4.6 | Validation/date/review ownership gaps | Blocked legacy scope; active path safer | Old `hireProposal` mock remains historical; active hire disabled rather than constructing an unchecked contract. Current job detail guards date rendering with `formatDate` rather than `toISOString`; backend validates service-contract DTOs. Review service is explicitly unsupported. Full mock hire/review legacy behavior is no longer used by active contract actions. |
| 4.7 | Refund credited before transition validation | Disproven for active contract boundary | Active cancel calls server `/me/contracts/:id/cancel`; it does not execute mock creditBalance. Actual ledger cancellation correctness belongs to financial audit/tests, not browser mock inspection. |
| 4.8 | UUID/read-state/N+1/listener/CSP miscellaneous | Partially fixed; blocked remaining | Settings uses UUID, both TopNav subscribe/unsubscribe DATA_CHANGED, CSP font-src aligns. Inbox uses Promise.allSettled but still per-offer reads. Browser chat/read-state stays local and cannot establish durable cross-user messages. |

## New verified frontend defects and repairs

1. Failed role selection fabricated an authenticated UI identity. Removed all error-to-success role fallbacks.
2. Failed job/service/proposal CRUD became local fake successes, including rejected moderation treated as ACTIVE. Removed local fallback CRUD; authoritative server states are retained.
3. Hiring changed proposal state before contract creation and swallowed backend hire failures. Disabled until atomic integration exists; unsupported mock-offer acceptance likewise fails closed.
4. Seller billing substituted historical earnings for a real zero and double-deducted payouts from an already reserved ledger balance. Now displays server available balance directly, and fails visibly when withdrawal history cannot load.
5. Fixed-size first pages truncated contracts, payout totals and disputes. Adapter reads every page and rejects partial-page failures rather than returning false totals.
6. Funding inference trusted browser custom payment snapshots. Removed; current DTO supplies authoritative funding fields.
7. Card reads leaked shared `bbd_cards_me` across accounts and claimed local metadata as binding. Card binding/removal and payout initiation disabled pending backend destination validation/tokenization; no existing stored user data deleted.
8. Identity submission swallowed backend failure and wrote passport/document data to localStorage; reads treated seller approval as identity verification and invented birth date. Both KYC methods explicitly disabled pending secure document/verification pipeline; existing data not read/deleted.
9. Account deletion merely logged out and returned success. Now fails explicitly until actual deletion/privacy retention workflow exists.
10. Browser-admin settings could rewrite historical fee displays. Removed mutable browser settings; mapper now attaches server rate snapshot to milestone views.
11. Profile PATCH failures were swallowed. Now propagate before local success bookkeeping.
12. Help-center tickets were marked created before fire-and-forget support delivery. Now await transport acknowledgement and propagate rejection before saving local history.

## QA and verification evidence

- `node scripts/test-api-integrity.cjs`: **23 passed**, zero failed/skipped. Uses transpiled actual adapter/error/mapper code, isolated in-memory session/storage and mocked HTTP. Covers failures, role success, draft publishing, rejection with forged cache, unsupported operations, multi-page payout totals and financial read failures.
- `node scripts/test-form-fees.cjs`: **5 passed**, zero failed/skipped; executes actual shared components under React SSR and immutable snapshot fee calculations.
- `npm run typecheck:app`: passed after changes.
- `npm run lint:app`: initial run found two unused types/parameters after cleanup; removed them. Final result recorded by root after combined changes.
- Existing browser scripts `lifecycle-test.cjs`, `stress-test.cjs` declare themselves obsolete mock-session tests. They cannot substantiate current production functionality. Live Playwright suite requires isolated full backend/DB/Redis and was not run by this frontend agent.
- No LCP/INP/CLS/TTFB, visual scores or WCAG certification numbers were invented. No production/payment/support provider invoked.

## Specialist assessment and sprint work

**Architecture / roast:** a server rejection used to wear a localStorage success costume. The repair makes the server authoritative for financial and marketplace mutations; mock messaging, profile extras, support ticket history, platform settings and some admin views still require real integration. Production must not rely on their apparent browser success.

**QA:** adapter regression coverage improved; full buyer→seller→fund→deliver→approve→payout/dispute recovery remains blocked on isolated integration environment and missing product capabilities.

**UI/UX and Mobile:** source confirms responsive classes, menu closure and explicit error states. No page-by-page visual pass, mobile keyboard/slow-network measurements or thumb-zone scores are claimed.

**Persona:** Day-0 users encounter disabled binding/hiring/KYC; impatient users now receive actual failure instead of false success; older users still face small controls; mobile users require viewport testing; power users lack durable chat/profile synchronization. Primary friction is incomplete backend capabilities hidden by prior local simulations.

**Accessibility:** partial, not certified WCAG 2.1 AA. Existing input/menu semantics are improved. Small targets, complete translation and browser axe/keyboard testing remain; tab/panel association, toast pause and composed error descriptions were repaired at source.

**Content:** multi-language dictionary exists; new hardcoded Uzbek strings and fabricated specialist defaults remain. Legal/support copy needs operational validation, not a fabricated engineering legal verdict.

**Performance:** removing speculative funding requests avoids per-contract payment lookup. Inbox mock offer N+1 and full-list materialization remain scale concerns. Financial correctness currently requires complete page reads; server aggregate endpoints are the scalable next step.

**Security / Financial integrity:** frontend fail-closed changes prevent false successes, not a substitute for server authorization. Remaining local mock messages/offers/profile/admin state are not safe evidence of durable shared business operations.

**Product:** hiring, secure destination binding, KYC, deletion and durable chat need backend workflows. Feature-disabled feedback is intentionally truthful; complete happy-path percentage cannot be established.

**DevOps:** no deploy/push performed. Local checks are necessary but insufficient; full integration, backup recovery, monitoring/alert response, provider sandbox reconciliation and tested launch configuration remain launch gates.

**A/B strategy:** repair correctness first. Once functional, compare service-first vs job-first onboarding using completed first verified contract as primary metric. Sample size requires measured baseline conversion and chosen minimum detectable effect; inventing a fixed N/95% claim would be invalid. Run across complete weekly cycles after power calculation.

| Ticket | Priority / owner | Acceptance evidence |
|---|---|---|
| FE-01 Atomic proposal hiring | P0 / Backend + Frontend | Single idempotent authorized transaction creates the contract, marks hired, cancels same-day competing applications; concurrency and rollback tests. |
| FE-02 Tokenized payout destination | P0 / Security + Financial | Verified owner-bound provider reference, no PAN in logs/localStorage, integer amount validation, sandbox payout/refusal tests. |
| FE-03 Real KYC/deletion | P0 / Security + Product | Secure uploads/retention/access policy and real deletion/retention workflow; no false success. |
| FE-04 Durable chat/profile/admin integration | P1 / Full-stack | Two isolated user contexts see authorized shared state; forbidden/retry/offline tests; remove remaining mock authority. |
| FE-05 Exact settlement display | P1 / Financial + Frontend | Immutable snapshot rates now used; extend authoritative DTO with per-milestone/contract cash settlement status and exact amounts; do not imply approved milestone equals released cash before full-contract settlement. |
| FE-06 Accessibility and mobile regression | P1 / QA + Design | All routes mapped below, keyboard/axe at 360/390/768/1280, tab/panel associations, toast pause, measured contrast. |
| FE-07 Server aggregates / pagination UI | P2 / Performance | Correct totals at >100 records, bounded network/DOM, actual CWV measurement with documented device/network. |

**Production verdict: NOT READY.** This is a marketplace with escrow/ledger capabilities and substantial integration, but browser-local business workflows and explicitly unavailable financial/identity workflows prevent an evidence-based launch approval.

## Source-derived page map

Authentication columns are based on route groups/layout intent, not proof of server authorization. API handlers and dynamic route instances are not counted as separate user pages. Legacy redirects in proxy may expose additional aliases.

73 page templates found. Each template was inventoried; a browser visit to every page was **not** completed.

| Route | Auth intent | Source |
|---|---|---|
| `/kirish` | Public / flow-dependent | `app/(auth)/kirish/page.tsx` |
| `/parolni-unutdim` | Public / flow-dependent | `app/(auth)/parolni-unutdim/page.tsx` |
| `/parolni-unutdim/parol` | Public / flow-dependent | `app/(auth)/parolni-unutdim/parol/page.tsx` |
| `/parolni-unutdim/tasdiqlash` | Public / flow-dependent | `app/(auth)/parolni-unutdim/tasdiqlash/page.tsx` |
| `/rol-tanlash` | Public / flow-dependent | `app/(auth)/rol-tanlash/page.tsx` |
| `/royxatdan-otish` | Public / flow-dependent | `app/(auth)/royxatdan-otish/page.tsx` |
| `/royxatdan-otish/parol` | Public / flow-dependent | `app/(auth)/royxatdan-otish/parol/page.tsx` |
| `/royxatdan-otish/tasdiqlash` | Public / flow-dependent | `app/(auth)/royxatdan-otish/tasdiqlash/page.tsx` |
| `/bozor/ish-elonlari/[id]` | Public / flow-dependent | `app/(main)/bozor/ish-elonlari/[id]/page.tsx` |
| `/bozor/ish-elonlari/[id]/taklif` | Public / flow-dependent | `app/(main)/bozor/ish-elonlari/[id]/taklif/page.tsx` |
| `/bozor/mutaxassis/[id]` | Public / flow-dependent | `app/(main)/bozor/mutaxassis/[id]/page.tsx` |
| `/bozor` | Public / flow-dependent | `app/(main)/bozor/page.tsx` |
| `/bozor/xizmat/[id]` | Public / flow-dependent | `app/(main)/bozor/xizmat/[id]/page.tsx` |
| `/mutaxassis/applications/[id]` | User | `app/(main)/mutaxassis/applications/[id]/page.tsx` |
| `/mutaxassis/applications/kelgan/[id]` | User | `app/(main)/mutaxassis/applications/kelgan/[id]/page.tsx` |
| `/mutaxassis/applications` | User | `app/(main)/mutaxassis/applications/page.tsx` |
| `/mutaxassis/billing` | User | `app/(main)/mutaxassis/billing/page.tsx` |
| `/mutaxassis/contracts/[id]` | User | `app/(main)/mutaxassis/contracts/[id]/page.tsx` |
| `/mutaxassis/contracts` | User | `app/(main)/mutaxassis/contracts/page.tsx` |
| `/mutaxassis/disputes` | User | `app/(main)/mutaxassis/disputes/page.tsx` |
| `/mutaxassis/messages` | User | `app/(main)/mutaxassis/messages/page.tsx` |
| `/mutaxassis` | User | `app/(main)/mutaxassis/page.tsx` |
| `/mutaxassis/services/[id]` | User | `app/(main)/mutaxassis/services/[id]/page.tsx` |
| `/mutaxassis/services` | User | `app/(main)/mutaxassis/services/page.tsx` |
| `/mutaxassis/services/yangi` | User | `app/(main)/mutaxassis/services/yangi/page.tsx` |
| `/mutaxassis/settings` | User | `app/(main)/mutaxassis/settings/page.tsx` |
| `/mutaxassis/settings/profil` | User | `app/(main)/mutaxassis/settings/profil/page.tsx` |
| `/mutaxassis/settings/royxat` | User | `app/(main)/mutaxassis/settings/royxat/page.tsx` |
| `/mutaxassis/settings/verifikatsiya` | User | `app/(main)/mutaxassis/settings/verifikatsiya/page.tsx` |
| `/xaridor/billing` | User | `app/(main)/xaridor/billing/page.tsx` |
| `/xaridor/contracts/[id]` | User | `app/(main)/xaridor/contracts/[id]/page.tsx` |
| `/xaridor/contracts` | User | `app/(main)/xaridor/contracts/page.tsx` |
| `/xaridor/disputes` | User | `app/(main)/xaridor/disputes/page.tsx` |
| `/xaridor/messages` | User | `app/(main)/xaridor/messages/page.tsx` |
| `/xaridor/mutaxassislar` | User | `app/(main)/xaridor/mutaxassislar/page.tsx` |
| `/xaridor/my-jobs/[id]` | User | `app/(main)/xaridor/my-jobs/[id]/page.tsx` |
| `/xaridor/my-jobs/[id]/suhbat/[proposalId]` | User | `app/(main)/xaridor/my-jobs/[id]/suhbat/[proposalId]/page.tsx` |
| `/xaridor/my-jobs/[id]/yollash/[proposalId]` | User | `app/(main)/xaridor/my-jobs/[id]/yollash/[proposalId]/page.tsx` |
| `/xaridor/my-jobs` | User | `app/(main)/xaridor/my-jobs/page.tsx` |
| `/xaridor/my-jobs/yangi` | User | `app/(main)/xaridor/my-jobs/yangi/page.tsx` |
| `/xaridor` | User | `app/(main)/xaridor/page.tsx` |
| `/xaridor/settings` | User | `app/(main)/xaridor/settings/page.tsx` |
| `/xaridor/yordam` | User | `app/(main)/xaridor/yordam/page.tsx` |
| `/admin/apellyatsiyalar` | Staff | `app/admin/apellyatsiyalar/page.tsx` |
| `/admin/audit` | Staff | `app/admin/audit/page.tsx` |
| `/admin/fikrlar` | Staff | `app/admin/fikrlar/page.tsx` |
| `/admin/foydalanuvchilar` | Staff | `app/admin/foydalanuvchilar/page.tsx` |
| `/admin/kategoriyalar` | Staff | `app/admin/kategoriyalar/page.tsx` |
| `/admin/kirish` | Public / flow-dependent | `app/admin/kirish/page.tsx` |
| `/admin/loyihalar` | Staff | `app/admin/loyihalar/page.tsx` |
| `/admin/nizolar` | Staff | `app/admin/nizolar/page.tsx` |
| `/admin` | Staff | `app/admin/page.tsx` |
| `/admin/parolni-almashtirish` | Staff | `app/admin/parolni-almashtirish/page.tsx` |
| `/admin/ruxsat-yoq` | Staff | `app/admin/ruxsat-yoq/page.tsx` |
| `/admin/sharhlar` | Staff | `app/admin/sharhlar/page.tsx` |
| `/admin/shartnomalar` | Staff | `app/admin/shartnomalar/page.tsx` |
| `/admin/shikoyatlar` | Staff | `app/admin/shikoyatlar/page.tsx` |
| `/admin/sozlamalar` | Staff | `app/admin/sozlamalar/page.tsx` |
| `/admin/super/adminlar` | Staff | `app/admin/super/adminlar/page.tsx` |
| `/admin/tolovlar/[...id]` | Staff | `app/admin/tolovlar/[...id]/page.tsx` |
| `/admin/tolovlar` | Staff | `app/admin/tolovlar/page.tsx` |
| `/admin/verifikatsiya` | Staff | `app/admin/verifikatsiya/page.tsx` |
| `/admin/xizmatlar` | Staff | `app/admin/xizmatlar/page.tsx` |
| `/admin/yordam` | Staff | `app/admin/yordam/page.tsx` |
| `/maxfiylik` | Public / flow-dependent | `app/maxfiylik/page.tsx` |
| `/oferta` | Public / flow-dependent | `app/oferta/page.tsx` |
| `/` | Public / flow-dependent | `app/page.tsx` |
| `/rahbariyat/kirish` | Public / flow-dependent | `app/rahbariyat/kirish/page.tsx` |
| `/savol-javob` | Public / flow-dependent | `app/savol-javob/page.tsx` |
| `/shartlar` | Public / flow-dependent | `app/shartlar/page.tsx` |
| `/tolov/natija` | Public / flow-dependent | `app/tolov/natija/page.tsx` |
| `/yordam-markazi/[slug]` | Public / flow-dependent | `app/yordam-markazi/[slug]/page.tsx` |
| `/yordam-markazi` | Public / flow-dependent | `app/yordam-markazi/page.tsx` |
