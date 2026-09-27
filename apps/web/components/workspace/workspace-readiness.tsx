"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Building2, Check, FileText, Globe2, Import, Plug, Users } from "lucide-react";
import { Button, ControlledModalDialog } from "@/design-system";
import s from "./workspace-readiness.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

export type ReadinessData = { company: boolean | null; regional: boolean | null; people: boolean | null; connections: boolean | null };

/** The setup steps for this workspace's modules and how many are done; `readiness` unknown means nothing is done yet. */
export function useWorkspaceSetupSteps(readiness: ReadinessData | undefined, modules: string[]) {
  const t = useT();
  const steps = [
    { id: "company", label: t("Company details"), description: t("Make your documents yours."), href: "/workspace/company", action: t("Review company"), Icon: Building2, done: readiness?.company },
    { id: "regional", label: t("Regional defaults"), description: t("Consistent dates, prices and units."), href: "/workspace/company", action: t("Review defaults"), Icon: Globe2, done: readiness?.regional },
    { id: "people", label: t("People & roles"), description: t("Give everyone the right access."), href: "/workspace/members", action: t("Manage people"), Icon: Users, done: readiness?.people },
    ...(modules.includes("crm") || modules.includes("pre-project") ? [{ id: "data", label: t("Bring your data"), description: t("Start with the records you already have."), href: "", action: t("Choose data"), Icon: Import, done: false }] : []),
    ...(modules.includes("pre-project") ? [{ id: "quotations", label: t("Quotation templates"), description: t("Prepare a consistent starting point."), href: "/workspace/pre-projects/quotation-templates", action: t("Open templates"), Icon: FileText, done: false }] : []),
    { id: "connections", label: t("Connect your tools"), description: t("Keep conversations and accounts together."), href: "/workspace/integrations", action: t("View connections"), Icon: Plug, done: readiness?.connections },
  ];
  const completed = steps.filter((step) => step.done === true).length;
  return { steps, completed, total: steps.length };
}

/** The setup checklist with each step's link; whoever shows it (the account menu) names and counts it. */
export function WorkspaceSetupChecklist({ readiness, modules }: { readiness?: ReadinessData; modules: string[] }) {
  const t = useT();
  const { steps } = useWorkspaceSetupSteps(readiness, modules);
  const [imports, setImports] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setImports(false); }, [pathname]);
  return <div className={s.readiness}>
    <div className={s.steps} aria-label={t("Setup tasks")}>{steps.map((step) => <div key={step.id} className={s.taskRow} data-complete={step.done === true}>
      <span className={s.checkbox} data-done={step.done === true} aria-hidden="true">{step.done === true && <Check size={12} strokeWidth={3} />}</span>
      <span className={s.taskLabel}>{step.label}<small>{step.description}</small></span><span className={s.stepArt} aria-hidden="true"><step.Icon size={28} strokeWidth={1.6} /></span>
      {step.done !== true && (step.id === "data" ? <Button size="compact" onPress={() => setImports(true)}>{t("Choose data")}<ArrowRight size={14} /></Button> : <Link className={s.rowAction} href={step.href}>{step.action}<ArrowRight size={14} /></Link>)}
    </div>)}</div>
    <ControlledModalDialog isOpen={imports} onOpenChange={setImports} title={t("Bring your data")} description={t("Choose what you want to add to your workspace.")} size="md">
      <div className={s.importOptions}>{modules.includes("pre-project") && <Link href="/workspace/catalogs"><span className={s.icon}><Import size={18} /></span><span><strong>{t("Materials & catalog")}</strong><small>{t("Use Import in Catalog to upload and review your sheet.")}</small></span><ArrowRight size={16} /></Link>}{modules.includes("crm") && <div><span className={s.icon}><Users size={18} /></span><span><strong>{t("Clients & contacts")}</strong><small>{t("Bulk import is being built. You can add clients individually now.")}</small><Link href="/workspace/crm/customers">{t("Open clients")}<ArrowRight size={13} /></Link></span><span className={s.tag}>{t("Next")}</span></div>}</div>
    </ControlledModalDialog>
  </div>;
}
