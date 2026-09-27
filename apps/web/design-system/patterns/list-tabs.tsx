/** The lists a person works from (e.g. New · Contacted · Come back to), each with its count. */
export function ListTabs<T extends string>({ label, items, value, onChange }: { label: string; items: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (id: T) => void }) {
  return <div aria-label={label} className="wd-list-tabs" role="group">
    {items.map((item) => <button aria-pressed={value === item.id} className="wd-list-tab" key={item.id} onClick={() => onChange(item.id)} type="button">
      <span>{item.label}</span>{typeof item.count === "number" ? <span className="wd-count-chip wd-list-tab-count">{item.count}</span> : null}
    </button>)}
  </div>;
}
