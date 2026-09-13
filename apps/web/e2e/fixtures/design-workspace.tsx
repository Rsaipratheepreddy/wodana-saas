"use client";
import { DesignsPage } from "../../components/pre-project/designs-page";
import { DesignSystemProvider } from "../../design-system";
import colors from "../../components/crm/crm-workspace-colors.module.css";

import { designData, designItems, designOptions } from "./design-data";
export function DesignWorkspaceFixture() {
  return (
    <DesignSystemProvider className={colors.theme}>
      <main
        style={{
          padding: "16px",
          maxWidth: "1400px",
          margin: "auto",
          minWidth: 0,
        }}
      >
        <DesignsPage
          initialData={designData}
          initialDesigns={designItems}
          options={designOptions}
        />
      </main>
    </DesignSystemProvider>
  );
}
