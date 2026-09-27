"use client";
import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  ComboboxField,
  DateField,
  NumericInput,
  SelectField,
  TextAreaField,
  useDesignSystem,
} from "@/design-system";
import { today, type CalendarDate } from "@internationalized/date";
import {
  caseApi, caseRequest,
  blankEntry, entryPayload, type CatalogChoice, type CaseRoom, type ScopeEntry,
  designPayload,
  documentTypes,
  type CaseAsset,
  type CaseContent,
  type CaseDesign,
  type DesignFolder,
  type DesignOptions,
} from "@/lib/pre-project/content";
import { AssetFiles, AssetUpload, CaseModal, CatalogChoiceField } from "./case-controls";
import {
  folderSelection,
  matchingFolder,
  type FolderKind,
} from "@/lib/pre-project/design-folders";
import styles from "./case-content.module.css";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";

export function FolderEditor({
  data: initialData,
  initial,
  folders,
  onClose,
  onSaved,
  onContentChange,
}: {
  data: CaseContent;
  onContentChange?: (data: CaseContent) => void;
  initial: DesignFolder;
  folders: DesignFolder[];
  onClose: () => void;
  onSaved: (folder: DesignFolder) => void;
}) {
  const t = useT();
  const [data, setData] = useState(initialData);
  const [catalogRoom, setCatalogRoom] = useState<CatalogChoice|null>(null);
  const [catalogItem, setCatalogItem] = useState<CatalogChoice|null>(null);
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
  const [newRoomId] = useState(()=>crypto.randomUUID());
  const [newItemId] = useState(()=>crypto.randomUUID());
  const selectedRoomId = kind === 'item' ? null : catalogRoom ? newRoomId : roomId;
  const pendingRoom = catalogRoom ? {id:newRoomId,version:0,name:catalogRoom.name,catalogRecordId:catalogRoom.id} : null;
  const pendingItem = catalogItem ? {...blankEntry(selectedRoomId),id:newItemId,title:catalogItem.name,catalogLinks:[{role:'work',recordId:catalogItem.id,snapshot:catalogItem}]} : null;
  const selection = folderSelection({...data,rooms:pendingRoom?[...data.rooms,pendingRoom]:data.rooms,entries:pendingItem?[...data.entries,pendingItem]:data.entries}, kind, selectedRoomId, pendingItem?.id ?? itemId);
  const duplicate = selection.valid
    ? matchingFolder(folders, selection, initial.id)
    : undefined;
  return (
    <CaseModal
      size="md"
      title={t(initial.version ? "Edit design folder" : "New design folder")}

      onClose={onClose}
      busy={busy}
      dirty={
        Boolean(catalogRoom || catalogItem) || kind !== initialKind ||
        roomId !== initial.roomId ||
        itemId !== initial.scopeEntryId
      }
      footer={
        <Button
          type="submit"
          form="folder-form"
          variant="primary"
          isLoading={busy}
          isDisabled={busy || !data.canEdit || !selection.valid || Boolean(duplicate)}
        >
          {t(initial.version ? "Save folder" : "Create folder")}
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
        style={{display:"grid",gap:16}}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!data.canEdit || busy || !selection.valid || duplicate) return;
          setBusy(true);
          setError("");
          try {
            let next = data;
            if (pendingRoom && !next.rooms.some(r=>r.id===pendingRoom.id)) {
              const saved = await caseRequest<CaseRoom>(data.workspaceId,data.caseId,'rooms','PUT',pendingRoom);
              next={...next,rooms:[...next.rooms,saved]};setData(next);onContentChange?.(next);
            }
            if (pendingItem && !next.entries.some(e=>e.id===pendingItem.id)) {
              const saved = await caseRequest<ScopeEntry>(data.workspaceId,data.caseId,'entries','PUT',entryPayload(pendingItem));
              next={...next,entries:[...next.entries,saved]};setData(next);onContentChange?.(next);
            }
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
            setError(e instanceof Error ? e.message : t("Could not save folder."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField
          label={t("Folder for")}
          selectedKey={kind}
          isDisabled={busy}
          items={[
            { id: "room", label: t("Room") },
            { id: "item", label: t("Item") },
            { id: "room-item", label: t("Room + item") },
          ]}
          onSelectionChange={(key) => {
            if (key) {
              setKind(String(key) as FolderKind);
              setItemId(null);setCatalogItem(null);setCatalogRoom(null);setRoomId(null);
              setError("");
            }
          }}
        />
        {kind !== 'item' && <FolderChoice data={data} kind="room" label={t("Room")} disabled={busy || !data.canEdit} selectedKey={catalogRoom?.id ?? roomId} existing={data.rooms.map(r=>({id:r.id,name:r.name,catalogId:r.catalogRecordId}))} onSelect={(id,choice)=>{setRoomId(choice?null:id);setCatalogRoom(choice);setItemId(null);setCatalogItem(null);}}/>}
        {kind !== 'room' && <FolderChoice data={data} kind="work" label={t("Item")} disabled={busy || !data.canEdit || (kind==='room-item'&&!selectedRoomId)} selectedKey={catalogItem?.id ?? itemId} existing={requirements.map(e=>({id:e.id,name:e.title,catalogId:e.catalogLinks.find(l=>l.role==='work')?.recordId}))} onSelect={(id,choice)=>{setItemId(choice?null:id);setCatalogItem(choice);}}/>}
        {selection.valid && (
          <p className={styles.muted}>
            {t("Folder name:")} <strong>{selection.name}</strong>
          </p>
        )}
        {duplicate && (
          <p role="status" className={styles.notice}>
            {t("This folder already exists: {name}. Close this form to open it from the folder list.", { name: duplicate.name })}
          </p>
        )}
      </form>
    </CaseModal>
  );
}

function FolderChoice({data,kind,label,disabled,selectedKey,existing,onSelect}:{data:CaseContent;kind:string;label:string;disabled:boolean;selectedKey:string|null;existing:Array<{id:string;name:string;catalogId?:string|null}>;onSelect:(id:string|null,choice:CatalogChoice|null)=>void}) {
 const t=useT();
 const [search,setSearch]=useState(''),[items,setItems]=useState<CatalogChoice[]>([]),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>{fetch(caseApi(data.workspaceId,data.caseId,`catalog-options?kind=${kind}&search=${encodeURIComponent(search)}`),{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error(t('Could not load options. Try searching again.'));return r.json();}).then(result=>{setItems(result.items);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});},180);return()=>{clearTimeout(timer);controller.abort();};},[data.workspaceId,data.caseId,kind,search,t]);
 const options=[...existing.map(r=>({id:r.id,label:r.name})),...items.filter(c=>!existing.some(r=>r.catalogId===c.id)).map(c=>({id:c.id,label:c.name}))];
 return <div><ComboboxField label={label} placeholder={t(kind==='room'?'Choose room':'Choose item')} selectedKey={selectedKey} isDisabled={disabled} items={options} onInputChange={setSearch} onSelectionChange={key=>{const id=key?String(key):null;onSelect(id,items.find(c=>c.id===id)??null);}}/>{error&&<small role="alert">{error}</small>}</div>;
}

export type DesignUploadTarget = { folderId: string | null; roomId: string | null; scopeEntryId: string | null; name: string };
export function DesignUpload({
  data,
  folder,
  target,
  onClose,
  onSaved,
}: {
  data: CaseContent;
  /** Legacy folder target; prefer `target` for scope-rooted uploads. */
  folder?: DesignFolder;
  target?: DesignUploadTarget;
  onClose: () => void;
  onSaved: (designs: CaseDesign[]) => void;
}) {
  const t = useT();
  const destination: DesignUploadTarget = target ?? { folderId: folder?.id ?? null, roomId: folder?.roomId ?? null, scopeEntryId: folder?.scopeEntryId ?? null, name: folder?.name ?? t("Whole home") };
  const [files, setFiles] = useState<
    Array<{
      id: string;
      versionId: string;
      title: string;
      documentType: string;
      note: string;
      includedClientRounds: number | null;
      asset: CaseAsset;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || uploading || !data.canEdit;
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
          ...(destination.folderId ? { folderId: destination.folderId } : {}),
          roomId: destination.roomId,
          scopeEntryId: destination.scopeEntryId,
          note: "",
          files: files.map((f) => ({
            id: f.id,
            versionId: f.versionId,
            assetId: f.asset.id,
            title: f.title,
            documentType: f.documentType,
            note: f.note,
            includedClientRounds: f.includedClientRounds,
          })),
        },
      );
      onSaved(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not save files."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <CaseModal
      size="md"
      title={t("Add design files")}
      description={destination.name}
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
          {files.length ? t(files.length === 1 ? "Save {count} file" : "Save {count} files", { count: files.length }) : t("Save files")}
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
              includedClientRounds: null,
            },
          ])
        }
      />
      {files.map((f) => (
        <fieldset className={styles.uploadFile} disabled={disabled} key={f.id} aria-label={f.asset.name}>
          <AssetFiles
            workspaceId={data.workspaceId}
            caseId={data.caseId}
            assets={[f.asset]}
            onMarked={!disabled && files.length < 20 ? (asset) => setFiles((rows) => [
              ...rows,
              {
                id: crypto.randomUUID(),
                versionId: crypto.randomUUID(),
                asset,
                title: t("{title} · marked copy", { title: f.title }).slice(0, 240),
                documentType: f.documentType,
                note: f.note,
                includedClientRounds: f.includedClientRounds,
              },
            ]) : undefined}
            onRemove={
              !disabled
                ? () =>
                    setFiles((rows) => rows.filter((row) => row.id !== f.id))
                : undefined
            }
          />
          <div className={styles.uploadFields}>
          <SelectField
            isDisabled={disabled}
            label={t("Design type")}
            selectedKey={f.documentType}
            items={documentTypes.map((id) => ({ id, label: t(id) }))}
            onSelectionChange={(key) =>
              key &&
              setFiles((rows) =>
                rows.map((row) =>
                  row.id === f.id ? { ...row, documentType: String(key) } : row,
                ),
              )
            }
          />
          <NumericInput
            isDisabled={disabled}
            label={t("Review rounds · optional")}
            description={t("Leave blank for no limit.")}
            minValue={0}
            maxValue={99}
            value={f.includedClientRounds ?? NaN}
            onChange={(value) =>
              setFiles((rows) =>
                rows.map((row) =>
                  row.id === f.id
                    ? {
                        ...row,
                        includedClientRounds: Number.isFinite(value)
                          ? value
                          : null,
                      }
                    : row,
                ),
              )
            }
          />
          </div>
          <TextAreaField
            isDisabled={disabled}
            label={t("Description · optional")}
            maxLength={5000}
            value={f.note}
            onChange={(value) =>
                setFiles((rows) =>
                  rows.map((row) =>
                    row.id === f.id ? { ...row, note: value } : row,
                  ),
                )
            }
          />
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
  const t = useT();
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
      title={t("Edit file details")}
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
          {t("Save details")}
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
                : t("Could not save. Your changes are still here."),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField
          label={t("Folder")}
          isDisabled={busy || locked}
          selectedKey={draft.folderId ?? "unfiled"}
          items={[
            { id: "unfiled", label: t("Unfiled") },
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
          label={t("Design type")}
          isDisabled={busy || locked}
          selectedKey={draft.documentType}
          items={types.map((id) => ({ id, label: translateKnown(t, id) }))}
          onSelectionChange={(key) =>
            key && setDraft((d) => ({ ...d, documentType: String(key) }))
          }
        />
        <NumericInput
          label={t("Included client review rounds")}
          description={t("Leave empty when the agreement does not define a limit.")}
          isDisabled={busy || locked}
          minValue={0}
          maxValue={99}
          value={draft.versions[0]?.includedClientRounds ?? NaN}
          onChange={(value) =>
            setDraft((d) => ({
              ...d,
              versions: d.versions.map((revision, index) =>
                index === 0
                  ? {
                      ...revision,
                      includedClientRounds: Number.isFinite(value)
                        ? value
                        : null,
                    }
                  : revision,
              ),
            }))
          }
        />
        <TextAreaField
          label={t("Note")}
          maxLength={5000}
          isDisabled={busy || locked}
          value={draft.description}
          onChange={(value) =>
            setDraft((d) => ({ ...d, description: value }))
          }
        />
        {locked && (
          <p className={styles.muted}>
            {t("This revision has entered review. Upload a new revision before changing its details.")}
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
  const t = useT();
  const [asset, setAsset] = useState<CaseAsset | null>(null);
  const [note, setNote] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  return (
    <CaseModal
      size="md"
      title={t("Upload revision {number}", { number: (design.versions[0]?.number ?? 0) + 1 })}
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
                e instanceof Error ? e.message : t("Could not save revision."),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Save draft revision")}
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
          onMarked={!busy && !uploading ? setAsset : undefined}
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
      <TextAreaField
        label={t("What changed?")}
        maxLength={5000}
        isDisabled={busy || uploading}
        value={note}
        onChange={setNote}
      />
      <p className={styles.muted}>
        {t("Earlier files and decisions stay in history. This revision begins a new review.")}
      </p>
    </CaseModal>
  );
}

export const reviewActionLabels: Record<string, MessageKey> = {
  comment: tKey("Add comment"),
  internal_review: tKey("Send for review"),
  internal_approved: tKey("Approve"),
  client_review: tKey("Send to client"),
  approved: tKey("Client approved"),
  changes_requested: tKey("Reject / remarks"),
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
  const t = useT();
  const { timeZone } = useDesignSystem();
  const [note, setNote] = useState("");
  const defaultReviewer =
    options.reviewers.length === 1 ? options.reviewers[0].id : null;
  const [reviewer, setReviewer] = useState<string | null>(defaultReviewer);
  const [contextConfirmed, setContextConfirmed] = useState(false);
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewExpiresOn, setReviewExpiresOn] = useState<CalendarDate>(() =>
    today(timeZone).add({ days: 7 }),
  );
  const latest = design.versions[0];
  const actionLabel = reviewActionLabels[action] ? t(reviewActionLabels[action]) : action;
  const sending = action === "client_review";
  const usedRounds = design.clientRoundsUsed ?? 0;
  const includedRounds = latest?.includedClientRounds;
  const overAllowance =
    sending && includedRounds != null && usedRounds >= includedRounds;
  const portalBlocked =
    sending &&
    options.portal &&
    (!options.portal.enabled || !options.portal.hasApprover);
  const valid =
    Boolean(latest) &&
    !portalBlocked &&
    (!sending || Boolean(reviewExpiresOn)) &&
    (!overAllowance || Boolean(note.trim())) &&
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
            ...(sending
              ? {
                  reviewExpiresAt: new Date(
                    reviewExpiresOn.add({ days: 1 }).toDate(timeZone).getTime() - 1,
                  ).toISOString(),
                }
              : {}),
          },
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("Could not save review. Your remarks are still here."),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <CaseModal
      size="md"
      title={actionLabel}
      description={t("{title} · Revision {number}", { title: design.title, number: latest.number })}
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
          {actionLabel}
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
              <div><dt>{t("File")}</dt><dd>{latest.asset.name}</dd></div>
              <div><dt>{t("Design type")}</dt><dd>{translateKnown(t, design.documentType)}</dd></div>
              <div><dt>{t("Room")}</dt><dd>{design.roomName || "—"}</dd></div>
              <div><dt>{t("Item")}</dt><dd>{design.scopeTitle || t("General design")}</dd></div>
            </dl>
            <SelectField
              label={t("Internal reviewer")}
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
              {t("The selected reviewer can approve this revision or request changes.")}
            </p>
            <Checkbox
              isSelected={contextConfirmed}
              isDisabled={busy}
              onChange={setContextConfirmed}
            >
              {t("I checked the preview and it matches this folder, room, item and design type.")}
            </Checkbox>
          </>
        )}
        {portalBlocked ? (
          <p role="alert" className={styles.notice}>
            {t(!options.portal?.enabled
              ? "Enable the client portal before sending designs."
              : "Add an active client approver before sending designs.")}{" "}
            <a
              href={
                "/workspace/pre-projects/cases/" +
                data.caseId +
                  "/client-portal"
              }
            >
              {t("Set up client access")}
            </a>
          </p>
        ) : (
          sending && (
            <>
              <DateField
                label={t("Client decision due")}
                isRequired
                minValue={today(timeZone).add({ days: 1 })}
                value={reviewExpiresOn}
                onChange={(value) => value && setReviewExpiresOn(value as CalendarDate)}
              />
              {overAllowance ? (
                <p role="alert" className={styles.notice}>
                  {t("{used} of {included} included client review rounds are already used. This is a guided exception, not a silent block. Record the approved reason below before continuing.", { used: usedRounds, included: includedRounds ?? 0 })}
                </p>
              ) : null}
              <p className={styles.muted}>
                {t("This exact revision will be available in the client portal until the selected date. The client can approve it, request changes or reject it. Share the portal link with them; this does not claim a notification was sent.")}
              </p>
            </>
          )
        )}
        <TextAreaField
          label={t(
            action === "changes_requested"
              ? "Changes needed"
              : overAllowance
                ? "Approved exception reason"
                : "Review note · optional"
          )}
          isRequired={action === "changes_requested" || overAllowance}
          maxLength={5000}
          isDisabled={busy}
          placeholder={t(
            action === "changes_requested"
              ? "Tell the designer what needs to change."
              : "Add context if needed."
          )}
          value={note}
          onChange={setNote}
        />
        {sending && options.portal?.enabled && options.portal.slug && (
          <a
            href={"/portal/" + encodeURIComponent(options.portal.slug)}
            target="_blank"
            rel="noreferrer"
          >
            {t("Open client portal")} ↗
          </a>
        )}
        {action === "internal_approved" && (
          <p className={styles.muted}>
            {t("This approves the internal review only. You can send it to the client next.")}
          </p>
        )}
      </form>
    </CaseModal>
  );
}
