"use client";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { Quote, QuoteLine } from "@/lib/commercial/types";
import { useConfirmationDialog } from "@/design-system";
import {
  CommercialCatalogPicker,
  type CommercialCatalogChoice,
} from "./catalog-picker";
import { QuotationItemInspector } from "./quotation-item-inspector";
import d from "./quotation-studio.module.css";
import s from "./commercial.module.css";

type Props = {
  activeRoom?: string;
  quote: Quote;
  onChange: (quote: Quote) => void;
  readOnly: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onRoom: (room: string) => void;
  onAdd: (room: string) => void;
  onImportScope: () => void;
  workspaceId: string;
  caseId: string;
};
export function QuotationRoomTree({
  activeRoom,
  quote,
  onChange,
  readOnly,
  selected,
  onSelect,
  onRoom,
  onAdd,
  onImportScope,
  workspaceId,
  caseId,
}: Props) {
  const rooms = [
    ...new Set([
      ...(quote.rooms ?? []).map((r) => r.name),
      ...quote.lines.map((l) => l.room),
    ]),
  ];
  const [expanded, setExpanded] = useState(activeRoom ?? "");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{
    name: string;
    old?: string;
    catalog: CommercialCatalogChoice | null;
  } | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const selectedRoom = quote.lines.find((l) => l.id === selected)?.room;
  const patch = (value: Partial<Quote>) => onChange({ ...quote, ...value });
  const records = rooms.map(
    (name) =>
      quote.rooms?.find((r) => r.name === name) ?? {
        id: crypto.randomUUID(),
        name,
      },
  );
  const duplicateName =
    !!draft &&
    rooms.some(
      (r) =>
        r !== draft.old && r.toLowerCase() === draft.name.trim().toLowerCase(),
    );
  const updateItem = (next: QuoteLine) => {
    patch({ lines: quote.lines.map((l) => (l.id === next.id ? next : l)) });
    if (selectedRoom !== next.room) {
      setExpanded(next.room);
      onRoom(next.room);
    }
  };
  const move = (room: string, offset: number) => {
    const from = records.findIndex((r) => r.name === room),
      to = from + offset;
    if (to < 0 || to >= records.length) return;
    records.splice(to, 0, records.splice(from, 1)[0]);
    patch({ rooms: records });
  };
  return (
    <div className={d.roomTree}>
      {!readOnly && quote.direction !== "deduction" && (
        <div className={d.roomCommands}>
          <button
            className={s.primary}
            disabled={rooms.length >= 100}
            onClick={() => {
              setDraft({ name: "", catalog: null });

            }}
          >
            <Plus size={14} />
            Add room
          </button>
          <button className={s.button} onClick={onImportScope}>
            Import scope
          </button>
        </div>
      )}
      {draft && (
        <form
          className={d.roomForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim() || duplicateName) return;
            const name = draft.name.trim(),
              existing = records.find((r) => r.name === draft.old);
            const record = {
              id: existing?.id ?? crypto.randomUUID(),
              name,
              ...(draft.catalog
                ? {
                    catalog: {
                      role: "room",
                      recordId: draft.catalog.id,
                      version: draft.catalog.version,
                      snapshot: draft.catalog,
                    },
                  }
                : {}),
            };
            patch({
              rooms: existing
                ? records.map((r) => (r.id === existing.id ? record : r))
                : [...records, record],
              lines: quote.lines.map((l) =>
                l.room === draft.old ? { ...l, room: name } : l,
              ),
            });
            setDraft(null);
            setExpanded(name);
            onRoom(name);
            onSelect("");
          }}
        >
          <strong>{draft.old ? "Edit room" : "Add room"}</strong>
          <label>
            Room name
            <input
              autoFocus
              required
              aria-label="Room name"
              maxLength={120}
              placeholder="e.g. Kitchen"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <section className={d.optionalFields}>
            <h3>Choose from room catalog</h3>
            <CommercialCatalogPicker
              workspaceId={workspaceId}
              caseId={caseId}
              kind="room"
              label="Room type from catalog"
              value={draft.catalog}
              onChange={(catalog) =>
                setDraft({
                  ...draft,
                  catalog,
                  name: catalog?.name ?? draft.name,
                })
              }
            />
          </section>
          {duplicateName && (
            <p role="alert" className={s.error}>
              A room with this name already exists.
            </p>
          )}
          <div className={s.actions}>
            <button
              className={s.primary}
              disabled={!draft.name.trim() || duplicateName}
            >
              Save room
            </button>
            <button
              type="button"
              className={s.button}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {quote.lines.length > 5 && (
        <div className={d.search}>
          <Search size={14} />
          <input
            aria-label="Search rooms and items"
            placeholder="Find a room or item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {!rooms.length && !draft && (
        <p className={d.hint}>Add a room, then add its items and materials.</p>
      )}
      {rooms
        .filter(
          (room) =>
            room.toLowerCase().includes(search.toLowerCase()) ||
            quote.lines.some(
              (l) =>
                l.room === room &&
                l.title.toLowerCase().includes(search.toLowerCase()),
            ),
        )
        .map((room) => {
          const lines = quote.lines.filter((l) => l.room === room),
            open = (selectedRoom ?? expanded) === room || !!search;
          return (
            <section
              key={room}
              className={d.roomGroup}
              aria-label={`Room ${room}`}
            >
              <div className={d.roomGroupTitle}>
                <button
                  aria-expanded={open}
                  aria-label={`Open room ${room}`}
                  onClick={() => {
                    setExpanded(open ? "" : room);
                    onSelect("");
                    onRoom(room);
                  }}
                >
                  {open ? (
                    <ChevronDown
                      size={16}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronRight
                      size={16}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  )}
                  <strong>{room}</strong>
                  <span className={d.roomCount}>{lines.length}</span>
                </button>
                {!readOnly && (
                  <details className={d.roomMenu}>
                    <summary
                      aria-label={`Room options for ${room}`}
                      title="Room options"
                    >
                      •••
                    </summary>
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft({
                            name: room,
                            old: room,
                            catalog:
                              quote.rooms?.find((r) => r.name === room)?.catalog
                                ?.snapshot ?? null,
                          });
                        }}
                      >
                        <Pencil size={13} />
                        Rename room
                      </button>
                      <button
                        type="button"
                        disabled={rooms.indexOf(room) === 0}
                        onClick={() => move(room, -1)}
                      >
                        <ArrowUp size={13} />
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={rooms.indexOf(room) === rooms.length - 1}
                        onClick={() => move(room, 1)}
                      >
                        <ArrowDown size={13} />
                        Move down
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const removeRoom = () => {
                            patch({ rooms: quote.rooms?.filter((r) => r.name !== room), lines: quote.lines.filter((l) => l.room !== room) });
                            onSelect(""); setExpanded("");
                          };
                          if (lines.length) {
                            requestConfirmation({ title: `Remove ${room}?`, body: `${lines.length} quoted ${lines.length === 1 ? "item" : "items"} in this room will also be removed from the draft.`, confirmLabel: "Remove room", onConfirm: removeRoom });
                            return;
                          }
                          removeRoom();
                        }}
                      >
                        <Trash2 size={13} />
                        Remove room
                      </button>
                    </div>
                  </details>
                )}
              </div>
              {open && (
                <div className={d.roomItems}>
                  {lines
                    .filter(
                      (l) =>
                        !search ||
                        room.toLowerCase().includes(search.toLowerCase()) ||
                        l.title.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((line, i) => {
                      const materialCount =
                        (line.catalogLinks?.filter(
                          (c) => c.role === "material" || c.role === "finish",
                        ).length ?? 0) + (line.customMaterials?.length ?? 0);
                      return (
                        <div
                          key={line.id}
                          className={d.itemNode}
                          data-active={selected === line.id}
                        >
                          <button
                            className={d.itemRow}
                            aria-label={`Edit item ${line.title}`}
                            aria-expanded={selected === line.id}
                            onClick={() => {
                              setExpanded(room);
                              onSelect(selected === line.id ? "" : line.id);
                            }}
                          >
                            {selected === line.id ? (
                              <ChevronDown
                                size={16}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronRight
                                size={16}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />
                            )}
                            <span>
                              <strong>{line.title}</strong>
                              <small>
                                {line.quantity} {line.unit} · {materialCount}{" "}
                                {materialCount === 1 ? "material" : "materials"}
                              </small>
                            </span>
                            <span className={d.itemIndex}>
                              {String(i + 1).padStart(2, "0")}
                            </span>
                          </button>
                          {selected === line.id && (
                            <fieldset
                              className={d.editFields}
                              disabled={readOnly}
                            >
                              <QuotationItemInspector
                                quote={quote}
                                item={line}
                                workspaceId={workspaceId}
                                caseId={caseId}
                                onChange={updateItem}
                                onDuplicate={() => {
                                  const next = {
                                    ...structuredClone(line),
                                    id: crypto.randomUUID(),
                                    scopeId: undefined,
                                    scopeVersion: undefined,
                                    specificationVersion: undefined,
                                  };
                                  patch({ lines: [...quote.lines, next] });
                                  onSelect(next.id);
                                }}
                                onRemove={() => {
                                  patch({
                                    lines: quote.lines.filter(
                                      (l) => l.id !== line.id,
                                    ),
                                  });
                                  onSelect("");
                                  setExpanded(room);
                                }}
                              />
                            </fieldset>
                          )}
                        </div>
                      );
                    })}
                  {!lines.length && (
                    <p className={d.materialEmpty}>
                      No items in this room yet.
                    </p>
                  )}
                  {!readOnly && quote.direction !== "deduction" && (
                    <button
                      className={d.addItem}
                      aria-label={`Add item to ${room}`}
                      disabled={quote.lines.length >= 300}
                      onClick={() => onAdd(room)}
                    >
                      <Plus size={14} />
                      Add item
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      {readOnly && (
        <p className={d.hint}>
          This version is fixed. Create a revision to edit.
        </p>
      )}
      {confirmationDialog}
    </div>
  );
}
