"use client";

import type { WorkspaceSearchKind, WorkspaceSearchResponse } from "@wodana/contracts";
import Link from "next/link";
import { useEffect, useState, type Ref } from "react";
import { Badge, Button, SearchInput, Skeleton } from "@/design-system";
import styles from "./workspace.module.css";

const kindLabel: Record<WorkspaceSearchKind, string> = {
  customer: "Customer",
  job: "Job",
  room: "Room",
  quotation: "Quotation",
  project: "Project",
};

type SearchState = {
  error: string;
  loading: boolean;
  response: WorkspaceSearchResponse | null;
};

const emptyState: SearchState = { error: "", loading: false, response: null };

export function WorkspaceUniversalSearch({
  inputRef,
  onNavigate,
  onQueryChange,
  query,
  workspaceId,
}: {
  inputRef?: Ref<HTMLInputElement>;
  onNavigate?: () => void;
  onQueryChange: (value: string) => void;
  query: string;
  workspaceId: string;
}) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>(emptyState);
  const normalized = query.trim();

  useEffect(() => {
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState((current) => ({ ...current, error: "", loading: true }));
      try {
        const params = new URLSearchParams({ workspaceId, q: normalized, limit: "20" });
        const response = await fetch(`/api/workspace/search?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as WorkspaceSearchResponse | { message?: string } | null;
        if (!response.ok) throw new Error(payload && "message" in payload && payload.message ? payload.message : "Workspace search could not be loaded.");
        setState({ error: "", loading: false, response: payload as WorkspaceSearchResponse });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ error: error instanceof Error ? error.message : "Workspace search could not be loaded.", loading: false, response: null });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, retry, workspaceId]);

  const open = normalized.length >= 2;
  return (
    <div className={styles.universalSearch}>
      <SearchInput
        inputRef={inputRef}
        label="Search workspace"
        onChange={onQueryChange}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onQueryChange("");
            event.currentTarget.blur();
          }
        }}
        placeholder="Search records and pages…"
        value={query}
      />
      {open ? (
        <div aria-label="Workspace search results" aria-live="polite" className={styles.searchResults} role="region">
          {state.loading ? <div className={styles.searchLoading}><Skeleton lines={3} /><span className="wd-visually-hidden">Searching workspace</span></div> : null}
          {!state.loading && state.error ? (
            <div className={styles.searchMessage} role="alert">
              <span>{state.error}</span>
              <Button onPress={() => setRetry((value) => value + 1)} size="compact" variant="quiet">Retry</Button>
            </div>
          ) : null}
          {!state.loading && !state.error && state.response?.items.length === 0 ? (
            <p className={styles.searchMessage}>No permitted records found.</p>
          ) : null}
          {!state.loading && !state.error && state.response?.items.map((item) => (
            <Link className={styles.searchResult} href={item.route} key={`${item.kind}:${item.id}`} onClick={onNavigate}>
              <span className={styles.searchResultHeading}>
                <strong>{item.title}</strong>
                <Badge>{kindLabel[item.kind]}</Badge>
              </span>
              <small>{item.reference && !item.subtitle.includes(item.reference) ? `${item.reference} · ` : ""}{item.subtitle}</small>
            </Link>
          ))}
          {!state.loading && !state.error && state.response?.truncated ? <p className={styles.searchFooter}>Refine your search to see more.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
