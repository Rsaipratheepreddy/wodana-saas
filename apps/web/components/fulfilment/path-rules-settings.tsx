"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, FormDialog, InlineNotice, NoAccessState, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput, isNoAccessError } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { FURNITURE_PATHS } from "@/lib/crm/opportunity-flow";
import { fulfilmentApi } from "@/lib/fulfilment/client";
import type { DeductEvent, FurniturePath, PathRule, ReserveEvent, RulesState, RuleSettings } from "@/lib/fulfilment/types";

const RESERVE: Record<ReserveEvent, MessageKey> = {
  none: tKey("Not held"), quote_accepted: tKey("When the client approves the quotation"), supplier_received: tKey("When the supplier's order arrives"),
  production_booked: tKey("When production is booked"),
};
const DEDUCT: Record<DeductEvent, MessageKey> = {
  none: tKey("Not taken out"), won: tKey("At Won"), fulfilled: tKey("At collection or delivery"), production_started: tKey("When production starts"),
};
const BLANK: RuleSettings = { boqRequired: null, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, leadFrom: "won", leadFromCatalogue: false, takeFromLocationId: null };

/** One rule as a line of text: BOQ, stock and lead time. */
export function ruleSummary(t: Translate, rule: RuleSettings, places: RulesState["places"]) {
  const boq = rule.boqRequired === null ? t("BOQ as in quotation settings") : rule.boqRequired ? t("BOQ required") : t("No BOQ");
  const stock = rule.reserveOn === "none" && rule.deductOn === "none" ? t("Stock untouched")
    : `${t("Held: {when}", { when: t(RESERVE[rule.reserveOn]).toLocaleLowerCase() })} · ${t("Out: {when}", { when: t(DEDUCT[rule.deductOn]).toLocaleLowerCase() })}`;
  const place = rule.takeFromLocationId ? places.find((item) => item.id === rule.takeFromLocationId)?.name ?? null : null;
  const lead = rule.leadMinDays === null ? (rule.leadFromCatalogue ? t("Lead time from the catalogue") : null)
    : t("{from}–{to} working days from {anchor}", { from: rule.leadMinDays, to: rule.leadMaxDays ?? rule.leadMinDays,
      anchor: rule.leadFrom === "won" ? t("Won") : t("the drawing approval") });
  return [boq, stock, place ? t("From {place}", { place }) : null, lead].filter(Boolean).join(" · ");
}

/**
 * Settings → Orders by path (PLM-083/125/126): per enquiry type and, for furniture, per path, whether an order needs a
 * BOQ, which events hold and take out stock (and from where), and the lead time in working days. Configuration only;
 * every rule applies to the next event.
 */
export function PathRulesSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => fulfilmentApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<RulesState | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ flowId: string; path: FurniturePath | null } | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.rules()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The rules didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !state) return isNoAccessError(error) ? <NoAccessState area={t("Orders by path")} />
    : <EmptyState illustration="error" title={t("The rules didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!state) return <Skeleton lines={6} shape="form" />;
  const pathName = (path: FurniturePath | null) => {
    const found = FURNITURE_PATHS.find((item) => item.id === path);
    return found ? `${found.letter} · ${t(found.label)}` : t("Every order");
  };
  const flow = editing ? state.flows.find((item) => item.id === editing.flowId) : undefined;
  const save = async (next: RuleSettings) => {
    if (!flow || !editing) return;
    const others = flow.rules.filter((rule) => rule.furniturePath !== editing.path).map(({ version: _version, ...rule }) => rule);
    const rules = [...others, { ...next, furniturePath: editing.path }];
    setState(await api.saveRules(flow.id, rules, flow.rules.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`)));
    setEditing(null);
  };

  return <SettingsPage title={t("Orders by path")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {state.flows.map((item) => {
      const paths: Array<FurniturePath | null> = item.furniture ? [null, ...FURNITURE_PATHS.map((path) => path.id)] : [null];
      return <SettingsSection key={item.id} id={item.id} title={item.enquiryTypes.length ? item.enquiryTypes.join(", ") : item.name}>
        {paths.map((path) => {
          const own = item.rules.find((rule) => rule.furniturePath === path);
          const shown = own ?? item.rules.find((rule) => rule.furniturePath === null) ?? { ...BLANK, furniturePath: null, version: 0 };
          return <SettingsRow key={path ?? "all"} label={pathName(path)} hint={`${ruleSummary(t, shown, state.places)}${!own && path ? ` · ${t("as for every order")}` : ""}`}>
            <Button size="compact" variant="quiet" aria-label={t("Change {path}", { path: pathName(path) })} onPress={() => setEditing({ flowId: item.id, path })}>{t("Change")}</Button>
          </SettingsRow>;
        })}
      </SettingsSection>;
    })}
    {editing && flow ? <RuleDialog title={`${flow.enquiryTypes[0] ?? flow.name} · ${pathName(editing.path)}`} places={state.places} qsReview={state.qsReview}
      rule={flow.rules.find((rule) => rule.furniturePath === editing.path) ?? flow.rules.find((rule) => rule.furniturePath === null) ?? { ...BLANK, furniturePath: null, version: 0 }}
      onClose={() => setEditing(null)} onSave={save} /> : null}
  </SettingsPage>;
}

function RuleDialog({ title, rule, places, qsReview, onClose, onSave }: {
  title: string; rule: PathRule; places: RulesState["places"]; qsReview: boolean; onClose: () => void; onSave: (rule: RuleSettings) => Promise<void>;
}) {
  const t = useT();
  const { furniturePath: _path, version: _version, ...initial } = rule;
  const [draft, setDraft] = useState<RuleSettings>(initial);
  const [lead, setLead] = useState({ min: initial.leadMinDays === null ? "" : String(initial.leadMinDays), max: initial.leadMaxDays === null ? "" : String(initial.leadMaxDays) });
  const days = (value: string) => value.replace(/\D/g, "").slice(0, 3);
  const leadValid = (lead.min === "") === (lead.max === "") && (lead.min === "" || Number(lead.min) <= Number(lead.max));
  const set = (patch: Partial<RuleSettings>) => setDraft({ ...draft, ...patch });
  return <FormDialog size="md" title={title} submitLabel={t("Save")} isDirty isSubmitDisabled={!leadValid} onClose={onClose}
    onSubmit={() => onSave({ ...draft, leadMinDays: lead.min === "" ? null : Number(lead.min), leadMaxDays: lead.max === "" ? null : Number(lead.max) })}>
    <SelectField label={t("BOQ required")} selectedKey={draft.boqRequired === null ? "default" : draft.boqRequired ? "yes" : "no"}
      onSelectionChange={(key) => set({ boqRequired: key === "yes" ? true : key === "no" ? false : null })}
      items={[{ id: "default", label: qsReview ? t("As in quotation settings (yes)") : t("As in quotation settings (no)") }, { id: "yes", label: t("Yes") }, { id: "no", label: t("No") }]} />
    <SelectField label={t("Stock is held")} selectedKey={draft.reserveOn} onSelectionChange={(key) => set({ reserveOn: (key ?? "none") as ReserveEvent })}
      items={(Object.keys(RESERVE) as ReserveEvent[]).map((id) => ({ id, label: t(RESERVE[id]) }))} />
    <SelectField label={t("Stock is taken out")} selectedKey={draft.deductOn} onSelectionChange={(key) => set({ deductOn: (key ?? "none") as DeductEvent })}
      items={(Object.keys(DEDUCT) as DeductEvent[]).map((id) => ({ id, label: t(DEDUCT[id]) }))} />
    <SelectField label={t("Take stock from")} selectedKey={draft.takeFromLocationId ?? "default"} onSelectionChange={(key) => set({ takeFromLocationId: !key || key === "default" ? null : String(key) })}
      items={[{ id: "default", label: t("The default places") }, ...places.map((place) => ({ id: place.id, label: place.name }))]} />
    <TextInput label={t("Lead time from")} inputMode="numeric" suffix={t("working days")} value={lead.min} onChange={(value) => setLead({ ...lead, min: days(value) })} />
    <TextInput label={t("Lead time to")} inputMode="numeric" suffix={t("working days")} value={lead.max} onChange={(value) => setLead({ ...lead, max: days(value) })}
      errorMessage={leadValid ? undefined : t("Give both days, the first no later than the last.")} isInvalid={!leadValid} />
    <SelectField label={t("Counted from")} selectedKey={draft.leadFrom} onSelectionChange={(key) => set({ leadFrom: key === "drawing_approved" ? "drawing_approved" : "won" })}
      items={[{ id: "won", label: t("Won") }, { id: "drawing_approved", label: t("The drawing approval") }]} />
    <Switch isSelected={draft.leadFromCatalogue} onChange={(leadFromCatalogue) => set({ leadFromCatalogue })}>{t("At least the catalogue's production or supplier time")}</Switch>
  </FormDialog>;
}
