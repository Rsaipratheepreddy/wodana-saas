"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ControlledModalDialog } from "@/design-system";
import { Inbox } from "lucide-react";
import { hrmsRequest } from "@/lib/hrms/client";
import styles from "./hrms.module.css";
export function useHrms<T>(
  workspaceId: string,
  path: string,
  revision = 0,
  area = "hrms",
) {
  const resource = `${workspaceId}:${area}:${path}`,
    key = `${resource}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    resource: string;
    data: T | null;
    error: string;
    fetchedAt: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    hrmsRequest<T>(workspaceId, path, "GET", undefined, area)
      .then((data) => {
        if (!cancelled)
          setResult({ key, resource, data, error: "", fetchedAt: Date.now() });
      })
      .catch((e) => {
        if (!cancelled)
          setResult({
            key,
            resource,
            data: null,
            error: e.message,
            fetchedAt: Date.now(),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path, area, key, resource]);
  return {
    data: result?.resource === resource ? result.data : null,
    error: result?.key === key ? result.error : "",
    loading: result?.key !== key,
    fetchedAt: result?.fetchedAt ?? 0,
  };
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={error ? styles.error : styles.notice}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <Inbox size={28} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ControlledModalDialog
      title={title}
      isDismissable={false}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className={styles.modalBody}>{children}</div>
    </ControlledModalDialog>
  );
}
