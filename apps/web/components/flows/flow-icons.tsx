import {
  BadgeCheck, CalendarClock, Calculator, ClipboardList, Compass, Factory, FileText, Flag, GitFork, Handshake, Landmark, ListChecks, MapPin, Package,
  PencilRuler, PhoneCall, Receipt, Send, ShieldCheck, Signpost, ThumbsUp, UserRound, type LucideIcon,
} from "lucide-react";
import type { FlowCheck } from "@/lib/flows/flow-model";

/** One icon per catalogue check, and one for a branch. */
export const CHECK_ICONS: Record<FlowCheck, LucideIcon> = {
  contact_logged: PhoneCall,
  details_complete: ClipboardList,
  client_type_set: UserRound,
  intro_meeting_completed: Handshake,
  qualification_outcome_recorded: Flag,
  target_completion_set: CalendarClock,
  site_visit_recorded: MapPin,
  discovery_complete: Compass,
  sub_path_chosen: Signpost,
  feasibility_confirmed: Factory,
  package_chosen: Package,
  quote_exists: FileText,
  qs_approved: Calculator,
  quote_sent: Send,
  client_accepted: ThumbsUp,
  client_approved_on_spot: BadgeCheck,
  deal_approved: ShieldCheck,
  payment_proof_attached: Receipt,
  payment_verified: Landmark,
  design_stage_done: PencilRuler,
  material_list_signed_off: ListChecks,
};
export const BranchIcon = GitFork;
