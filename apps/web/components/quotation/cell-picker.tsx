"use client";

import { ComboBox, Input, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { Plus } from "lucide-react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./quote-builder.module.css";

type Option = { id: string; name: string };
const NONE = "__none";
const CREATE = "__create";

/**
 * A choice inside a grid cell (a line's area or work package): it reads as plain text until focused,
 * opens the whole list on click, filters as you type, and can offer "New …" at the end.
 */
export function CellPicker({ label, value, options, noneLabel, onChange, onCreate, createLabel, isDisabled, bordered }: {
  label: string; value: string | null; options: Option[]; noneLabel: string; onChange: (id: string | null) => void;
  onCreate?: () => void; createLabel?: string; isDisabled?: boolean;
  /** Shown as a field (outside the table). */
  bordered?: boolean;
}) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const items = [{ id: NONE, name: noneLabel }, ...options, ...(onCreate && createLabel ? [{ id: CREATE, name: createLabel }] : [])];
  return <ComboBox aria-label={label} className={styles.picker} data-bordered={bordered || undefined} data-empty={value === null || undefined} items={items} selectedKey={value ?? NONE} menuTrigger="focus" isDisabled={isDisabled}
    onSelectionChange={(key) => {
      if (key === null) return;
      if (key === CREATE) { onCreate?.(); return; }
      onChange(key === NONE ? null : String(key));
    }}>
    <Input className={styles.pickerInput} onFocus={(event) => event.currentTarget.select()} />
    <Popover UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-picker-popover" dir={direction} placement="bottom start">
      <ListBox renderEmptyState={() => <p className="wd-picker-empty">{t("No matches")}</p>}>
        {(item: Option) => <ListBoxItem className="wd-picker-item" id={item.id} textValue={item.name}>
          {item.id === CREATE ? <span className={styles.pickerCreate}><Plus aria-hidden="true" size={13} />{item.name}</span> : item.name}
        </ListBoxItem>}
      </ListBox>
    </Popover>
  </ComboBox>;
}
