import type { Metadata } from "next";
import { ContactFormSettings } from "@/components/control-plane/contact-form-settings";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { NoAccessState } from "@/design-system";
import { consoleT, requireOperator } from "@/lib/internal/server";
import styles from "@/components/control-plane/control-plane.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Contact form")} · ${t("Wodana Control")}` };
}

export default async function InternalContactFormPage() {
  const operator = await requireOperator();
  const t = await consoleT();
  return <OperatorShell operator={operator}>
    {operator.permissions.includes("sales.read")
      ? <ContactFormSettings canManage={operator.permissions.includes("sales.manage")} />
      : <div className={styles.page}><NoAccessState area={t("Contact form")} /></div>}
  </OperatorShell>;
}
