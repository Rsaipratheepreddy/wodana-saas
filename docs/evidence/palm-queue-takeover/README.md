# Palm queue, team access and takeover

Local acceptance evidence for P02.2 on 18 September 2026. This slice uses synthetic, disposable data only. It does not deploy, modify Palm Living data, send a real email/WhatsApp message, or claim provider delivery.

## Accepted operating policy

The Palm operations profile in `docs/fixtures/palm-crm-intake-profile.json` records the exact local policy:

- company enquiries enter the **Sales and account managers** queue;
- staff-created enquiries may select a named active owner only when that person has effective enquiry and follow-up permissions and belongs to the selected queue;
- queue membership and CRM access may be inherited from the Sales team, rather than configured person by person;
- assignment creates an immediate in-app notification, including on weekends;
- the first-response SLA uses the `Asia/Dubai` calendar, Monday–Friday, 08:00–18:00;
- ownership takeover uses 60 elapsed minutes, including outside office hours;
- a due unanswered enquiry moves to the next eligible available owner and retains an assignment audit reason; and
- a logged call or note stops ownership takeover, while an internal note does not falsely satisfy customer-response SLA.

Email and WhatsApp assignment delivery remain explicitly unconnected. The working local channel is the in-app inbox; provider-backed channels belong to P07/P09.

## Permission and routing guarantees

Named-owner assignment now verifies the same effective permissions used by the rest of CRM. Direct and team-inherited roles are both supported. When a queue is selected, the owner must also be an effective, available queue member and must not be marked away. This prevents a staff-created enquiry from being assigned to an unrelated active workspace member.

The synthetic Palm run creates a Sales role, attaches it and the queue to a team, and adds the second-role actor through the team only. It then proves the inherited role and queue membership, assigns a staff-created enquiry to that named actor, reads the enquiry as that actor, and later removes the team access to confirm permission revocation.

## Verification

The following checks passed:

- Business Core focused run: 4 files, 37 tests covering eligibility, inherited queue membership, weekend delivery, business-calendar math and takeover behavior;
- Business Core TypeScript check;
- web focused run: 2 files, 6 tests covering the elapsed-takeover explanation and the exact Palm weekday SLA label;
- web TypeScript check and touched-file ESLint;
- Python worker source compilation, with the worker polling SLA, takeover, sequences, notifications and waits in order;
- raw-control scan of the changed feature UI returned no raw `table`, `button`, `input` or `select` markup;
- `npm run test:smoke:palm-fixture` passed against a fresh migrated loopback database and cleaned the disposable database on exit; and
- the fresh smoke proved `palmSalesTeamInherited`, `staffNamedOwnerEligible`, `immediateAssignmentNotificationSafe`, `elapsedTakeoverSafe`, `noteStopsTakeoverNotSla` and `palmBusinessHoursSlaExact`.

The local browser shell and CRM navigation were inspected, but its previous interactive tenant session had expired before the final content capture. The exact changed UI states are therefore accepted through their component tests rather than mislabeled as a signed-in visual run.

## Remaining boundaries

P02.3 owns the web/native response workspace: assigned enquiry, full provenance, contact actions, call/note/follow-up, next action and honest delivery failure states. P02.4 owns qualified handoff into Opportunity and Job/Discovery. Real Palm people, provider receipts, physical devices, clone/live migration and deployment remain P09 release work.
