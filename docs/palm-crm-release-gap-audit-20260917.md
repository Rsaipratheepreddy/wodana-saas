# Palm Living CRM release gap audit — 17 September 2026

Source of client requirements: `/Users/ramireddysaipratheepreddy/Downloads/Palm Living Lead Flow CRM Requirements Report.pdf` (eight pages). This is a current code/live-tenant audit, not a claim that CRM is complete.

## Client flow versus current implementation

| Requirement | Backend / UI state | Palm UAT state and next action |
| --- | --- | --- |
| Preserve source, channel, intake method and assignment separately | Intake, enquiry and lead records do this. Enquiries now show all three acquisition dimensions by default; forms show their published source and channel. | Verify a Palm manual lead and each shared form end to end. |
| Social enquiries | A channel can be recorded manually or by a channel-specific shared form/QR. WhatsApp messages are Inbox conversations, not automatically leads. No Meta Lead Ads connector exists. | User chose shared enquiry links for now. Create distinct channel-labelled forms after Palm sales routing and approved public wording are ready; do not describe them as an Instagram/Meta account connection. |
| PlyLeads | No provider connector or authenticated webhook/API contract. | Client has no API/webhook details yet. Keep as an unconnected digital-marketing channel option, not an automated feed. |
| Current enquiry types | Global fallback offers only “Not Sure Yet”; tenant options are supported by API/UI. | Configure Palm's eight report-listed types. Customer types and budget bands are not approved; keep optional/“Not sure yet” rather than inventing them. |
| Customer form and walk-in QR | Public forms are backed by idempotent intake, preserve original answers, require name and a contact method, and can be shared as QR. Default form includes mobile and location as required. | Palm has no published or draft forms. Public form branding now reads tenant logo/primary colour. Publish only after sales routing and form copy approval. Walk-in QR needs Company Enquiry / Walk-in / Form; staff walk-in stays manual with explicit salesperson. |
| Assignment and first-response SLA | Capacity-aware fallback queue/policies and SLA evidence exist. | Palm has no queue, queue member, assignment policy or SLA policy. No target minutes or business-hours schedule were provided by the report. Owner must activate, sales members must join, and targets must be approved before claiming automatic assignment/SLA. |
| Duplicate review and original enquiry | Backend keeps canonical intake, original payload, review candidates and audited decisions. | Exercise with a safe sample Palm lead, including same-mobile and replay cases; no real customer data or duplicate deletion. |
| Qualification and opportunity handoff | Versioned qualification and one-lead/one-opportunity conversion exist. UI uses the qualification endpoint rather than a plain status flip. | Palm has no qualification form or pipeline. A full live conversion cannot pass yet. Configure the approved questions/stages and test before opening pre-execution. |
| Reports | Backend has source/channel/intake/owner/team/budget/duplicate/stale dimensions; UI has CRM reports and enquiry health. | Check Palm sample lead totals against intake and funnel once configured. |

## Live Palm tenant snapshot

Read-only tenant-scoped query before the code rollout on 17 September: 0 enquiries, 0 forms, 0 taxonomies, 0 queues, 0 assignment policies, 0 SLA policies, 0 qualification forms, 0 pipelines and 0 active memberships; 1 valid pending owner invitation reserved 1 of 5 seats. A post-rollout check at 05:57 UTC showed that invitation had been accepted: 1 active member, 0 pending invitations. No live CRM configuration or lead-flow test was created as part of this rollout.

## Code rollout and verification

- Release `20260917-palm-crm-r3` was deployed to the exact Palm host on 17 September. Palm's web and business-core containers are healthy on separate ports; `wodana.ai` remains on `20260917-palm-crm-r2`. The previous Nginx configuration, database and object data were backed up before cutover, and the previous route remains available for rollback.
- Local isolated browser smoke passed invitation activation, onboarding, CRM creation/readback, a branded public form, and Instagram/WhatsApp/LinkedIn/TikTok/website/walk-in shared-form routing. The isolated backend CRM and full commercial funnel smoke passed. Business-core unit tests passed (637; 10 skipped), web unit tests passed (560), and production web/core image builds passed.
- Outside-in checks passed for Palm's login, its logo and dark primary palette, API readiness, unauthenticated CRM redirect, and invalid-form 404. These checks do **not** prove a live Palm lead journey. The owner has activated; Palm still needs sales members, approved routing/SLA and CRM configuration before a real synthetic live lead can be assigned and qualified.

## Integration order and release gates

1. Configure the approved Palm acquisition sources/channels and eight enquiry types. Leave unresolved customer types, budget bands and PlyLeads routing unfilled.
2. Activate the owner, add actual sales members, create fallback Sales queue, verify capacity routing, and approve first-response SLA targets.
3. Build channel-specific shared forms for website, Instagram, WhatsApp, LinkedIn, TikTok and walk-in QR; approve public wording/branding; publish and test each token on `plm.wodana.ai` from a private browser. The chosen link approach is not native social account ingestion.
4. Configure qualification form and active pipeline, then run one synthetic lead through form/manual intake → duplicate review → assignment/SLA → follow-up → qualification → opportunity. Check event/outbox and report reconciliation.
5. Only then open the pre-execution/quotation and project UI slices in order against their existing backend contracts. Keep those routes gated in Palm until each handoff and mobile/permission/error state passes QC. Do not call accounting, supplier, production, site or handover “integrated” solely because their backend endpoints exist.

Native Meta Lead Ads and PlyLeads ingestion remain later connector work requiring provider authorization/specifications. Do not silently conflate selecting a channel with receiving provider events.

## Cece's 17 September operational clarification (not yet release-complete)

- Use `operations@palmlivingae.com` as the sole active tester; `cece@palmlivingae.com` may be used for a second-account test. Do not onboard the wider team before access/routing tests pass.
- Office hours are **Monday–Friday 08:00–18:00 Asia/Dubai**, not 09:00–18:00. Weekend enquiries must still notify Sales/Account Managers. Office hours must not become a notification quiet-hours rule.
- On assignment, notify the responsible manager. The local backend now inserts a retry-safe in-app alert for the selected owner, or available queue members when no owner is selected, and respects in-app opt-outs. The workspace header now exposes the inbox/unread count and opens the linked enquiry; focused tests pass. A synthetic enquiry assigned to the local QA owner yielded an alert visible in the browser. The saved disposable QA session expired before a second browser pass could verify the read action, which has a focused UI test. **This was not a live Palm recipient receipt.** Current default `new_enquiry_assignment` automation assigns and creates a response task but has no external send-notification step. Email uses the Google Workspace connector; no end-to-end internal WhatsApp or FCM push delivery is proven. Provider setup and an actual test receipt are required before promising any external channel.
- If no call is logged or note added within one elapsed hour, the lead should be offered to another eligible Sales/Account Manager; when none is available, it must return visibly to the team queue, with audit history and alert. The existing SLA breach only escalates the same owner's task; it does not transfer ownership. A note can prevent takeover without being counted as a verified customer response, so this needs a separate engagement check. This acceptance case is **open**.
- `workspace_team_members` does not currently imply `member_roles` or `crm_queue_members`. Team-based access inheritance is therefore **open**, and manual per-person permissions must not be presented as the intended final onboarding flow.
