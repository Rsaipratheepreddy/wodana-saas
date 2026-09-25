"use client";
import { useState } from "react";
import { ArrowLeft, Download, Upload } from "lucide-react";
import { Button, IconMenuButton, SelectField, useConfirmationDialog } from "@/design-system";
import {
  caseApi,
  caseRequest,
  designPayload,
  designRoundLabel,
  type CaseContent,
  type CaseDesign,
  type DesignOptions,
} from "@/lib/pre-project/content";
import { designStateLabels } from "@/lib/pre-project/design-workflow";
import { FileCover } from "./design-file-preview";
import {
  DesignMetadata,
  DesignReview,
  RevisionUpload,
  reviewActionLabels,
} from "./design-forms";
import { DesignComments } from "./design-comments";
import { CaseModal } from "./case-controls";
import styles from "./case-content.module.css";
import view from "./designs.module.css";

export function DesignFileDetails({
  data,
  design,
  folderName,
  options,
  backLabel = "Files",
  onClose,
  onUpdate,
  onReviewed,
}: {
  data: CaseContent;
  design: CaseDesign;
  folderName: string;
  options: DesignOptions;
  backLabel?: string;
  onClose: () => void;
  onUpdate: (design: CaseDesign) => void;
  onReviewed: (design: CaseDesign) => void;
}) {
  const latest = design.versions[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [upload, setUpload] = useState(false);
  const [editing, setEditing] = useState(false);
  const [compare, setCompare] = useState(false);
  const [comparisonVersionId, setComparisonVersionId] = useState<string | null>(
    design.versions.find((candidate) => candidate.id !== latest?.id)?.id ?? null,
  );
  const [archive, setArchive] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [commentDirty, setCommentDirty] = useState(false);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  // Keep the revision being read (and its unsent comment) if a colleague uploads another.
  const [versionId, setVersionId] = useState<string | null>(latest?.id ?? null);
  const version = design.versions.find((v) => v.id === versionId) ?? latest;
  const comparisonVersion = design.versions.find(
    (candidate) => candidate.id === comparisonVersionId,
  );
  const current = version?.id === latest?.id;
  const writable = data.canEdit && !design.archivedAt && current;
  const editable = writable && (!latest || latest.status === "draft");
  const canReview =
    options.canReview &&
    (!latest?.reviewerId || latest.reviewerId === options.actorId);
  const actions = !writable
    ? []
    : ((
        {
          draft: ["internal_review"],
          internal_review: canReview
            ? ["changes_requested", "internal_approved"]
            : [],
          internal_approved: ["client_review"],
        } as Record<string, string[]>
      )[latest?.status ?? ""] ?? []);
  const leave = (action: () => void) => {
    if (!commentDirty) { action(); return; }
    requestConfirmation({ title: "Discard your unsent comment?", body: "The comment has not been posted and will be lost.", confirmLabel: "Discard comment", onConfirm: action });
  };
  const reviewer =
    options.reviewers.find((r) => r.id === latest?.reviewerId)?.name ??
    "the assigned reviewer";
  const hint = !current
    ? "Earlier revision — kept for reference. Decisions apply to the latest revision."
    : design.archivedAt
      ? "Archived. Restore this file to continue working on it."
      : ((
          {
            draft: options.reviewers.length
              ? "Ready when you are. Send this revision for internal review."
              : "No internal reviewers are available. Ask a workspace administrator to grant design review permission.",
            internal_review: canReview
              ? "Review the file, then approve it or request changes with remarks."
              : "Waiting for " + reviewer + " to review this revision.",
            internal_approved:
              "Internal review complete. Send this revision to the client for approval.",
            client_review:
              "Waiting for the client’s decision in their portal. This screen updates automatically.",
            expired:
              "The client review window expired without a decision. Upload a new revision when it is ready to review again.",
            changes_requested:
              "Read the remarks, then upload a new revision to send for review again.",
            approved:
              "Approved by the client. This revision and its decision are kept in history.",
          } as Record<string, string>
        )[latest?.status ?? ""] ?? "Upload a file to start.");
  const state = !current && version ? "superseded" : (version?.status ?? "no_file");
  const source = [
    design.roomName ? `Room: ${design.roomName}` : "",
    design.scopeTitle ? `Item: ${design.scopeTitle}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={view.fileDetail}>
      <header className={view.compactFileHeader}>
        <Button
          variant="quiet"
          size="compact"
          aria-label={`Back to ${backLabel.toLowerCase()}`}
          onPress={() => leave(onClose)}
        >
          <ArrowLeft size={15} />
          <span>{backLabel}</span>
        </Button>
        <div>
          <h1 title={version?.asset.name ?? design.title}>
            {version?.asset.name ?? design.title}
          </h1>
          <small>{folderName}</small>
        </div>
        <div className={view.compactFileActions}>
          {writable && latest?.status === "changes_requested" && (
            <Button
              variant="primary"
              size="compact"
              onPress={() => leave(() => setUpload(true))}
            >
              <Upload size={14} />
              Upload revised file
            </Button>
          )}
          {actions.map((action) => (
            <Button
              key={action}
              size="compact"
              variant={action === "changes_requested" ? "secondary" : "primary"}
              isDisabled={
                busy ||
                (action === "internal_review" && !options.reviewers.length)
              }
              onPress={() => setReview(action)}
            >
              {reviewActionLabels[action]}
            </Button>
          ))}
        </div>
      </header>
      <div className={view.revisionBar}>
        {design.versions.length > 1 ? (
          <SelectField
            label="Revision"
            selectedKey={version?.id}
            items={design.versions.map((v) => ({
              id: v.id,
              label:
                "R" +
                v.number +
                (v.id === latest.id ? " · Latest" : "") +
                " · " +
                (v.id === latest.id
                  ? (designStateLabels[v.status] ?? v.status)
                  : `Superseded · ${designStateLabels[v.status] ?? v.status}`),
            }))}
            onSelectionChange={(key) =>
              key && leave(() => setVersionId(String(key)))
            }
          />
        ) : (
          <small>
            {version ? "Revision " + version.number : "No revision"}
          </small>
        )}
        <span
          className={view.status}
          data-status={design.archivedAt ? "archived" : state}
        >
          {design.archivedAt ? "Archived" : (designStateLabels[state] ?? state)}
        </span>
        <div className={view.revisionActions}>
          {version && design.versions.length > 1 && (
            <Button
              variant="quiet"
              size="compact"
              onPress={() => {
                setComparisonVersionId(
                  design.versions.find((candidate) => candidate.id !== version.id)
                    ?.id ?? null,
                );
                setCompare(true);
              }}
            >
              Compare revisions
            </Button>
          )}
          {version && (
            <a
              className={view.originalFile}
              href={caseApi(
                data.workspaceId,
                data.caseId,
                "assets/" + version.asset.id,
              )}
              download
            >
              <Download size={14} />
              Download
            </a>
          )}
          {data.canEdit && (
            <IconMenuButton
              ariaLabel="File actions"
              items={[
                ...(editable ? [{ id: "edit", label: "Edit details" }] : []),
                ...(!design.archivedAt
                  ? [
                      {
                        id: "revision",
                        label: "Upload new revision",
                        isDisabled: !current,
                      },
                    ]
                  : []),
                {
                  id: "archive",
                  label: design.archivedAt ? "Restore file" : "Archive file",
                  isDisabled: busy,
                },
              ]}
              onAction={(id) => {
                if (id === "edit") setEditing(true);
                if (id === "revision") leave(() => setUpload(true));
                if (id === "archive") setArchive(true);
              }}
            />
          )}
        </div>
      </div>
      <p className={view.fileHint} data-status={state}>
        {hint}
        {!current && (
          <Button
            variant="quiet"
            size="compact"
            onPress={() => leave(() => setVersionId(null))}
          >
            View latest revision
          </Button>
        )}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="wd-visually-hidden">
          {message}
        </p>
      )}
      <div className={view.simpleFileBody}>
        <section aria-label="Design file" className={view.fileWorkspace}>
          {version ? (
            <div className={view.canvas}>
              {version.asset.mimeType === "application/pdf" ? (
                <iframe
                  className={view.pdfViewer}
                  title={version.asset.name}
                  src={
                    caseApi(
                      data.workspaceId,
                      data.caseId,
                      "assets/" + version.asset.id + "?view=1",
                    ) + "#navpanes=0&view=FitH"
                  }
                />
              ) : (
                <FileCover
                  key={version.id}
                  data={data}
                  design={{ ...design, versions: [version] }}
                  full
                />
              )}
            </div>
          ) : (
            <div className={view.empty}>
              <p>No file uploaded yet.</p>
              {writable && (
                <Button onPress={() => setUpload(true)}>Add file</Button>
              )}
            </div>
          )}
          {writable && latest && latest.status !== "changes_requested" && (
            <Button
              variant="quiet"
              size="compact"
              onPress={() => leave(() => setUpload(true))}
            >
              <Upload size={14} />
              New revision
            </Button>
          )}
        </section>
        <aside
          className={view.fileSidebar}
          aria-label="File details and comments"
        >
          <div className={view.metadataHeading}>
            <h2>File details</h2>
            {editable && (
              <Button
                size="compact"
                variant="quiet"
                onPress={() => setEditing(true)}
              >
                Edit details
              </Button>
            )}
          </div>
          <dl className={view.fileMetadata}>
            <dt>Design type</dt>
            <dd>{design.documentType}</dd>
            <dt>Revision &amp; author</dt>
            <dd>
              {version
                ? `R${version.number} · ${version.createdByName}`
                : "No revision"}
            </dd>
            <dt>Source</dt>
            <dd>{source || folderName || "Unfiled"}</dd>
            <dt>Client review rounds</dt>
            <dd>
              {designRoundLabel(
                design.clientRoundsUsed ?? 0,
                version?.includedClientRounds,
              )}
            </dd>
            <dt>Note</dt>
            <dd>
              {(current ? design.description : version?.note) ||
                "No note added."}
            </dd>
          </dl>
          {version && (
            <DesignComments
              key={version.id}
              data={data}
              design={design}
              revision={version}
              onUpdate={onUpdate}
              onDraftChange={setCommentDirty}
            />
          )}
        </aside>
      </div>
      {compare && version && comparisonVersion && (
        <CaseModal
          title="Compare revisions"
          description={`${design.title} · R${version.number} and R${comparisonVersion.number}`}
          onClose={() => setCompare(false)}
        >
          <SelectField
            label={`Compare R${version.number} with`}
            selectedKey={comparisonVersion.id}
            items={design.versions
              .filter((candidate) => candidate.id !== version.id)
              .map((candidate) => ({
                id: candidate.id,
                label: `R${candidate.number} · ${designStateLabels[candidate.status] ?? candidate.status}`,
              }))}
            onSelectionChange={(key) =>
              key && setComparisonVersionId(String(key))
            }
          />
          <div className={view.comparisonGrid}>
            {[version, comparisonVersion].map((candidate) => (
              <section
                className={view.comparisonPanel}
                aria-label={`Revision ${candidate.number} comparison`}
                key={candidate.id}
              >
                <header>
                  <div>
                    <strong>R{candidate.number}</strong>
                    <small>{candidate.createdByName}</small>
                  </div>
                  <span className={view.status} data-status={candidate.status}>
                    {designStateLabels[candidate.status] ?? candidate.status}
                  </span>
                </header>
                <div className={view.comparisonCanvas}>
                  {candidate.asset.mimeType === "application/pdf" ? (
                    <iframe
                      className={view.pdfViewer}
                      title={`${candidate.asset.name} revision ${candidate.number}`}
                      src={
                        caseApi(
                          data.workspaceId,
                          data.caseId,
                          `assets/${candidate.asset.id}?view=1`,
                        ) + "#navpanes=0&view=FitH"
                      }
                    />
                  ) : (
                    <FileCover
                      data={data}
                      design={{ ...design, versions: [candidate] }}
                      full
                    />
                  )}
                </div>
                <p>{candidate.note || "No revision note."}</p>
              </section>
            ))}
          </div>
        </CaseModal>
      )}
      {editing && (
        <DesignMetadata
          data={data}
          design={design}
          folders={options.folders}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            onUpdate(saved);
            setEditing(false);
            setMessage("Details saved.");
          }}
        />
      )}
      {review && (
        <DesignReview
          data={data}
          design={design}
          options={options}
          action={review}
          onClose={() => setReview(null)}
          onSaved={(saved) => {
            setReview(null);
            onReviewed(saved);
            setMessage(
              saved.versions[0]?.status === "internal_approved"
                ? "Internal review approved. Ready to send to the client."
                : saved.versions[0]?.status === "changes_requested"
                  ? "Changes requested. Remarks saved with this revision."
                  : saved.versions[0]?.status === "client_review"
                    ? "Available in the client portal for approval."
                    : "Sent for internal review.",
            );
          }}
        />
      )}
      {upload && (
        <RevisionUpload
          data={data}
          design={design}
          onClose={() => setUpload(false)}
          onSaved={(saved) => {
            onUpdate(saved);
            setVersionId(saved.versions[0]?.id ?? null);
            setUpload(false);
            setMessage(
              "New draft revision saved. Earlier files and decisions are preserved.",
            );
          }}
        />
      )}
      {archive && (
        <CaseModal
          size="md"
          title={design.archivedAt ? "Restore file" : "Archive file"}
          description={design.title}
          onClose={() => setArchive(false)}
          busy={busy}
          footer={
            <Button
              variant={design.archivedAt ? "primary" : "danger"}
              isLoading={busy}
              onPress={async () => {
                setBusy(true);
                setError("");
                try {
                  const saved = await caseRequest<CaseDesign>(
                    data.workspaceId,
                    data.caseId,
                    "designs",
                    "PUT",
                    { ...designPayload(design), archived: !design.archivedAt },
                  );
                  onUpdate(saved);
                  setArchive(false);
                  setMessage(
                    saved.archivedAt
                      ? "File archived. It can be restored from Archived in Designs."
                      : "File restored.",
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not update file.",
                  );
                  setArchive(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {design.archivedAt ? "Restore file" : "Archive file"}
            </Button>
          }
        >
          <p>
            {design.archivedAt
              ? "Restore this file with its existing revisions and decisions."
              : "This removes the file from active review queues and the client portal. No files or decisions are deleted."}
          </p>
        </CaseModal>
      )}
      {confirmationDialog}
    </div>
  );
}
