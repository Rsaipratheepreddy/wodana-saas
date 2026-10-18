"use client";

import { useEffect, useState } from "react";
import { Checkbox, FormDialog, FormSection, Skeleton } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { FURNITURE_PATHS } from "@/lib/crm/opportunity-flow";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";

export type WonArea = "planning" | "production" | "supply" | "delivery" | "selection";
export const WON_AREAS: WonArea[] = ["planning", "production", "supply", "delivery", "selection"];
export const WON_AREA_LABEL: Record<WonArea, MessageKey> = { planning: tKey("Planning"), production: tKey("Production"), supply: tKey("Supply"), delivery: tKey("Delivery"),
  selection: tKey("Material selection") };
export type WonAreasRule = { furniturePath: string | null; areas: WonArea[]; version: number };
export type WonAreasView = { flowId: string; areas: WonArea[]; furniturePaths: string[]; rules: WonAreasRule[] };

/** The areas a path shows after Won: its own rule, else the type's, else every area. */
export function areasFor(rules: WonAreasRule[], path: string | null): WonArea[] {
  const rule = (path ? rules.find((item) => item.furniturePath === path) : undefined) ?? rules.find((item) => item.furniturePath === null);
  return rule ? WON_AREAS.filter((area) => rule.areas.includes(area)) : [...WON_AREAS];
}

/** "Planning, Delivery", "Every area" or "None", for the steps table. */
export function areasText(areas: WonArea[], t: Translate) {
  if (areas.length === WON_AREAS.length) return t("Every area");
  if (!areas.length) return t("None");
  return areas.map((area) => t(WON_AREA_LABEL[area])).join(", ");
}

/**
 * The rules to save from what each path shows: none when every path shows every area (the default), otherwise the
 * type's areas and a rule only for the paths that differ from it.
 */
export function wonAreasRules(draft: Record<string, WonArea[]>, paths: string[]) {
  const type = draft[""] ?? [...WON_AREAS];
  const own = paths.filter((path) => (draft[path] ?? type).join() !== type.join());
  if (type.length === WON_AREAS.length && !own.length) return [];
  return [{ furniturePath: null, areas: type }, ...own.map((path) => ({ furniturePath: path, areas: draft[path] }))];
}

/**
 * PLM-098: which areas a job of this enquiry type shows after Won (Planning, Production, Supply, Delivery), for the
 * type and, for furniture, per path A–E. An area that already holds a record still shows on that job.
 */
export function WonAreasDialog({ workspaceId, flowId, typeName, onClose }: { workspaceId: string; flowId: string; typeName: string; onClose: () => void }) {
  const t = useT();
  const [view, setView] = useState<WonAreasView | null>(null);
  const [failure, setFailure] = useState("");
  const [draft, setDraft] = useState<Record<string, WonArea[]>>({});
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<WonAreasView>(workspaceId, `flows/${flowId}/won-areas`, "GET", undefined, controller.signal).then((next) => {
      setView(next);
      setDraft(Object.fromEntries(["", ...next.furniturePaths].map((path) => [path, areasFor(next.rules, path || null)])));
    }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId, flowId]);
  const paths = view?.furniturePaths ?? [];
  const initial = view ? JSON.stringify(Object.fromEntries(["", ...paths].map((path) => [path, areasFor(view.rules, path || null)]))) : "";
  const toggle = (path: string, area: WonArea, on: boolean) => setDraft((current) => {
    const before = current[path] ?? [...WON_AREAS];
    const next = WON_AREAS.filter((item) => (item === area ? on : before.includes(item)));
    // A change on the type carries to the paths that followed it.
    if (path !== "") return { ...current, [path]: next };
    return Object.fromEntries(Object.entries(current).map(([key, value]) => [key, key === "" || value.join() === before.join() ? next : value]));
  });
  const section = (path: string, title: string) => <FormSection key={path || "type"} title={title}>
    {WON_AREAS.map((area) => <Checkbox key={area} isSelected={(draft[path] ?? WON_AREAS).includes(area)} onChange={(on) => toggle(path, area, on)}>{t(WON_AREA_LABEL[area])}</Checkbox>)}
  </FormSection>;
  return <FormDialog size="md" title={t("Areas after Won")} description={typeName} submitLabel={t("Save")} error={failure || undefined}
    isDirty={Boolean(view) && JSON.stringify(draft) !== initial} isSubmitDisabled={!view} onClose={onClose}
    onSubmit={async () => {
      await crmRequest(workspaceId, `flows/${flowId}/won-areas`, "PUT", { rules: wonAreasRules(draft, paths), versions: view!.rules.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`).join(",") });
      onClose();
    }}>
    {!view ? (failure ? null : <Skeleton lines={4} shape="form" />) : <>
      {section("", t("This type"))}
      {paths.map((path) => {
        const choice = FURNITURE_PATHS.find((item) => item.id === path);
        return section(path, choice ? `${choice.letter} · ${t(choice.label)}` : path);
      })}
    </>}
  </FormDialog>;
}
