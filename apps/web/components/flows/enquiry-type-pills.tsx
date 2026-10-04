"use client";

import { ChevronDown, Plus } from "lucide-react";
import { Autocomplete, Button as AriaButton, Dialog, DialogTrigger, Menu, MenuItem, MenuTrigger, Popover, useFilter } from "react-aria-components";
import { Button, SearchInput, typeHue, useDesignSystem, usePortalThemeAttributes, type ActionItem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./flows.module.css";

/** The type's colour as a small dot: the same type always gets the same colour, the pill itself stays neutral. */
export function TypeDot({ code }: { code: string }) {
  return <span aria-hidden="true" className={styles.typeDot} data-hue={typeHue(code)} />;
}

/** An enquiry type as a read-only pill (the builder's "Used by"). */
export function TypeLabel({ code, label }: { code: string; label: string }) {
  return <span className={styles.pill} data-static=""><TypeDot code={code} /><span className={styles.pillLabel}>{label}</span></span>;
}

/** An enquiry type as one self-contained pill: dot, name and chevron are a single button that opens its menu. */
export function EnquiryTypePill({ code, isDisabled, items, label, onAction }: {
  code: string; isDisabled?: boolean; items: ActionItem[]; label: string; onAction: (id: string) => void;
}) {
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <MenuTrigger>
    <AriaButton className={styles.pill} isDisabled={isDisabled || !items.length}>
      <TypeDot code={code} /><span className={styles.pillLabel}>{label}</span><ChevronDown aria-hidden="true" className={styles.pillChevron} size={12} />
    </AriaButton>
    <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom start">
      <Menu aria-label={label} className="wd-menu" items={items} onAction={(id) => onAction(String(id))}>
        {(item) => <MenuItem className="wd-menu-item" id={item.id} isDisabled={item.isDisabled} textValue={item.label}><span data-tone={item.tone}>{item.label}</span></MenuItem>}
      </Menu>
    </Popover>
  </MenuTrigger>;
}

export type TypeChoice = { id: string; code: string; label: string; /** The flow it follows now, when it is in one. */ flowName?: string };

/** "Add enquiry type": a quiet button that opens a searchable list of the types not in this flow. */
export function AddEnquiryType({ choices, isDisabled, onPick }: { choices: TypeChoice[]; isDisabled?: boolean; onPick: (id: string) => void }) {
  const t = useT();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const { contains } = useFilter({ sensitivity: "base" });
  return <DialogTrigger>
    <Button className={styles.addType} intent="write" isDisabled={isDisabled} size="compact" variant="quiet"><Plus aria-hidden="true" size={14} />{t("Add enquiry type")}</Button>
    <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom start">
      <Dialog aria-label={t("Add enquiry type")} className={styles.typePicker}>
        {({ close }) => <Autocomplete filter={contains}>
          <SearchInput autoFocus label={t("Search enquiry types")} />
          <Menu aria-label={t("Enquiry types")} className={`wd-menu ${styles.typePickerList}`} items={choices}
            onAction={(id) => { close(); onPick(String(id)); }}
            renderEmptyState={() => <p className={styles.typePickerEmpty}>{t("No matches")}</p>}>
            {(choice) => <MenuItem className={`wd-menu-item ${styles.typePickerItem}`} id={choice.id} textValue={choice.label}>
              <TypeDot code={choice.code} /><span className={styles.pillLabel}>{choice.label}</span>
              {choice.flowName ? <small> {t("in {flow}", { flow: choice.flowName })}</small> : null}
            </MenuItem>}
          </Menu>
        </Autocomplete>}
      </Dialog>
    </Popover>
  </DialogTrigger>;
}
