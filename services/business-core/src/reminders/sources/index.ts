import type { ReminderSource } from "../engine/engine";
import { approvalWaitingSource } from "./approvals";
import { confirmClientSource, firstResponseSource, followUpSource, replyWaitingSource, unownedSource } from "./crm";
import { designDecisionSource, designStageSource } from "./designs";
import { financeRequestSource, invoiceOverdueSource, payablesDueSource, paymentDueSource } from "./money";
import { postingIssueSource, productionDueSource, siteReportSource } from "./operations";
import { permitExpirySource } from "./permits";
import { orderLateSource } from "./purchasing";
import { quoteDecisionSource, quoteExpiringSource } from "./quotes";
import { workDueSource } from "./work";

/**
 * The built-in sources (plan §6.24a "Sources the engine notifies" and "Sources shown in My day only"). A module that
 * owns a reminder of its own registers it with ReminderSourceRegistryService.register (see registry.service.ts);
 * change_request.client_decision is registered by the change-request module.
 */
export const BUILTIN_REMINDER_SOURCES: readonly ReminderSource[] = [
  workDueSource,
  followUpSource,
  approvalWaitingSource,
  quoteDecisionSource,
  designDecisionSource,
  quoteExpiringSource,
  paymentDueSource,
  invoiceOverdueSource,
  payablesDueSource,
  orderLateSource,
  designStageSource,
  permitExpirySource,
  financeRequestSource,
  firstResponseSource,
  unownedSource,
  confirmClientSource,
  replyWaitingSource,
  siteReportSource,
  productionDueSource,
  postingIssueSource,
];
