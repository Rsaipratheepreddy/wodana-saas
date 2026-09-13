# Mobile modules and icon inventory

Reviewed 7 September 2026 against the new web navigation, Business Core modules,
and the older Python backend's module and role definitions.

## Recommended mobile structure

The bottom navigation is **Home, Inbox, Create (+), Notifications, Profile**. The +
button is in the centre. Module access belongs inside Home: **CRM, Pre-project, Projects, HRMS**.
Home implements a two-column grid with visible module names and generated 3D
illustrations, plus local module search. CRM and HRMS open complete native module
workspaces with a return to Home. Inbox is for conversations and Notifications for activity
alerts; both remain blank shells. Profile shows the signed-in account and Sign out.
Create remains an entry point whose actions still need to be designed. The selected
bottom tab expands to show its name over the brand gradient; + never shows a name.
Workspace administration stays in web and is not a mobile navigation item. Show modules and records
according to the active user's server-authorized workspace permissions. The icon
inventory is design metadata, not a capability or permission configuration.

| Module | Mobile scope | Current new-product foundation |
| --- | --- | --- |
| CRM | Today priorities, leads, deals, inbox, people, companies, activities, calendar, sequences, automations, approvals, and reports | Connected to tenant CRM APIs with create/update/complete/send controls, custom WhatsApp replies during Meta's service window, approved-template mode outside it, native date/time pickers, one-tap phone actions, search, filters, loading/error/empty states, and pull-to-refresh. |
| Pre-project | Assigned cases, client brief, site visits, design review, quotations, and approvals | Case list/detail/start APIs exist. Detailed workflows must be checked and connected individually; navigation alone does not establish feature readiness. |
| Projects | Assigned delivery projects, site updates, photos, procurement/material requests, production/installation progress, snagging, and handover | New web currently shows a demo project. New execution APIs and workflows are not implemented as a Projects module in Business Core. |
| HRMS | Personal attendance, leave requests, attendance/leave history, and manager approvals | Connected to the tenant HRMS APIs with check-in/out, photo and location capture, leave requests, history, and team approval controls. |

## Shared shortcuts

These are entry points into module workflows, not six additional business modules.

| Shortcut | First useful mobile behavior | Readiness boundary |
| --- | --- | --- |
| My work | Assigned follow-ups and work due today | Available in CRM Today and Activities; cross-module aggregation is future work. |
| Calendar | Appointments and upcoming follow-ups | Available as the CRM 30-day agenda. Broader project/site scheduling needs its own integration. |
| Inbox | Customer conversations and replies | Available inside CRM with outbound replies, private notes, assignment state, and resolve/reopen. Provider sending still depends on the tenant connection and channel window. |
| Approvals | Review, approve, or reject with context | CRM automation approvals are available in CRM More; a generic cross-module approval center remains future work. |
| Files | Open the current case/project's drawings, photos, and documents | Planned mobile document experience; verify storage, authorization, downloads, and upload contracts per module. |
| Site visits | Open visit details, capture photos, and record observations | Planned mobile field workflow; requires dedicated contracts and camera/location permissions only when used. |

Group these shortcuts inside Home or their owning module instead of adding more
bottom-nav items. CRM notification inbox/read APIs exist; device push registration
and cross-module notifications must be implemented separately. Creation actions
should be scoped to their owning module when those workflows are implemented.

## Delivery order

1. CRM native workflows and HRMS self-service are implemented against Business Core.
2. Add Pre-project case access, then implement its detailed workflows as their APIs become available.
3. Bring Projects field workflows across as the new backend supports them.
4. Add device push and cross-module notification aggregation.

The older backend also contains procurement, inventory, finance, execution,
workforce, reports, and client/vendor portal features. Their presence informs the
roadmap; it does not make them available through the new mobile auth/session.
Initially group buying, materials, progress, and payments under project context;
group employee attendance and leave under HRMS. Keep a client/vendor app experience
separate from this internal workspace flow until that audience is explicitly scoped.

## Icons

Home uses four generated transparent PNG illustrations from the built-in image
generation tool: a contact book (CRM), architectural plans (Pre-project), a house
and hard hat (Projects), and an ID badge with a clock (HRMS). The files and complete
prompts are in `apps/mobile/assets/illustrations/home/`; the card registry is
`apps/mobile/src/components/home-modules.ts`. They are bundled locally.

Eleven original SVG designs share the existing mobile icons' 24-unit grid,
1.7-unit rounded stroke, brand ink, and lilac/rose/peach palette. Each has a brand
and outline variant, without baked-in labels or backgrounds. Use 28–32 points
inside a 48–56-point module tile, and keep the parent tap target at least 48 points.

- Native component: `apps/mobile/src/components/module-icon.tsx`
- Geometry: `apps/mobile/src/components/module-icon-art.ts`
- Exported assets: `apps/mobile/assets/icons/modules/`
- Preview sheet: `apps/mobile/assets/icons/modules/icon-sheet.svg`
- Rebuild exports: `npm run icons:export` from `apps/mobile`

The bottom bar uses familiar Home, Inbox, plus, bell, and user outlines from the shared
`Icon` component, with consistent optical sizing and stroke weight. Inactive
strokes are gray; active strokes are dark over the brand gradient. Icons retain
their size during selection, while the gradient pill slides and expands to fit the label.
The larger branded module-art exports above remain a separate optional asset set.

## Source files

- `apps/web/components/workspace/workspace-navigation.ts`
- `apps/web/components/workspace/workspace-sidebar.tsx`
- `apps/web/components/projects/projects-list-page.tsx`
- `apps/web/app/workspace/hrms/page.tsx`
- `services/business-core/src/app.module.ts`
- `services/business-core/src/pre-projects/pre-projects.module.ts`
- `services/business-core/src/crm/today/crm-today.service.ts`
- `services/business-core/src/crm/notifications/crm-notifications.controller.ts`
- `backend/app/services/module_control_service.py` in the older project root
