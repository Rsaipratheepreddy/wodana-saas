import { useEffect, useState } from "react";
import { useAuth } from "../auth/provider";
export type * from "../../../../packages/contracts/src/hrms";
export function useHrms<T>(
  workspaceId: string,
  path: string,
  revision = 0,
  area = "hrms",
) {
  const { client } = useAuth();
  const resource = `${workspaceId}:${area}:${path}`;
  const key = `${resource}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    resource: string;
    data: T | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    client
      .api<T>(`/workspaces/${workspaceId}/${area}${path ? "/" + path : ""}`)
      .then((data) => {
        if (active) setResult({ key, resource, data, error: "" });
      })
      .catch((e) => {
        if (active) setResult({ key, resource, data: null, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [client, workspaceId, area, path, key, resource]);
  return {
    data: result?.resource === resource ? result.data : null,
    error: result?.key === key ? result.error : "",
    loading: result?.key !== key,
  };
}
export function localDay(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date),
    part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const statusLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
export const timeLabel = (value: string | null, timezone: string) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "In progress";
