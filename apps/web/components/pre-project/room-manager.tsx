"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, DoorOpen, Pencil, Plus } from "lucide-react";
import { Badge, Button, InlineNotice, SearchInput, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest, type CaseContent, type CaseRoom } from "@/lib/pre-project/content";
import { CaseModal } from "./case-controls";
import styles from "./room-manager.module.css";

type CatalogRoom = { id: string; name: string; catalogName: string; code?: string };
const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Rooms for a project, picked from the workspace's catalog rooms (every catalog, one list, the
 * same room name shown once) with a custom room for anything the catalog doesn't have.
 */
export function RoomManager({ data, onClose, onSave }: { data: CaseContent; onClose: () => void; onSave: (room: CaseRoom) => Promise<CaseRoom> }) {
  const t = useT();
  const [catalog, setCatalog] = useState<CatalogRoom[] | null>(null);
  const [rooms, setRooms] = useState(data.rooms);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<{ room: CaseRoom; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    caseRequest<{ items: CatalogRoom[] }>(data.workspaceId, data.caseId, "catalog-options?kind=room")
      .then((result) => { if (alive) setCatalog(result.items); })
      .catch(() => { if (alive) setCatalog([]); });
    return () => { alive = false; };
  }, [data.workspaceId, data.caseId]);

  // One entry per room name across catalogs; the first catalog's record is the one linked.
  const catalogRooms = useMemo(() => {
    const seen = new Map<string, CatalogRoom & { catalogs: string[] }>();
    for (const room of catalog ?? []) {
      const existing = seen.get(key(room.name));
      if (existing) { if (!existing.catalogs.includes(room.catalogName)) existing.catalogs.push(room.catalogName); }
      else seen.set(key(room.name), { ...room, catalogs: [room.catalogName] });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);
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
            <Button size="compact" type="submit" variant="primary" isLoading={busy === room.id}>{t("Save")}</Button>
            <Button size="compact" onPress={() => setRenaming(null)}>{t("Cancel")}</Button>
          </form> : <>
            <span className={styles.name}>{room.name}</span>
            {room.catalogRecordId ? <Badge tone="neutral">{t("Catalog")}</Badge> : <Badge tone="info">{t("Custom")}</Badge>}
            {data.canEdit ? <Button aria-label={t("Rename {name}", { name: room.name })} size="compact" variant="quiet" onPress={() => { setError(""); setRenaming({ room, name: room.name }); }}><Pencil aria-hidden="true" size={13} /></Button> : null}
          </>}
        </li>)}</ul> : <p className={styles.muted}>{t("No rooms yet. Requirements can also be for the whole project.")}</p>}
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
