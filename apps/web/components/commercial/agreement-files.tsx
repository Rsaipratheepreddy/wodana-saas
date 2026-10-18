"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { Button, InlineNotice } from "@/design-system";
import { AssetFiles, AssetUpload } from "../pre-project/case-controls";
import type { CaseAsset } from "@/lib/pre-project/content";
import type { CommercialState } from "@/lib/commercial/types";
import styles from "./agreement-files.module.css";

export function AgreementFiles({ state, run, busy }: {
  state: CommercialState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useT();
  const [pending, setPending] = useState<CaseAsset | null>(null);
  const [failure, setFailure] = useState("");
  const [linking, setLinking] = useState(false);
  const agreement = state.data.agreement;
  async function attach(asset: CaseAsset) {
    setPending(asset); setLinking(true); setFailure("");
    try {
      if (await run("attach_agreement_file", { assetId: asset.id, quoteId: agreement?.quoteId })) setPending(null);
      else setFailure(t("The file uploaded but could not be linked. Retry attaching it."));
    } catch { setFailure(t("Could not attach the uploaded file. Retry attaching it.")); }
    finally { setLinking(false); }
  }
  return <section className={styles.files} aria-label={t("Signed agreement files")}>
    <h3>{t("Signed documents")}</h3>
    <AssetFiles workspaceId={state.workspaceId} caseId={state.caseId} assets={agreement?.files ?? []} />
    {failure && <InlineNotice tone="error" message={failure} />}
    {pending ? <Button size="compact" isDisabled={busy || linking} onPress={() => void attach(pending)}>{t("Attach {name}", { name: pending.name })}</Button> : state.canEdit && agreement ? <AssetUpload workspaceId={state.workspaceId} caseId={state.caseId} multiple={false} label={t("Upload signed agreement")} currentCount={agreement.files?.length ?? 0} disabled={busy || linking} onUploaded={asset => void attach(asset)} onError={setFailure} /> : !agreement ? <p>{t("Save the agreement to attach its signed PDF or photos.")}</p> : null}
  </section>;
}
