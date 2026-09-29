import { Briefcase, Building2, Factory, FileText, Handshake, LayoutDashboard, Smartphone, SquareKanban, UsersRound, type LucideIcon } from "lucide-react";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * The public site's navigation, shared by the header menus, the phone menu and the footer so the three never
 * drift apart. Product links open a tab of the feature showcase on the landing page (`/#sales`), Solutions
 * links the role cards (`/#for-owners`), Company links its own pages.
 */
export type MarketingLink = {
  id: string;
  href: string;
  label: MessageKey;
  description: MessageKey;
  icon?: LucideIcon;
  /** A role avatar from /brand/avatars, for the Solutions menu. */
  avatar?: string;
};

export type MarketingGroup = { id: "product" | "solutions" | "company"; label: MessageKey; links: MarketingLink[] };

export const PRODUCT_LINKS: MarketingLink[] = [
  { id: "sales", href: "/#sales", icon: Handshake, label: tKey("Sales"), description: tKey("Every enquiry and follow-up on one board") },
  { id: "quotes", href: "/#quotes", icon: FileText, label: tKey("Planning & quotes"), description: tKey("Room-by-room quotes clients approve online") },
  { id: "projects", href: "/#projects", icon: SquareKanban, label: tKey("Projects"), description: tKey("Tasks, stages and dates the whole team shares") },
  { id: "purchasing", href: "/#purchasing", icon: Factory, label: tKey("Purchasing & factory"), description: tKey("Supplier orders, stock and workshop jobs") },
  { id: "portal", href: "/#portal", icon: LayoutDashboard, label: tKey("Client portal"), description: tKey("Progress, decisions and payments for clients") },
  { id: "mobile", href: "/#mobile", icon: Smartphone, label: tKey("Mobile app"), description: tKey("Attendance, daily reports and approvals on site") },
];

export const SOLUTION_LINKS: MarketingLink[] = [
  { id: "for-owners", href: "/#for-owners", avatar: "/brand/avatars/owner-f.webp", label: tKey("For owners"), description: tKey("The whole firm at a glance") },
  { id: "for-sales-teams", href: "/#for-sales-teams", avatar: "/brand/avatars/sales-m.webp", label: tKey("For sales teams"), description: tKey("Answer fast, follow up, win more") },
  { id: "for-project-managers", href: "/#for-project-managers", avatar: "/brand/avatars/project_manager-f.webp", label: tKey("For project managers"), description: tKey("Plans, people and materials in step") },
  { id: "for-site-teams", href: "/#for-site-teams", avatar: "/brand/avatars/site_supervisor-m.webp", label: tKey("For site teams"), description: tKey("Check in, report and snag from the phone") },
  { id: "for-finance", href: "/#for-finance", avatar: "/brand/avatars/finance-f.webp", label: tKey("For finance"), description: tKey("Invoices, payments and spend per project") },
];

export const COMPANY_LINKS: MarketingLink[] = [
  { id: "about", href: "/about", icon: Building2, label: tKey("About"), description: tKey("Why we are building Wodana") },
  { id: "careers", href: "/careers", icon: Briefcase, label: tKey("Careers"), description: tKey("Work with us") },
  { id: "team", href: "/team", icon: UsersRound, label: tKey("Team"), description: tKey("The people behind Wodana") },
];

export const MARKETING_GROUPS: MarketingGroup[] = [
  { id: "product", label: tKey("Product"), links: PRODUCT_LINKS },
  { id: "solutions", label: tKey("Solutions"), links: SOLUTION_LINKS },
  { id: "company", label: tKey("Company"), links: COMPANY_LINKS },
];
