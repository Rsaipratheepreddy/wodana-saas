/** The most tabs a view may show (§5c D3); more belongs in a filter. */
export const MAX_TABS = 6;

/**
 * The lists a person works from (e.g. All · Ready to start · In design), under the title. The active tab is
 * bold and underlined. A count shows only when it asks for action: pass `count` for those tabs; zero hides.
 */
export function ListTabs<T extends string>({ label, items, value, onChange }: { label: string; items: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (id: T) => void }) {
  if (items.length > MAX_TABS && process.env.NODE_ENV !== "production") console.error(`ListTabs "${label}" has ${items.length} tabs; at most ${MAX_TABS} are allowed. Move the rest into a filter.`);
  return <div aria-label={label} className="wd-list-tabs" role="group">
    {items.map((item) => <button aria-pressed={value === item.id} className="wd-list-tab" key={item.id} onClick={() => onChange(item.id)} type="button">
      <span className="wd-list-tab-label" data-label={item.label}>{item.label}</span>{item.count ? <span className="wd-count-chip wd-list-tab-count">{item.count}</span> : null}
    </button>)}
  </div>;
}
