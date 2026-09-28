"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState, ErrorState, NoAccessState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import { isDenied, purchasingApi } from "@/lib/purchasing/client";
import type { ArrivalsState } from "@/lib/purchasing/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { orderNumber } from "../factory/factory-labels";
import { MoveSheet } from "../inventory/moves";
import { Cell, DueText, Section, operationsStyles as ops } from "../operations/ops";
import { quantityText, useOrderLabels } from "./order-labels";
import { ReceiveDialog } from "./receive-dialog";

// Deliveries and moves change what's on its way.
const SCOPES = ["purchasing", "factory"] as const;

/**
 * What's on its way to one project's site (D-20): supplier orders delivering there with lines still to come,
 * and moves from the warehouse or the factory. Whoever receives goods receives them here, where they arrive.
 */
export function ProjectArrivals({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; switcher?: ReactNode }) {
  const t = useT();
  const labels = useOrderLabels();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const stock = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<ArrivalsState | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [move, setMove] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.arrivals(projectId)); setError(null); }
    catch (cause) { setError({ message: cause instanceof Error ? cause.message : t("What's on its way didn't load."), denied: isDenied(cause) }); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useLiveInvalidate(workspaceId, SCOPES, () => { if (!receiving && !move) void load(); }, 2_000);

  const toolbar = switcher ? <div className={ops.sectionHead}>{switcher}</div> : null;
  if (error && !state) return <>{toolbar}{error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</>;
  if (!state) return <>{toolbar}<Skeleton lines={4} shape="rows" /></>;
  const nothing = !state.orders.length && !state.moves.length;
  return <>
    {toolbar}
    {nothing ? <EmptyState illustration={null} title={t("Nothing on its way to site")} /> : null}
    {state.orders.length ? <Section title={t("From suppliers")}>
      <ul className={ops.list}>{state.orders.map((order) => {
        const due = order.items.map((item) => item.due).filter((value): value is string => Boolean(value)).sort()[0] ?? order.due ?? null;
        return <li key={order.id}>
          <Cell title={order.items.map((item) => `${item.description} · ${quantityText(item.left)} ${item.unit}`.trim()).join(", ")}
            meta={<><Link className={ops.projectLink} href={`/workspace/purchasing/orders?order=${order.id}`}>{order.number}</Link>{` · ${order.supplierName}`}
              {order.shipment ? ` · ${[labels.shipment[order.shipment.status], order.shipment.carrier].filter(Boolean).join(" ")}` : ""}</>}
            tone={order.shipment?.status === "delayed" ? "danger" : undefined} />
          <DueText date={due} />
          {state.canReceive ? <Button size="compact" variant="secondary" aria-label={t("Receive {order}", { order: order.number })} onPress={() => setReceiving(order.id)}>{t("Receive")}</Button> : null}
        </li>;
      })}</ul>
    </Section> : null}
    {state.moves.length ? <Section title={t("From our stock and factory")}>
      <ul className={ops.list}>{state.moves.map((trip) => <li key={trip.id}>
        <Cell title={trip.items || t("Move {number}", { number: trip.number })}
          meta={<><Link className={ops.projectLink} href={`/workspace/inventory/moves?move=${trip.id}`}>{t("Move {number}", { number: trip.number })}</Link>
            {` · ${t("from {place}", { place: trip.fromName })}`}{trip.workOrderNumber ? ` · ${orderNumber(trip.workOrderNumber)}` : ""}</>} />
        <Badge tone="info">{t("On its way")}</Badge>
        {state.canReceiveMoves ? <Button size="compact" variant="secondary" aria-label={t("Receive move {number}", { number: trip.number })} onPress={() => setMove(trip.id)}>{t("Receive")}</Button> : null}
      </li>)}</ul>
    </Section> : null}
    {receiving ? <ReceiveDialog api={api} orderId={receiving} onClose={() => setReceiving(null)} onReceived={() => { setReceiving(null); void load(); }} /> : null}
    {move ? <MoveSheet api={stock} transferId={move} onChanged={() => void load()} onClose={() => { setMove(null); void load(); }} /> : null}
  </>;
}
