"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import {
  designStateLabels,
  designTabHints,
  designTabs,
  inDesignTab,
  mergeDesigns,
  type DesignTab,
} from "@/lib/pre-project/design-workflow";
import { DesignFileDetails } from "./design-file-details";
import { FileCover } from "./design-file-preview";
import {
  ArrowLeft,
  ChevronRight,
  Folder,
  Pencil,
  Plus,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Button, Checkbox, SearchInput, SelectField } from "@/design-system";
import {
  caseRequest,
  type CaseContent,
  type CaseDesign,
  type DesignFolder,
  type DesignOptions,
} from "@/lib/pre-project/content";
import { DesignUpload, FolderEditor } from "./design-forms";
import styles from "./case-content.module.css";
import view from "./designs.module.css";

const emptyOptions: DesignOptions = {
  folders: [],
  reviewers: [],
  actorId: "",
  canReview: false,
  canRecordClient: false,
};
export function DesignsPage({
  initialData,
  initialDesigns,
  options = emptyOptions,
}: {
  initialData: CaseContent;
  initialDesigns: CaseDesign[];
  options?: DesignOptions;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [data, setData] = useState(initialData);
  const [designs, setDesigns] = useState(initialDesigns);
  const [reviewOptions, setReviewOptions] = useState(options);
  const folders = reviewOptions.folders;
  const folderId = params.get("folder");
  const fileId = params.get("file");
  const tab = (
    designTabs.some((t) => t.id === params.get("tab"))
      ? params.get("tab")
      : "designs"
  ) as DesignTab;
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [archived, setArchived] = useState(false);
  const [folderEditor, setFolderEditor] = useState<DesignFolder | null>(null);
  const [upload, setUpload] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = designs.find((d) => d.id === fileId) ?? null;
  const applyListing = useCallback(
    (listing: DesignOptions & { items: CaseDesign[] }) => {
      setDesigns((current) => mergeDesigns(current, listing.items));
      setReviewOptions((current) => ({
        ...listing,
        folders: [
          ...new Map(
            [
              ...current.folders,
              ...listing.folders.map((f) => {
                const previous = current.folders.find((old) => old.id === f.id);
                return previous && previous.version > f.version ? previous : f;
              }),
            ].map((f) => [f.id, f]),
          ).values(),
        ],
      }));
    },
    [],
  );
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const listing = await caseRequest<
          DesignOptions & { items: CaseDesign[] }
        >(initialData.workspaceId, initialData.caseId, "designs");
        if (active) {
          applyListing(listing);
          setError("");
        }
      } catch {
        if (active)
          setError(
            "Could not refresh designs. Your files are still shown below. Try Reload designs.",
          );
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [initialData.workspaceId, initialData.caseId, applyListing]);
  const resetFilters = () => {
    setSearch("");
    setType("all");
    setStatus("all");
    setArchived(false);
  };
  const changeTab = (next: DesignTab) => {
    const query = new URLSearchParams(params.toString());
    query.set("tab", next);
    query.delete("file");
    query.delete("folder");
    window.history.pushState(null, "", pathname + "?" + query);
    resetFilters();
    setMessage("");
  };
  const navigate = (file: string | null, folder: string | null) => {
    const query = new URLSearchParams(params.toString());
    query.set("tab", tab);
    if (file) query.set("file", file);
    else query.delete("file");
    if (folder) query.set("folder", folder);
    else query.delete("folder");
    window.history.pushState(null, "", pathname + "?" + query);
  };
  const openFolder = (id: string | null) => {
    navigate(null, id);
    setSearch("");
    setType("all");
    setStatus("all");
    setMessage("");
  };
  const activeFolder = folders.find((f) => f.id === folderId) ?? null;
  const update = (saved: CaseDesign) =>
    setDesigns((items) => mergeDesigns(items, [saved]));
  const reload = async (create = false) => {
    setLoading(true);
    setError("");
    try {
      const [fresh, listing] = await Promise.all([
        caseRequest<CaseContent>(data.workspaceId, data.caseId, "brief"),
        caseRequest<DesignOptions & { items: CaseDesign[] }>(
          data.workspaceId,
          data.caseId,
          "designs",
        ),
      ]);
      setData(fresh);
      applyListing(listing);
      if (create && fresh.canEdit)
        setFolderEditor({
          id: crypto.randomUUID(),
          version: 0,
          name: "",
          description: "",
          roomId: null,
          scopeEntryId: null,
        });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not load designs. Please try Reload designs.",
      );
    } finally {
      setLoading(false);
    }
  };
  const source = designs.filter(
    (d) =>
      (archived && tab === "designs" ? Boolean(d.archivedAt) : !d.archivedAt) &&
      inDesignTab(d, tab),
  );
  const query = search.trim().toLocaleLowerCase();
  const atRoot = tab === "designs" && folderId === null;
  const showingFolders = atRoot && !query && status === "all" && type === "all";
  const inFolder = source.filter(
    (d) =>
      tab !== "designs" || atRoot || (d.folderId ?? "unfiled") === folderId,
  );
  const folderName = (d: CaseDesign) =>
    folders.find((f) => f.id === d.folderId)?.name ?? "Unfiled";
  const rows = inFolder.filter(
    (d) =>
      (type === "all" || d.documentType === type) &&
      (status === "all" || (d.versions[0]?.status ?? "no_file") === status) &&
      [
        d.title,
        d.versions[0]?.asset.name,
        d.documentType,
        d.description,
        folderName(d),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
  );
  const folderItems = [
    ...folders,
    ...(source.some((d) => !d.folderId)
      ? [
          {
            id: "unfiled",
            name: "Unfiled",
            description: "",
            roomId: null,
            scopeEntryId: null,
            version: 0,
          },
        ]
      : []),
  ].filter(
    (f) => !archived || source.some((d) => (d.folderId ?? "unfiled") === f.id),
  );
  const fileButton = (d: CaseDesign, queue = false) => {
    const revision = d.versions[0];
    return (
      <button
        className={queue ? view.queueRow : view.fileCard}
        key={d.id}
        onClick={() => navigate(d.id, tab === "designs" ? folderId : null)}
        aria-label={"Open " + d.title}
      >
        <FileCover key={revision?.asset.id} design={d} data={data} />
        <span className={view.fileInfo}>
          <strong>{revision?.asset.name ?? d.title}</strong>
          {(queue || atRoot) && <small>{folderName(d)}</small>}
          <small>
            {d.documentType} · {revision ? "R" + revision.number : "No file"}
          </small>
          {!queue && d.description && (
            <small className={view.fileNote}>{d.description}</small>
          )}
        </span>
        <span className={view.fileState}>
          <span className={view.status} data-status={revision?.status}>
            {designStateLabels[revision?.status ?? "no_file"] ??
              revision?.status}
          </span>
          {queue && revision?.status === "internal_review" && (
            <small>
              {reviewOptions.reviewers.find((r) => r.id === revision.reviewerId)
                ?.name ?? "Internal reviewer"}
            </small>
          )}
        </span>
        {queue && <ChevronRight size={16} />}
      </button>
    );
  };
  if (selected)
    return (
      <>
        <DesignFileDetails
          key={selected.id}
          data={data}
          design={selected}
          options={reviewOptions}
          folderName={folderName(selected)}
          backLabel={
            tab === "designs"
              ? folderId
                ? folderName(selected)
                : "All folders"
              : designTabs.find((t) => t.id === tab)!.label
          }
          onClose={() => navigate(null, folderId)}
          onUpdate={update}
          onReviewed={update}
        />
        {error && (
          <p role="alert" className={styles.error}>
            {error}
            <Button
              variant="quiet"
              size="compact"
              onPress={() => void reload()}
            >
              Reload designs
            </Button>
          </p>
        )}
      </>
    );
  return (
    <Tabs
      className="wd-tabs"
      selectedKey={tab}
      onSelectionChange={(key) => changeTab(String(key) as DesignTab)}
    >
      <TabList
        aria-label="Design workflow"
        className={"wd-tab-list " + view.tabs}
      >
        {designTabs.map((t) => (
          <Tab key={t.id} id={t.id} className="wd-tab">
            {t.label}
            <span className={view.tabCount}>
              {
                designs.filter((d) => !d.archivedAt && inDesignTab(d, t.id))
                  .length
              }
            </span>
          </Tab>
        ))}
      </TabList>
      <TabPanel id={tab}>
        <div className={styles.content}>
          {message && (
            <p role="status" className={styles.notice}>
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {fileId && !selected && (
            <p role="alert" className={styles.error}>
              This file could not be found. Reload designs or choose a file
              below.
            </p>
          )}
          {tab === "designs" && folderId !== null ? (
            <div className={view.location}>
              <Button
                variant="quiet"
                size="compact"
                onPress={() => openFolder(null)}
              >
                <ArrowLeft size={14} />
                All folders
              </Button>
              <ChevronRight size={14} />
              <strong>
                {activeFolder?.name ??
                  (folderId === "unfiled" ? "Unfiled" : "Folder not found")}
              </strong>
              {activeFolder && data.canEdit && (
                <Button
                  variant="quiet"
                  size="compact"
                  aria-label="Edit folder"
                  onPress={() => setFolderEditor(activeFolder)}
                >
                  <Pencil size={14} />
                </Button>
              )}
              <span>{inFolder.length} {inFolder.length === 1 ? "file" : "files"}</span>
            </div>
          ) : (
            <p className={view.libraryHint}>{designTabHints[tab]}</p>
          )}
          <div className={view.libraryToolbar}>
            <SearchInput
              label="Search designs"
              value={search}
              onChange={setSearch}
              placeholder={
                atRoot ? "Find a folder, file or note…" : "Find a file or note…"
              }
            />
            {!showingFolders && (
              <div className={view.fileFilters}>
                <SelectField
                  label={
                    <span className="wd-visually-hidden">Design type</span>
                  }
                  selectedKey={type}
                  onSelectionChange={(key) => key && setType(String(key))}
                  items={[
                    { id: "all", label: "All types" },
                    ...Array.from(
                      new Set(inFolder.map((d) => d.documentType)),
                    ).map((id) => ({ id, label: id })),
                  ]}
                />
                {tab === "designs" && (
                  <SelectField
                    label={<span className="wd-visually-hidden">Status</span>}
                    selectedKey={status}
                    onSelectionChange={(key) => key && setStatus(String(key))}
                    items={[
                      { id: "all", label: "All statuses" },
                      ...Object.entries(designStateLabels).map(
                        ([id, label]) => ({
                          id,
                          label,
                        }),
                      ),
                    ]}
                  />
                )}
                <small>
                  {rows.length} {rows.length === 1 ? "file" : "files"}
                </small>
              </div>
            )}
            <div className={view.toolbarActions}>
              {tab === "designs" && (
                <Checkbox isSelected={archived} onChange={setArchived}>
                  Archived
                </Checkbox>
              )}
              <Button
                variant="quiet"
                size="compact"
                aria-label="Reload designs"
                isLoading={loading}
                onPress={() => void reload()}
              >
                <RotateCcw size={14} />
              </Button>
              {data.canEdit &&
                tab === "designs" &&
                (atRoot ? (
                  <Button
                    size="compact"
                    variant="primary"
                    isDisabled={loading}
                    onPress={() => void reload(true)}
                  >
                    <Plus size={14} />
                    New folder
                  </Button>
                ) : (
                  activeFolder && (
                    <Button
                      size="compact"
                      variant="primary"
                      onPress={() => setUpload(true)}
                    >
                      <Upload size={14} />
                      Add files
                    </Button>
                  )
                ))}
            </div>
          </div>
          {(showingFolders || (atRoot && query)) && (
            <div className={view.folderGrid} aria-label="Design folders">
              {folderItems
                .filter(
                  (f) =>
                    showingFolders ||
                    f.name.toLocaleLowerCase().includes(query),
                )
                .map((f) => {
                  const files = source.filter(
                    (d) => (d.folderId ?? "unfiled") === f.id,
                  );
                  const changes = files.filter(
                    (d) => d.versions[0]?.status === "changes_requested",
                  ).length;
                  return (
                    <button
                      key={f.id}
                      className={view.folder}
                      onClick={() => openFolder(f.id)}
                      aria-label={"Open folder " + f.name}
                    >
                      <span className={view.folderTop}>
                        <Folder size={24} strokeWidth={1.5} />
                        <span>
                          {files.length} {files.length === 1 ? "file" : "files"}
                        </span>
                      </span>
                      <strong>{f.name}</strong>
                      {changes > 0 && (
                        <small className={view.needsChanges}>
                          {changes} need changes
                        </small>
                      )}
                      <ChevronRight className={view.folderArrow} size={16} />
                    </button>
                  );
                })}
            </div>
          )}
          {!showingFolders && (
            <div
              className={tab === "designs" ? view.fileGrid : view.queue}
              aria-label="Design files"
            >
              {rows.map((d) => fileButton(d, tab !== "designs"))}
            </div>
          )}
          {(showingFolders
            ? !folderItems.length
            : !rows.length &&
              !(
                atRoot &&
                query &&
                folderItems.some((f) =>
                  f.name.toLocaleLowerCase().includes(query),
                )
              )) && (
            <div className={view.empty}>
              <Folder size={28} />
              <strong>
                {query || status !== "all" || type !== "all"
                  ? "No matching files"
                  : archived
                    ? "No archived files"
                    : tab !== "designs"
                      ? "Nothing here yet"
                      : showingFolders
                        ? "Start with a folder"
                        : "No files yet"}
              </strong>
              <p>
                {query || status !== "all" || type !== "all"
                  ? "Try another search or clear your filters."
                  : tab !== "designs"
                    ? designTabHints[tab]
                    : archived
                      ? "Archived files can be restored here."
                      : showingFolders
                        ? "Create a folder for a room, an item, or both."
                        : activeFolder
                          ? "Add your file, select a design type, and include a note if needed."
                          : "Return to All folders to choose where your files belong."}
              </p>
              {(query || status !== "all" || type !== "all") && (
                <Button variant="quiet" size="compact" onPress={resetFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
          {folderEditor && (
            <FolderEditor
              key={folderEditor.id}
              data={data}
              initial={folderEditor}
              folders={folders}
              onClose={() => setFolderEditor(null)}
              onSaved={(f) => {
                setReviewOptions((o) => ({
                  ...o,
                  folders: [
                    f,
                    ...o.folders.filter((row) => row.id !== f.id),
                  ].sort((a, b) => a.name.localeCompare(b.name)),
                }));
                setFolderEditor(null);
                resetFilters();
                setMessage(
                  "Folder saved. Open it when you are ready to add files.",
                );
              }}
            />
          )}
          {upload && activeFolder && (
            <DesignUpload
              data={data}
              folder={activeFolder}
              onClose={() => setUpload(false)}
              onSaved={(saved) => {
                setDesigns((current) => mergeDesigns(current, saved));
                setUpload(false);
                resetFilters();
                setMessage(
                  saved.length +
                    " " +
                    (saved.length === 1 ? "file" : "files") +
                    " saved.",
                );
              }}
            />
          )}
        </div>
      </TabPanel>
    </Tabs>
  );
}
