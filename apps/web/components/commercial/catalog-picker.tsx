"use client";
import { useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import c from "./catalog-picker.module.css";
import type { CatalogChoice } from "@/lib/pre-project/content";
import { useCatalogOptions } from "./catalog-options-cache";
import s from "./commercial.module.css";
export type CommercialCatalogChoice = CatalogChoice;
export function CommercialCatalogPicker({
  workspaceId,
  caseId,
  kind,
  label,
  value,
  onChange,
  linkedTo,
  catalogId,
  disabled = false,
  excludeIds = [],
}: {
  workspaceId: string;
  caseId: string;
  kind: string;
  label: string;
  value: CommercialCatalogChoice | null;
  onChange: (v: CommercialCatalogChoice | null) => void;
  linkedTo?: string;
  catalogId?: string;
  disabled?: boolean;
  excludeIds?: string[];
}) {
  const recordId = value?.id ?? null;
  const [query, setQuery] = useState<{ recordId: string | null; text: string }>(
    {
      recordId,
      text: value ? `${value.name} · ${value.catalogName ?? value.code}` : "",
    },
  );
  const search =
    query.recordId === recordId
      ? query.text
      : value
        ? `${value.name} · ${value.catalogName ?? value.code}`
        : "";
  const setSearch = (text: string) => setQuery({ recordId, text });
  const normalizedSearch =
    search === value?.name ||
    search === `${value?.name} · ${value?.catalogName ?? value?.code}`
      ? ""
      : search.trim();
  const { items, error, loading, refresh } = useCatalogOptions(
    workspaceId,
    caseId,
    kind,
    normalizedSearch,
    linkedTo,
    catalogId,
  );
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const candidates = items.filter((item) => !excludeIds.includes(item.id));
  const showCurrent =
    value &&
    (!search ||
      `${value.name} · ${value.catalogName ?? value.code}`
        .toLowerCase()
        .includes(search.toLowerCase()));
  const options = showCurrent
    ? [value, ...candidates.filter((i) => i.id !== value.id)]
    : candidates;
  const select = (next: CommercialCatalogChoice) => {
    setQuery({
      recordId: next.id,
      text: `${next.name} · ${next.catalogName ?? next.code}`,
    });
    onChange(next);
    setOpen(false);
  };
  return (
    <div
      className={`${s.catalogPicker} ${c.picker}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className={c.inputGroup}>
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && options[active] ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={search}
          placeholder="Search or choose…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    open ? index + (e.key === "ArrowDown" ? 1 : -1) : 0,
                  ),
                ),
              );
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (options[active]) select(options[active]);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={`Show options ${label}`}
          onClick={() => {
            if (!open) input.current?.focus();
            setOpen(!open);
          }}
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open && (
        <div className={c.results}>
          {loading && !options.length && (
            <p role="status">Searching catalogs…</p>
          )}
          <div
            role="listbox"
            id={`${id}-options`}
            aria-label={`${label} options`}
          >
            {options.map((option, index) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={`${id}-option-${index}`}
                key={option.id}
                aria-selected={active === index}
                onPointerDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(option)}
              >
                {option.name} · {option.catalogName ?? option.code}
              </button>
            ))}
          </div>
          <button type="button" className={c.refresh} onClick={refresh}>
            Refresh catalog choices
          </button>
          {!loading && !error && !options.length && (
            <p>
              {linkedTo
                ? "No linked choices. Try another search or use an item from the catalog."
                : "No matching records. Try another search."}
            </p>
          )}
        </div>
      )}
      {value && (
        <button
          type="button"
          className={s.catalogClear}
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setQuery({ recordId: null, text: "" });
            setOpen(false);
          }}
        >
          <X size={11} />
          Clear selection
        </button>
      )}
      {error && (
        <div role="alert" className={s.error}>
          {error}{" "}
          <button
            type="button"
            className={s.catalogClear}
            onClick={refresh}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
