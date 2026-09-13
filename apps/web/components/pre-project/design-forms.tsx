"use client";
import { useState } from "react";
import { Button, SelectField } from "@/design-system";
import {
  caseRequest,
  designPayload,
  documentTypes,
  type CaseAsset,
  type CaseContent,
  type CaseDesign,
  type DesignFolder,
  type DesignOptions,
} from "@/lib/pre-project/content";
import { AssetFiles, AssetUpload, CaseModal } from "./case-controls";
import {
  folderSelection,
  matchingFolder,
  type FolderKind,
} from "@/lib/pre-project/design-folders";
import styles from "./case-content.module.css";

export function FolderEditor({
  data,
  initial,
  folders,
  onClose,
  onSaved,
}: {
  data: CaseContent;
  initial: DesignFolder;
  folders: DesignFolder[];
  onClose: () => void;
  onSaved: (folder: DesignFolder) => void;
}) {
  const initialKind: FolderKind = initial.scopeEntryId
    ? initial.name ===
      (initial.scopeTitle ??
        data.entries.find((e) => e.id === initial.scopeEntryId)?.title)
      ? "item"
      : "room-item"
    : "room";
  const [kind, setKind] = useState<FolderKind>(initialKind);
  const [roomId, setRoomId] = useState(initial.roomId);
  const [itemId, setItemId] = useState(initial.scopeEntryId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requirements = data.entries.filter(
    (e) =>
      e.kind === "requirement" &&
      !e.archivedAt &&
      (kind === "item" || e.roomId === roomId),
  );
  const selection = folderSelection(data, kind, roomId, itemId);
  const duplicate = selection.valid
    ? matchingFolder(folders, selection, initial.id)
    : undefined;
  return (
    <CaseModal
      size="md"
      title={initial.version ? "Edit design folder" : "New design folder"}
      description="Choose a room, an item, or both. The folder name is automatic."
      onClose={onClose}
      busy={busy}
      dirty={
        kind !== initialKind ||
        roomId !== initial.roomId ||
        itemId !== initial.scopeEntryId
      }
      footer={
        <Button
          type="submit"
          form="folder-form"
          variant="primary"
          isLoading={busy}
          isDisabled={!selection.valid || Boolean(duplicate)}
        >
          {initial.version ? "Save folder" : "Create folder"}
        </Button>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <form
        id="folder-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selection.valid || duplicate) return;
          setBusy(true);
          setError("");
          try {
            const { name, roomId, scopeEntryId } = selection;
            onSaved(
              await caseRequest<DesignFolder>(
                data.workspaceId,
                data.caseId,
                "design-folders",
                "PUT",
                {
                  id: initial.id,
                  version: initial.version,
                  name,
                  roomId,
                  scopeEntryId,
                  description: initial.description,
                },
              ),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save folder.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField
          label="Folder for"
          selectedKey={kind}
          isDisabled={busy}
          items={[
            { id: "room", label: "Room" },
            { id: "item", label: "Item" },
            { id: "room-item", label: "Room + item" },
          ]}
          onSelectionChange={(key) => {
            if (key) {
              setKind(String(key) as FolderKind);
              setItemId(null);
              setError("");
            }
          }}
        />
        {kind !== "item" && (
          <>
            <SelectField
              label="Room"
              placeholder="Choose a room"
              selectedKey={roomId}
              isDisabled={busy || !data.rooms.length}
              items={data.rooms.map((r) => ({ id: r.id, label: r.name }))}
              onSelectionChange={(key) => {
                setRoomId(key ? String(key) : null);
                setItemId(null);
                setError("");
              }}
            />
            {!data.rooms.length && (
              <p className={styles.muted}>
                No rooms yet. Add a room in Requirements first.
              </p>
            )}
          </>
        )}
        {kind !== "room" && (
          <>
            <SelectField
              label="Item"
              placeholder={
                kind === "room-item" && !roomId
                  ? "Choose a room first"
                  : "Choose an item"
              }
              selectedKey={itemId}
              isDisabled={busy || !requirements.length}
              items={requirements.map((e) => ({
                id: e.id,
                label:
                  kind === "item" && e.roomId
                    ? `${e.title} · ${data.rooms.find((r) => r.id === e.roomId)?.name ?? "Room"}`
                    : e.title,
              }))}
              onSelectionChange={(key) => {
                setItemId(key ? String(key) : null);
                setError("");
              }}
            />
            {!requirements.length && (kind === "item" || roomId) && (
              <p className={styles.muted}>
                No items {roomId && kind === "room-item" ? "in this room " : ""}
                yet. Add an item in Requirements first.
              </p>
            )}
          </>
        )}
        {selection.valid && (
          <p className={styles.muted}>
            Folder name: <strong>{selection.name}</strong>
          </p>
        )}
        {duplicate && (
          <p role="status" className={styles.notice}>
            This folder already exists: {duplicate.name}. Close this form to
            open it from the folder list.
          </p>
        )}
      </form>
    </CaseModal>
  );
}

export function DesignUpload({
  data,
  folder,
  onClose,
  onSaved,
}: {
  data: CaseContent;
  folder: DesignFolder;
  onClose: () => void;
  onSaved: (designs: CaseDesign[]) => void;
}) {
  const [files, setFiles] = useState<
    Array<{
      id: string;
      versionId: string;
      title: string;
      documentType: string;
      note: string;
      asset: CaseAsset;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || uploading;
  const save = async () => {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await caseRequest<{ items: CaseDesign[] }>(
        data.workspaceId,
        data.caseId,
        "designs/upload",
        "POST",
        {
          folderId: folder.id,
          roomId: folder.roomId,
          scopeEntryId: folder.scopeEntryId,
          note: "",
          files: files.map((f) => ({
            id: f.id,
            versionId: f.versionId,
            assetId: f.asset.id,
            title: f.title,
            documentType: f.documentType,
            note: f.note,
          })),
        },
      );
      onSaved(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save files.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <CaseModal
      title="Add design files"
      description={folder.name}
      onClose={onClose}
      busy={disabled}
      dirty={files.length > 0}
      footer={
        <Button
          variant="primary"
          isLoading={busy}
          isDisabled={!files.length || uploading}
          onPress={() => void save()}
        >
          Save {files.length || ""} {files.length === 1 ? "file" : "files"}
        </Button>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <AssetUpload
        currentCount={files.length}
        workspaceId={data.workspaceId}
        caseId={data.caseId}
        disabled={disabled}
        onBusy={setUploading}
        onError={setError}
        onUploaded={(asset) =>
          setFiles((f) => [
            ...f,
            {
              id: crypto.randomUUID(),
              versionId: crypto.randomUUID(),
              asset,
              title: asset.name.slice(0, 240),
              documentType: "2D floor plan",
              note: "",
            },
          ])
        }
      />
      {files.map((f) => (
        <fieldset className={styles.divider} disabled={disabled} key={f.id}>
          <legend>{f.asset.name}</legend>
          <AssetFiles
            workspaceId={data.workspaceId}
            caseId={data.caseId}
            assets={[f.asset]}
            onRemove={
              !disabled
                ? () =>
                    setFiles((rows) => rows.filter((row) => row.id !== f.id))
                : undefined
            }
          />
          <SelectField
            label="Design type"
            selectedKey={f.documentType}
            items={documentTypes.map((id) => ({ id, label: id }))}
            onSelectionChange={(key) =>
              key &&
              setFiles((rows) =>
                rows.map((row) =>
                  row.id === f.id ? { ...row, documentType: String(key) } : row,
                ),
              )
            }
          />
          <label>
            Note · optional
            <textarea
              rows={2}
              maxLength={5000}
              value={f.note}
              onChange={(e) =>
                setFiles((rows) =>
                  rows.map((row) =>
                    row.id === f.id ? { ...row, note: e.target.value } : row,
                  ),
                )
              }
            />
          </label>
        </fieldset>
      ))}
    </CaseModal>
  );
}

export function DesignMetadata({
  data,
  design,
  folders,
  onClose,
  onSaved,
}: {
  data: CaseContent;
  design: CaseDesign;
  folders: DesignFolder[];
  onClose: () => void;
  onSaved: (d: CaseDesign) => void;
}) {
  const [draft, setDraft] = useState(design);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = Boolean(
    design.versions[0] && design.versions[0].status !== "draft",
  );
  const types = (documentTypes as readonly string[]).includes(
    draft.documentType,
  )
    ? documentTypes
    : [draft.documentType, ...documentTypes];
  const dirty =
    JSON.stringify(designPayload(draft)) !==
    JSON.stringify(designPayload(design));
  return (
    <CaseModal
      size="md"
      title="Edit file details"
      description={design.versions[0]?.asset.name ?? design.title}
      onClose={onClose}
      busy={busy}
      dirty={dirty}
      footer={
        <Button
          type="submit"
          form="design-details"
          variant="primary"
          isLoading={busy}
          isDisabled={!dirty || locked}
        >
          Save details
        </Button>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <form
        id="design-details"
        onSubmit={async (e) => {
          e.preventDefault();
          if (locked || busy) return;
          setBusy(true);
          setError("");
          try {
            onSaved(
              await caseRequest<CaseDesign>(
                data.workspaceId,
                data.caseId,
                "designs",
                "PUT",
                designPayload(draft),
              ),
            );
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Could not save. Your changes are still here.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField
          label="Folder"
          isDisabled={busy || locked}
          selectedKey={draft.folderId ?? "unfiled"}
          items={[
            { id: "unfiled", label: "Unfiled" },
            ...folders.map((f) => ({ id: f.id, label: f.name })),
          ]}
          onSelectionChange={(key) => {
            if (!key) return;
            const folder = folders.find((f) => f.id === key);
            setDraft((d) => ({
              ...d,
              folderId: folder?.id ?? null,
              roomId: folder?.roomId ?? null,
              scopeEntryId: folder?.scopeEntryId ?? null,
            }));
          }}
        />
        <SelectField
          label="Design type"
          isDisabled={busy || locked}
          selectedKey={draft.documentType}
          items={types.map((id) => ({ id, label: id }))}
          onSelectionChange={(key) =>
            key && setDraft((d) => ({ ...d, documentType: String(key) }))
          }
        />
        <label>
          Note
          <textarea
            rows={3}
            maxLength={5000}
            disabled={busy || locked}
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </label>
        {locked && (
          <p className={styles.muted}>
            This revision has entered review. Upload a new revision before
            changing its details.
          </p>
        )}
      </form>
    </CaseModal>
  );
}

export function RevisionUpload({
  data,
  design,
  onClose,
  onSaved,
}: {
  data: CaseContent;
  design: CaseDesign;
  onClose: () => void;
  onSaved: (d: CaseDesign) => void;
}) {
  const [asset, setAsset] = useState<CaseAsset | null>(null);
  const [note, setNote] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  return (
    <CaseModal
      size="md"
      title={`Upload revision ${(design.versions[0]?.number ?? 0) + 1}`}
      description={design.title}
      onClose={onClose}
      busy={busy || uploading}
      dirty={Boolean(asset || note)}
      footer={
        <Button
          variant="primary"
          isLoading={busy}
          isDisabled={!asset || uploading}
          onPress={async () => {
            if (!asset) return;
            setBusy(true);
            try {
              onSaved(
                await caseRequest<CaseDesign>(
                  data.workspaceId,
                  data.caseId,
                  `designs/${design.id}/versions`,
                  "POST",
                  { id, version: design.version, assetId: asset.id, note },
                ),
              );
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not save revision.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save draft revision
        </Button>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {asset ? (
        <AssetFiles
          workspaceId={data.workspaceId}
          caseId={data.caseId}
          assets={[asset]}
          onRemove={!busy ? () => setAsset(null) : undefined}
        />
      ) : (
        <AssetUpload
          workspaceId={data.workspaceId}
          caseId={data.caseId}
          multiple={false}
          disabled={busy}
          onBusy={setUploading}
          onError={setError}
          onUploaded={setAsset}
        />
      )}
      <label>
        What changed?
        <textarea
          rows={3}
          maxLength={5000}
          disabled={busy || uploading}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p className={styles.muted}>
        Earlier files and decisions stay in history. This revision begins a new
        review.
      </p>
    </CaseModal>
  );
}

export const reviewActionLabels: Record<string, string> = {
  comment: "Add comment",
  internal_review: "Send for review",
  internal_approved: "Approve",
  client_review: "Send to client",
  approved: "Client approved",
  changes_requested: "Reject / remarks",
};
export function DesignReview({
  data,
  design,
  options,
  action,
  onClose,
  onSaved,
}: {
  data: CaseContent;
  design: CaseDesign;
  options: DesignOptions;
  action: string;
  onClose: () => void;
  onSaved: (d: CaseDesign) => void;
}) {
  const [note, setNote] = useState("");
  const defaultReviewer =
    options.reviewers.length === 1 ? options.reviewers[0].id : null;
  const [reviewer, setReviewer] = useState<string | null>(defaultReviewer);
  const [contextConfirmed, setContextConfirmed] = useState(false);
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = design.versions[0];
  const sending = action === "client_review";
  const portalBlocked =
    sending &&
    options.portal &&
    (!options.portal.enabled || !options.portal.hasApprover);
  const valid =
    Boolean(latest) &&
    !portalBlocked &&
    (action !== "internal_review" || Boolean(reviewer)) &&
    (action !== "internal_review" || contextConfirmed) &&
    (action !== "changes_requested" || Boolean(note.trim()));
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await caseRequest<CaseDesign>(
          data.workspaceId,
          data.caseId,
          "designs/" + design.id + "/activity",
          "POST",
          {
            id,
            version: design.version,
            versionId: latest.id,
            action,
            note,
            decisionBy: "",
            ...(action === "internal_review" ? { reviewerId: reviewer } : {}),
            ...(action === "internal_review" ? { contextConfirmed } : {}),
          },
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save review. Your remarks are still here.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <CaseModal
      size="md"
      title={reviewActionLabels[action]}
      description={design.title + " · Revision " + latest.number}
      onClose={onClose}
      busy={busy}
      dirty={Boolean(note || reviewer !== defaultReviewer)}
      footer={
        <Button
          type="submit"
          form="design-review"
          variant="primary"
          isLoading={busy}
          isDisabled={!valid}
        >
          {reviewActionLabels[action]}
        </Button>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <form
        id="design-review"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {action === "internal_review" && (
          <>
            <dl className={styles.reviewContext}>
              <div><dt>File</dt><dd>{latest.asset.name}</dd></div>
              <div><dt>Design type</dt><dd>{design.documentType}</dd></div>
              <div><dt>Room</dt><dd>{design.roomName || "Whole project"}</dd></div>
              <div><dt>Item</dt><dd>{design.scopeTitle || "General design"}</dd></div>
            </dl>
            <SelectField
              label="Internal reviewer"
              isRequired
              isDisabled={busy}
              selectedKey={reviewer}
              items={options.reviewers.map((r) => ({
                id: r.id,
                label: r.name,
              }))}
              onSelectionChange={(key) => setReviewer(key ? String(key) : null)}
            />
            <p className={styles.muted}>
              The selected reviewer can approve this revision or request
              changes.
            </p>
            <label className={styles.confirmation}>
              <input
                type="checkbox"
                checked={contextConfirmed}
                disabled={busy}
                onChange={(event) => setContextConfirmed(event.target.checked)}
              />
              <span>I checked the preview and it matches this folder, room, item and design type.</span>
            </label>
          </>
        )}
        {portalBlocked ? (
          <p role="alert" className={styles.notice}>
            {!options.portal?.enabled
              ? "Enable the client portal before sending designs."
              : "Add an active client approver before sending designs."}{" "}
            <a
              href={
                "/workspace/pre-projects/cases/" +
                data.caseId +
                  "/client-portal"
              }
            >
              Set up client access
            </a>
          </p>
        ) : (
          sending && (
            <p className={styles.muted}>
              This exact revision will be available in the client portal. The
              client can approve it or request changes. Share the portal link
              with them; this does not send a notification.
            </p>
          )
        )}
        <label>
          {action === "changes_requested"
            ? "Changes needed"
            : "Review note · optional"}
          <textarea
            required={action === "changes_requested"}
            maxLength={5000}
            rows={3}
            disabled={busy}
            placeholder={
              action === "changes_requested"
                ? "Tell the designer what needs to change."
                : "Add context if needed."
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {sending && options.portal?.enabled && options.portal.slug && (
          <a
            href={"/portal/" + encodeURIComponent(options.portal.slug)}
            target="_blank"
            rel="noreferrer"
          >
            Open client portal ↗
          </a>
        )}
        {action === "internal_approved" && (
          <p className={styles.muted}>
            This approves the internal review only. You can send it to the
            client next.
          </p>
        )}
      </form>
    </CaseModal>
  );
}
