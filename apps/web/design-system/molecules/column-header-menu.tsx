"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { ArrowDown, ArrowUp, EyeOff, MoreVertical, RotateCcw } from "lucide-react";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { IconButton } from "../components/actions";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";

/** Small, keyboard-accessible column actions composed from the shared atoms. */
export function ColumnHeaderMenu({ canHide, canSort, label, onHide, onResetWidth, onSortAscending, onSortDescending }: {
  canHide: boolean;
  canSort: boolean;
  label: string;
  onHide: () => void;
  onResetWidth: () => void;
  onSortAscending: () => void;
  onSortDescending: () => void;
}) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <DialogTrigger>
    <IconButton aria-label={t("{column} column options", { column: label })} className="wd-column-options-trigger" size="compact" variant="quiet"><MoreVertical aria-hidden="true" size={15} /></IconButton>
    <Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-column-options-popover" dir={direction} placement="bottom end">
      <Dialog aria-label={t("{column} column options", { column: label })}>{({ close }) => <>
        <strong>{label}</strong>
        {canSort ? <>
          <button onClick={() => { onSortAscending(); close(); }} type="button"><ArrowUp aria-hidden="true" size={14} />{t("Sort ascending")}</button>
          <button onClick={() => { onSortDescending(); close(); }} type="button"><ArrowDown aria-hidden="true" size={14} />{t("Sort descending")}</button>
        </> : null}
        <button onClick={() => { onResetWidth(); close(); }} type="button"><RotateCcw aria-hidden="true" size={14} />{t("Reset width")}</button>
        {canHide ? <button onClick={() => { onHide(); close(); }} type="button"><EyeOff aria-hidden="true" size={14} />{t("Hide column")}</button> : null}
      </>}</Dialog>
    </Popover>
  </DialogTrigger>;
}
