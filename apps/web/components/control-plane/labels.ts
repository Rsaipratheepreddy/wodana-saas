"use client";

import { useMemo } from "react";
import { useDesignSystem, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type {
  AttentionReason,
  DomainState,
  LifecycleState,
  NoticeDeliveryState,
  NoticeStatus,
  SupportState,
} from "@/lib/internal/console";

type Label = { label: string; tone: StatusTone };

/** Dates, times and money in the operator's own language and time zone. */
export function useConsoleFormat() {
  const { locale, timeZone } = useDesignSystem();
  return useMemo(() => {
    const date = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" });
    const dateTime = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return {
      date: (value: string | null | undefined) => (value ? date.format(new Date(value)) : ""),
      dateTime: (value: string | null | undefined) => (value ? dateTime.format(new Date(value)) : ""),
      relative: (value: string | null | undefined) => {
        if (!value) return "";
        const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
        if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
        const hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 48) return relative.format(hours, "hour");
        return relative.format(Math.round(hours / 24), "day");
      },
      number: (value: number) => new Intl.NumberFormat(locale).format(value),
      money: (value: string | number | null, currency: string) => {
        if (value === null || value === "") return "";
        try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value)); }
        catch { return `${currency} ${value}`; }
      },
    };
  }, [locale, timeZone]);
}

export function useConsoleLabels() {
  const t = useT();
  return useMemo(() => {
    const state: Record<LifecycleState, Label> = {
      draft: { label: t("Draft"), tone: "neutral" },
      trial: { label: t("Trial"), tone: "info" },
      active: { label: t("Active"), tone: "success" },
      grace: { label: t("Grace"), tone: "warning" },
      suspended: { label: t("Suspended"), tone: "danger" },
      archived: { label: t("Archived"), tone: "neutral" },
    };
    const attention: Record<AttentionReason, string> = {
      payment_past_due: t("Payment past due"),
      grace: t("In grace"),
      suspended: t("Read-only"),
      domain: t("Domain needs attention"),
      support_open: t("Support session open"),
      owner_invitation: t("Owner invitation not delivered"),
      over_seats: t("Over seat limit"),
    };
    const support: Record<SupportState, Label> = {
      requested: { label: t("Requested"), tone: "warning" },
      approved: { label: t("Approved"), tone: "info" },
      active: { label: t("Active"), tone: "success" },
      rejected: { label: t("Rejected"), tone: "neutral" },
      revoked: { label: t("Revoked"), tone: "neutral" },
      expired: { label: t("Expired"), tone: "neutral" },
    };
    const domain: Record<DomainState, Label> = {
      requested: { label: t("Requested"), tone: "neutral" },
      verifying: { label: t("Verifying"), tone: "info" },
      verified: { label: t("Verified"), tone: "info" },
      certificate_issued: { label: t("Certificate issued"), tone: "info" },
      live: { label: t("Live"), tone: "success" },
      failed: { label: t("Failed"), tone: "danger" },
      removed: { label: t("Removed"), tone: "neutral" },
    };
    const notice: Record<NoticeStatus, Label> = {
      pending: { label: t("Sending"), tone: "info" },
      sent: { label: t("Delivered"), tone: "success" },
      failed: { label: t("Failed"), tone: "danger" },
      not_configured: { label: t("Email off"), tone: "warning" },
      skipped: { label: t("Skipped"), tone: "neutral" },
    };
    const delivery: Record<NoticeDeliveryState, Label> = {
      not_required: { label: t("No notice"), tone: "neutral" },
      pending: { label: t("Sending"), tone: "info" },
      sent: { label: t("Delivered"), tone: "success" },
      partial: { label: t("Partly delivered"), tone: "warning" },
      failed: { label: t("Failed"), tone: "danger" },
      not_configured: { label: t("Email off"), tone: "warning" },
    };
    const invitation = (status: string | null, deliveryStatus: string | null): Label => {
      if (status === "accepted") return { label: t("Accepted"), tone: "success" };
      if (status === "expired") return { label: t("Expired"), tone: "danger" };
      if (deliveryStatus === "failed") return { label: t("Not delivered"), tone: "danger" };
      if (deliveryStatus === "not_configured") return { label: t("Email off"), tone: "warning" };
      if (deliveryStatus === "sent") return { label: t("Sent"), tone: "info" };
      if (deliveryStatus === "pending") return { label: t("Sending"), tone: "info" };
      return { label: t("Not sent"), tone: "neutral" };
    };
    const event: Record<string, string> = {
      "lifecycle.trial_started": t("Trial started"),
      "lifecycle.activated": t("Activated"),
      "lifecycle.grace_started": t("Grace started"),
      "lifecycle.suspended": t("Suspended"),
      "lifecycle.reactivated": t("Reactivated"),
      "lifecycle.archived": t("Archived"),
      "billing.past_due": t("Payment past due"),
      "domain.ownership_lost": t("Domain ownership lost"),
      "domain.live": t("Domain live"),
    };
    const action: Record<string, string> = {
      "tenant.provisioned": t("Provisioned"),
      "tenant.draft_created": t("Draft created"),
      "tenant.draft_provisioned": t("Provisioned from draft"),
      "tenant.owner_invitation_rotated": t("Owner link rotated"),
      "tenant.lifecycle_transitioned": t("State changed"),
      "tenant.lifecycle_automated": t("State changed automatically"),
      "tenant.seat_limit_changed": t("Seat limit changed"),
      "tenant.entitlements_updated": t("Modules changed"),
      "tenant.support_requested": t("Support requested"),
      "tenant.support_approved": t("Support approved"),
      "tenant.support_rejected": t("Support rejected"),
      "tenant.support_active": t("Support started"),
      "tenant.support_revoked": t("Support revoked"),
      "tenant.support_auto_revoked": t("Support revoked automatically"),
      "tenant.support_viewed": t("Tenant records opened"),
      "tenant.support_view_denied": t("Tenant records refused"),
      "tenant.domain_requested": t("Domain requested"),
      "tenant.domain_dns_verified": t("Domain verified"),
      "tenant.domain_dns_rechecked": t("Domain rechecked"),
      "tenant.domain_challenge_rotated": t("DNS code renewed"),
      "tenant.domain_certificate_recorded": t("Certificate recorded"),
      "tenant.domain_live": t("Domain live"),
      "tenant.domain_rollback_completed": t("Rollback finished"),
      "tenant.domain_ownership_lost": t("Domain ownership lost"),
      "tenant.domain_removed": t("Domain removed"),
      "tenant.operation_planned": t("Export requested"),
      "tenant.operation_cancelled": t("Export cancelled"),
      "tenant.export_verified": t("Export ready"),
      "account.contract_versioned": t("Contract changed"),
      "account.billing_document_recorded": t("Billing document recorded"),
      "account.collection_state_versioned": t("Collection state changed"),
    };
    return { state, attention, support, domain, notice, delivery, invitation, event, action };
  }, [t]);
}
