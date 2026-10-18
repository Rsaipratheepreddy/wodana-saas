"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Image as ImageIcon, Plus } from "lucide-react";
import { Button, SearchInput, Skeleton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { money } from "@/lib/quotation/format";
import type { CatalogHit } from "@/lib/quotation/types";
import { CellPicker } from "./cell-picker";
import catalog from "./quote-catalog.module.css";

/**
 * The catalog beside the quote: search or browse by category, see each item's picture and price, and
 * add it to an area in one click. Typing in a line's item cell finds the same items.
 */
export function QuoteCatalog({ active = false, search, thumb, currency, decimals, areas, areaId, onAreaChange, onAdd, canEdit }: {
  /** The panel is open on the catalog: its search takes focus, so typing goes there and nowhere else. */
  active?: boolean;
  search: (text: string, signal: AbortSignal, limit?: number) => Promise<CatalogHit[]>;
  thumb: (imageId: string) => string; currency: string; decimals: number;
  areas: Array<{ id: string; name: string }>; areaId: string | null; onAreaChange: (id: string | null) => void;
  onAdd: (hit: CatalogHit, areaId: string | null) => void; canEdit: boolean;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogHit[] | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (active) searchInput.current?.focus({ preventScroll: true }); }, [active]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      search(query.trim(), controller.signal, 50).then((next) => { setItems(next); setError(""); })
        .catch((cause: Error) => { if (cause.name !== "AbortError") setError(cause.message); });
    }, query ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, search]);
  const categories = useMemo(() => [...new Set((items ?? []).map((item) => item.categoryName).filter((name): name is string => Boolean(name)))].sort(), [items]);
  const shown = (items ?? []).filter((item) => !category || item.categoryName === category);
  const add = (hit: CatalogHit) => { onAdd(hit, areaId); setAdded(hit.id); window.setTimeout(() => setAdded((current) => (current === hit.id ? null : current)), 1600); };
  return <div className={catalog.panel}>
    <div className={catalog.head}>
      <SearchInput inputRef={searchInput} label={t("Search the catalog")} value={query} onChange={setQuery} />
      {canEdit ? <label className={catalog.target}>
        <span>{t("Add to")}</span>
        <CellPicker label={t("Area to add to")} value={areaId} options={areas} noneLabel={t("General")} onChange={onAreaChange} bordered />
      </label> : null}
      {categories.length > 1 ? <div className={catalog.chips} role="group" aria-label={t("Categories")}>
        <Button size="compact" variant="quiet" aria-pressed={!category} onPress={() => setCategory(null)}>{t("All")}</Button>
        {categories.map((name) => <Button key={name} size="compact" variant="quiet" aria-pressed={category === name} onPress={() => setCategory(category === name ? null : name)}>{name}</Button>)}
      </div> : null}
    </div>
    <div className={catalog.list}>
      {error ? <p className={catalog.error}>{error}</p> : !items ? <Skeleton lines={6} shape="rows" /> : !shown.length
        ? <p className={catalog.empty}>{query ? t("Nothing in the catalog matches “{query}”.", { query }) : t("The catalog is empty.")}</p>
        : shown.map((hit) => <div key={hit.id} className={catalog.item}>
          <span className={catalog.thumb}>{hit.imageId ? <img src={thumb(hit.imageId)} alt="" /> : <ImageIcon aria-hidden="true" size={16} />}</span>
          <span className={catalog.name}>
            <span>{hit.name}</span>
            <small>{[hit.categoryName, hit.code].filter(Boolean).join(" · ")}</small>
          </span>
          <span className={catalog.price}>{hit.rate ? <>{money(hit.rate, currency, decimals, locale)}<small> / {hit.unitCode}</small></> : hit.hasBuildUp ? <small>{t("Priced from parts")}</small> : <small>{t("No price")}</small>}</span>
          {canEdit ? <button type="button" className={catalog.add} aria-label={t("Add {name}", { name: hit.name })} onClick={() => add(hit)} data-done={added === hit.id || undefined}>
            {added === hit.id ? <Check aria-hidden="true" size={15} /> : <Plus aria-hidden="true" size={15} />}
          </button> : null}
        </div>)}
    </div>
    <span className={catalog.srOnly} aria-live="polite">{added ? t("Added") : ""}</span>
  </div>;
}
