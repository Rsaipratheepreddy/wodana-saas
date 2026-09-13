"use client";
import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/commercial/client";
import { projectPath, type ProjectState } from "@/lib/projects/execution";
import s from "./project-workspace.module.css";
type LegacyImport = {
  id: string;
  hash: string;
  imported: string;
  content: {
    notice: string;
    cutoverReference: string;
    sourceProject: string;
    records: Record<string, number>;
    baselineReview: { id: string; name: string; legacyPercent: number }[];
    snapshot: unknown;
  };
};
export function ProjectLegacy({ state }: { state: ProjectState }) {
  const [imports, setImports] = useState<LegacyImport[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    jsonRequest<{ imports: LegacyImport[] }>(
      projectPath(state.workspaceId, `${state.id}/legacy`),
    )
      .then((r) => active && setImports(r.imports))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [state.workspaceId, state.id]);
  return (
    <div className={s.form}>
      <h2>Imported project records</h2>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {imports.map((i) => (
        <section className={s.form} key={i.id}>
          <div className={s.row}>
            <div>
              <strong>Legacy project {i.content.sourceProject}</strong>
              <span className={s.detail}>
                {new Date(i.imported).toLocaleString()} ·{" "}
                {i.content.cutoverReference}
              </span>
            </div>
            <button
              className={s.button}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(i.content, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = `project-source-${i.id}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download source evidence
            </button>
          </div>
          <p className={s.notice}>{i.content.notice}</p>
          <div className={s.scroll}>
            <table data-record-table="" className={s.table}>
              <thead>
                <tr>
                  <th>Source register</th>
                  <th>Preserved records</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(i.content.records).map(([key, count]) => (
                  <tr key={key}>
                    <td>{key.replaceAll("_", " ")}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Opening progress to review</h3>
          {i.content.baselineReview.map((t) => (
            <div className={s.row} key={t.id}>
              <strong>{t.name}</strong>
              <span>
                {t.legacyPercent}% in source · independent baseline review
                required
              </span>
            </div>
          ))}
          <p className={s.muted}>Source checksum: {i.hash}</p>
        </section>
      ))}
    </div>
  );
}
