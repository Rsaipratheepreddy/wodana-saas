"use client";

import { AlertCircle } from "lucide-react";
import { Button, DesignSystemProvider } from "@/design-system";
import styles from "./workspace-error.module.css";

export default function WorkspaceScreenError({ reset }: { reset: () => void }) {
  return (
    <DesignSystemProvider className={styles.root}>
      <section aria-labelledby="workspace-error-heading" className={styles.error}>
        <AlertCircle aria-hidden="true" size={22} />
        <h1 id="workspace-error-heading">Org profile could not be loaded</h1>
        <p>Check the service connection, then try loading this page again.</p>
        <Button onPress={reset} variant="primary">Try again</Button>
      </section>
    </DesignSystemProvider>
  );
}
