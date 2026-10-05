"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, DoorOpen, Pencil, Plus } from "lucide-react";
import { Badge, Button, InlineNotice, SearchInput, SelectField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest, saveCaseRoom, type CaseContent, type CaseRoom } from "@/lib/pre-project/content";
import { CaseModal } from "./case-controls";
import styles from "./room-manager.module.css";

type CatalogRoom = { id: string; name: string; catalogName: string; code?: string };
type MergedRoom = CatalogRoom & { catalogs: string[] };
type RoomContext = Pick<CaseContent, "workspaceId" | "caseId" | "rooms" | "canEdit">;
const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** The workspace's catalog rooms across every catalog, one entry per room name; null while loading. */
export function useCatalogRooms(workspaceId: string, caseId: string) {
  const [catalog, setCatalog] = useState<CatalogRoom[] | null>(null);
  useEffect(() => {
    let alive = true;
    caseRequest<{ items: CatalogRoom[] }>(workspaceId, caseId, "catalog-options?kind=room")
      .then((result) => { if (alive) setCatalog(result.items); })
      .catch(() => { if (alive) setCatalog([]); });
    return () => { alive = false; };
  }, [workspaceId, caseId]);
  return useMemo(() => {
    if (!catalog) return null;
    // The first catalog's record is the one linked.
    const seen = new Map<string, MergedRoom>();
    for (const room of catalog) {
      const existing = seen.get(key(room.name));
      if (existing) { if (!existing.catalogs.includes(room.catalogName)) existing.catalogs.push(room.catalogName); }
      else seen.set(key(room.name), { ...room, catalogs: [room.catalogName] });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);
}

/**
 * Rooms for a project, picked from the workspace's catalog rooms (every catalog, one list, the
 * same room name shown once) with a custom room for anything the catalog doesn't have.
 */
export function RoomManager({ data, onClose, onSave }: { data: CaseContent; onClose: () => void; onSave: (room: CaseRoom) => Promise<CaseRoom> }) {
  const t = useT();
  const catalog = useCatalogRooms(data.workspaceId, data.caseId);
  const [rooms, setRooms] = useState(data.rooms);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<{ room: CaseRoom; name: string } | null>(null);

  const catalogRooms = catalog ?? [];
  const inProject = new Set(rooms.map((room) => key(room.name)));
  const linked = new Set(rooms.map((room) => room.catalogRecordId).filter(Boolean));
  const query = key(search);
  const suggestions = catalogRooms.filter((room) => !inProject.has(key(room.name)) && !linked.has(room.id) && (!query || key(room.name).includes(query)));
  const exact = query && (catalogRooms.some((room) => key(room.name) === query) || inProject.has(query));

  const add = async (room: CaseRoom, label: string) => {
    setBusy(label); setError("");
    try {
      const saved = await onSave(room);
      setRooms((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setSearch("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); }
    finally { setBusy(null); }
  };
  const addCatalog = (room: CatalogRoom) => add({ id: crypto.randomUUID(), version: 0, name: room.name, catalogRecordId: room.id }, room.id);
  const addCustom = () => { const name = search.trim().replace(/\s+/g, " ").slice(0, 120); if (name) void add({ id: crypto.randomUUID(), version: 0, name, catalogRecordId: null }, "custom"); };
  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) { setError(t("Give the room a name.")); return; }
    if (rooms.some((room) => room.id !== renaming.room.id && key(room.name) === key(name))) { setError(t("This project already has a room with that name.")); return; }
    await add({ ...renaming.room, name }, renaming.room.id);
    setRenaming(null);
  };

  return <CaseModal title={t("Project rooms")} onClose={onClose} busy={Boolean(busy)} size="md">
    <div className={styles.manager}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      <section aria-label={t("Rooms in this project")}>
        <h3 className={styles.heading}>{t("In this project")} <span>{rooms.length}</span></h3>
        {rooms.length ? <ul className={styles.list}>{rooms.map((room) => <li key={room.id} className={styles.item}>
          <DoorOpen aria-hidden="true" size={16} />
          {renaming?.room.id === room.id ? <form className={styles.renameForm} onSubmit={(event) => { event.preventDefault(); void rename(); }}>
            <TextInput autoFocus aria-label={t("Room name")} label={null} maxLength={120} onChange={(name) => setRenaming({ room, name })} value={renaming.name} />
            <Button size="compact" onPress={() => setRenaming(null)}>{t("Cancel")}</Button>
            <Button size="compact" type="submit" variant="primary" isLoading={busy === room.id}>{t("Save")}</Button>
          </form> : <>
            <span className={styles.name}>{room.name}</span>
            {room.catalogRecordId ? <Badge tone="neutral">{t("Catalog")}</Badge> : <Badge tone="info">{t("Custom")}</Badge>}
            {data.canEdit ? <Button aria-label={t("Rename {name}", { name: room.name })} size="compact" variant="quiet" onPress={() => { setError(""); setRenaming({ room, name: room.name }); }}><Pencil aria-hidden="true" size={13} /></Button> : null}
          </>}
        </li>)}</ul> : <p className={styles.muted}>{t("No rooms yet.")}</p>}
      </section>

      {data.canEdit ? <section aria-label={t("Add rooms")}>
        <h3 className={styles.heading}>{t("Add rooms")}</h3>
        <SearchInput label={t("Find or type a room")} placeholder={t("Find or type a room")} value={search} onChange={setSearch} />
        {catalog === null ? <p className={styles.muted}>{t("Loading your catalog rooms…")}</p>
          : catalogRooms.length ? <>
            {suggestions.length ? <ul className={styles.chips} aria-label={t("Rooms from your catalog")}>
              {suggestions.map((room) => <li key={room.id}><button type="button" className={styles.chip} disabled={Boolean(busy)} title={room.catalogs.join(", ")} onClick={() => void addCatalog(room)}>
                {busy === room.id ? <Check aria-hidden="true" size={13} /> : <Plus aria-hidden="true" size={13} />}{room.name}
              </button></li>)}
            </ul> : <p className={styles.muted}>{query ? t("No catalog room matches.") : t("Every catalog room is already in this project.")}</p>}
          </>
          : <p className={styles.muted}>{t("Your catalog has no room types yet.")} <Link href="/workspace/catalogs">{t("Add them in Catalog")}</Link></p>}
        {query && !exact ? <Button size="compact" isLoading={busy === "custom"} onPress={addCustom}><Plus aria-hidden="true" size={14} />{t("Add “{name}” as a custom room", { name: search.trim() })}</Button> : null}
      </section> : null}
    </div>
  </CaseModal>;
}

/**
 * Pick a room to work in: one already in the project, one from the catalog (added to the project)
 * or a custom one typed in. Nothing is pre-filled; the list is the tenant's own catalog.
 */
export function RoomPicker({ data, exclude = [], onClose, onPick, title }: { data: RoomContext; exclude?: string[]; onClose: () => void; onPick: (room: CaseRoom) => void; title?: string }) {
  const t = useT();
  const catalog = useCatalogRooms(data.workspaceId, data.caseId);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const query = key(search);
  const hidden = new Set(exclude);
  const project = data.rooms.filter((room) => !hidden.has(room.id) && (!query || key(room.name).includes(query))).sort((a, b) => a.name.localeCompare(b.name));
  const inProject = new Set(data.rooms.map((room) => key(room.name)));
  const linked = new Set(data.rooms.map((room) => room.catalogRecordId).filter(Boolean));
  const fromCatalog = (catalog ?? []).filter((room) => !inProject.has(key(room.name)) && !linked.has(room.id) && (!query || key(room.name).includes(query)));
  const exact = query && ((catalog ?? []).some((room) => key(room.name) === query) || inProject.has(query));

  const create = async (room: CaseRoom, label: string) => {
    setBusy(label); setError("");
    try { onPick(await saveCaseRoom(data.workspaceId, data.caseId, room)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); setBusy(null); }
  };
  const chip = (id: string, name: string, onClick: () => void, title?: string) => <li key={id}><button type="button" className={styles.chip} disabled={Boolean(busy)} title={title} onClick={onClick}>
    {busy === id ? <Check aria-hidden="true" size={13} /> : <Plus aria-hidden="true" size={13} />}{name}
  </button></li>;

  return <CaseModal title={title ?? t("Add room")} onClose={onClose} busy={Boolean(busy)} size="md">
    <div className={styles.manager}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      <SearchInput label={t("Find or type a room")} placeholder={t("Find or type a room")} value={search} onChange={setSearch} />
      {project.length ? <section aria-label={t("In this project")}>
        <h3 className={styles.heading}>{t("In this project")}</h3>
        <ul className={styles.chips}>{project.map((room) => chip(room.id, room.name, () => onPick(room)))}</ul>
      </section> : null}
      {data.canEdit ? <section aria-label={t("Rooms from your catalog")}>
        <h3 className={styles.heading}>{t("From your catalog")}</h3>
        {catalog === null ? <p className={styles.muted}>{t("Loading your catalog rooms…")}</p>
          : fromCatalog.length ? <ul className={styles.chips}>{fromCatalog.map((room) => chip(room.id, room.name, () => void create({ id: crypto.randomUUID(), version: 0, name: room.name, catalogRecordId: room.id }, room.id), room.catalogs.join(", ")))}</ul>
          : catalog.length ? <p className={styles.muted}>{query ? t("No catalog room matches.") : t("Every catalog room is already in this project.")}</p>
          : <p className={styles.muted}>{t("Your catalog has no room types yet.")} <Link href="/workspace/catalogs">{t("Add them in Catalog")}</Link></p>}
        {query && !exact ? <Button size="compact" isLoading={busy === "custom"} onPress={() => void create({ id: crypto.randomUUID(), version: 0, name: search.trim().replace(/\s+/g, " ").slice(0, 120), catalogRecordId: null }, "custom")}><Plus aria-hidden="true" size={14} />{t("Add “{name}” as a custom room", { name: search.trim() })}</Button> : null}
      </section> : null}
    </div>
  </CaseModal>;
}

const ADD_ROOM = "__add_room";

/** The room of a record: the project's rooms, and adding one from the catalog without leaving the form. */
export function RoomField({ data, value, onChange, onRoomAdded, isDisabled, label }: { data: RoomContext; value: string | null; onChange: (room: CaseRoom) => void; onRoomAdded: (room: CaseRoom) => void; isDisabled?: boolean; label?: string }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const items = [...data.rooms.map((room) => ({ id: room.id, label: room.name })).sort((a, b) => a.label.localeCompare(b.label)), ...(data.canEdit ? [{ id: ADD_ROOM, label: t("Add a room…") }] : [])];
  return <>
    <SelectField isDisabled={isDisabled} items={items} label={label ?? t("Room")} placeholder={t("Choose a room")} selectedKey={value}
      onSelectionChange={(key) => { if (key === ADD_ROOM) { setPicking(true); return; } const room = data.rooms.find((item) => item.id === key); if (room) onChange(room); }} />
    {picking ? <RoomPicker data={data} onClose={() => setPicking(false)} onPick={(room) => { if (!data.rooms.some((item) => item.id === room.id)) onRoomAdded(room); onChange(room); setPicking(false); }} /> : null}
  </>;
}
