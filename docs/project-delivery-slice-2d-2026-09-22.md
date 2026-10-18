# Slice 2D — decision image and PDF evidence

Receipt, receipt QC, task inspection and signed acceptance dialogs support selecting existing record attachments and uploading images/PDFs directly through the existing project file service. Notes remain required. Uploading saves an internal record attachment; submitting a decision snapshots only selected evidence (id, name, MIME type, bytes and SHA-256). Cancelling a decision leaves uploaded files in Files and does not approve work.

Server validates that every selected file belongs to the exact order/task/handover in the current project. At most 20 attachments per decision. Snapshots are server-derived, never client-supplied. File links use existing authenticated access; attaching evidence does not publish it to the client. Receipt QC and task inspection history display the selected files; signed acceptance shows its evidence separately from the reviewed pack.

The upload updates the local project revision before submission. Upload failures preserve notes/selections and block concurrent decision submission. The existing 10 MB, image/PDF validation and file-id replay controls apply. These changes do not add quantity-level QC or handover acceptance; those remain next.

Validation with 2E: focused file ownership/snapshot and receipt command tests, component upload success/failure tests, and desktop/mobile mocked upload checks pass. Notes remain after upload, selected file is checked, and evidence links stay authenticated. Mobile screenshots inspected after spacing corrections. No real files were uploaded to a customer project.
