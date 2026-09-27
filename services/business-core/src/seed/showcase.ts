import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { HttpException, ValidationPipe, type INestApplicationContext, type Type } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { ClientPortalAdminService } from "../client-portal/client-portal-admin.service";
import { ClientPortalService } from "../client-portal/client-portal.service";
import { CommercialService } from "../commercial/commercial.service";
import { isOperationalEvidence } from "../commercial/release-integrity";
import { CrmIntakeService } from "../crm/intake/crm-intake.service";
import { CreateIntakeEventDto } from "../crm/intake/dto/intake.dto";
import { CrmLeadsService } from "../crm/leads/crm-leads.service";
import { LogContactDto } from "../crm/leads/dto/leads.dto";
import { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import { QualifyLeadDto, TransitionOpportunityDto } from "../crm/opportunities/dto/opportunities.dto";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { FactoryService } from "../factory/factory.service";
import { BriefService } from "../pre-projects/brief.service";
import { MoodboardPinDto, SaveBriefEntryDto, SaveRoomDto } from "../pre-projects/brief.dto";
import { DesignService } from "../pre-projects/design.service";
import { DesignActivityDto, UploadDesignFilesDto } from "../pre-projects/design.dto";
import { ItemSpecificationService } from "../pre-projects/item-specification.service";
import { SaveItemSpecificationDto } from "../pre-projects/item-specification.dto";
import { PreProjectsService } from "../pre-projects/pre-projects.service";
import { SiteService as PlanningSiteService } from "../pre-projects/site.service";
import { ReviewSiteMeasurementDto, SaveSiteMeasurementDto, SaveSiteVisitDto } from "../pre-projects/site.dto";
import { ProjectCoreService } from "../project-core/project-core.service";
import { ProjectWorkService } from "../project-core/project-work.service";
import { OrdersService } from "../purchasing/orders.service";
import { ReceivingService } from "../purchasing/receiving.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { HandoverService } from "../site/handover.service";
import { SiteService } from "../site/site.service";
import { WarrantyService } from "../site/warranty.service";

/**
 * The showcase: fictional clients and projects at every stage of the funnel, run through the core's own
 * services and commands (validation, permissions, audit and forced RLS apply as for the app). Nothing signs in:
 * every step acts as an existing member of the workspace, resolved by user id, one person per role.
 *
 * Idempotent: every record has a stable id or reference in its scenario's namespace, so a second run finds what
 * the first made and creates nothing. A stage the product refuses (a rule not met here, a missing person) is
 * reported and the run continues with what it can.
 */

// ---------------------------------------------------------------- input and result

export type ShowcaseRole = "sales" | "salesAdmin" | "designer" | "estimator" | "owner" | "manager" | "projectManager" | "finance" | "buyer" | "factory" | "site";

export type ShowcaseInput = {
  app: INestApplicationContext;
  workspaceId: string;
  /** The person every step falls back to when no one is given for its role: an administrator or the owner. */
  actorUserId: string;
  /** User ids per role; any role not given falls back to actorUserId. */
  actors?: Partial<Record<ShowcaseRole, string | null | undefined>>;
  /** The bootstrap's people by team code (SALES, QS, FINANCE, …); only active members count. */
  roleActors?: Record<string, { userId: string; membershipId?: string | null; active?: boolean }>;
  /** Emails leave the process only when true; otherwise every send is recorded as suppressed. */
  deliverEmail?: boolean;
  /** Only these scenarios (by key); default all. */
  only?: string[];
  log?: (line: string) => void;
  /** A ledger to write into (the bootstrap seed's report); optional. */
  report?: { record?: (type: string, outcome: "created" | "reused" | "pending" | "changed", detail?: string) => void; notes?: string[]; notices?: string[] };
};

export type ShowcaseResult = {
  created: string[];
  reused: string[];
  skipped: Array<{ stage: string; reason: string }>;
  scenarios: Record<string, ScenarioIds>;
};

export type ScenarioIds = { leadId?: string; partyId?: string; opportunityId?: string; caseId?: string; grantId?: string; quoteId?: string; projectId?: string; orderId?: string; workOrderId?: string };

// ---------------------------------------------------------------- the scenarios

/** Where a scenario's story stops. */
type Stop = "enquiry" | "qualified" | "planning" | "quotation_draft" | "quotation_issued" | "accepted" | "project" | "site" | "handover";

type Requirement = { key: string; room: string; title: string; note: string; category: string; priority: string; quantity: number; unit: string; catalog?: string[] };
type QuoteLine = { key: string; room: string; catalog: string[]; title?: string; quantity: string; unit: string; unitCost: string; rate: string };
type Term = { title: string; percent: number; trigger: string; requiredForRelease: boolean; requiredForProduction: boolean };
type Task = { key: string; title: string; role: ShowcaseRole; start: number; due: number; made: boolean; needsMaterials?: boolean; status?: "done" | "in_progress" };
type Snag = { key: string; title: string; severity: string; source: string; room: string; close: boolean };
type Order = { key: string; label: string; pick: "materials" | RegExp; supplier: number; receive: boolean; expected: number; promised: number };

const ORDERS_RECEIVED = (expected: number, promised: number): Order[] => [
  { key: "joinery-materials", label: "joinery materials", pick: "materials", supplier: 0, receive: true, expected, promised },
  { key: "fit-out-supplies", label: "fit-out supplies", pick: /./, supplier: 1, receive: true, expected, promised },
];

type Scenario = {
  key: string;
  /** The id namespace; empty for the first scenario so an earlier seed of it is found again. */
  ns: string;
  reference: string;
  client: { displayName: string; email: string; mobile: string; demoCode: string };
  /** Other people who decide for the client in the portal (the demonstration client sees this project too). */
  approvers?: Array<{ displayName: string; email: string; mobile: string; demoCode: string; decides: boolean }>;
  owner: "sales" | "salesAdmin";
  title: string; summary: string; area: string; emirate: string;
  /** How many days ago the enquiry came in; the rest of the story follows from it. */
  daysAgo: number;
  amount: number;
  pick: { source: number; channel: number; type: RegExp };
  rooms: string[];
  requirements: Requirement[];
  inspiration: Array<{ key: string; title: string; catalog: string[] }>;
  measurement: { requirement: string; title: string; width: number; height: number };
  design: "accepted" | "internal_review";
  lines: QuoteLine[];
  terms: Term[];
  stop: Stop;
  /** Titles of the quotation lines the factory makes. */
  made: RegExp;
  materials: Array<{ name: string; code: string; specification: string; quantity: string; unit: string }>;
  execution: {
    startDaysAgo: number; promiseDays: number;
    productionPayment: boolean;
    /** A milestone that fell due and wasn't paid: its title and how many days ago it was due. */
    overdue?: { title: string; daysAgo: number };
    tasks: Task[];
    /** Purchase orders in sequence: the project's material needs, or its bought lines whose titles match (the rest with /./). */
    orders: Order[];
    factory: "in_production" | "done";
    siteStartDaysAgo: number | null; reports: number; snags: Snag[];
    /** The stage that stays current (its key), or null to go as far as the checks allow. */
    stagesUntil: string | null;
    handover: boolean;
  };
};

const VILLA_LINES: QuoteLine[] = [
  { key: "living-media", room: "Living room", catalog: ["TV unit", "media"], title: "Fitted media wall · oak veneer, concealed cabling", quantity: "1", unit: "nos", unitCost: "9800", rate: "17100" },
  { key: "living-floor", room: "Living room", catalog: ["Engineered oak flooring 14mm", "flooring"], quantity: "45", unit: "sqm", unitCost: "190", rate: "320" },
  { key: "living-paint", room: "Living room", catalog: ["Wall painting, 2 coats", "paint"], quantity: "120", unit: "sqm", unitCost: "14", rate: "28" },
  { key: "living-lights", room: "Living room", catalog: ["LED downlight 9W warm", "downlight", "light"], quantity: "12", unit: "nos", unitCost: "45", rate: "95" },
  { key: "dining-light", room: "Dining room", catalog: ["Pendant light", "Mandy Pendant Light - Large", "pendant"], quantity: "1", unit: "nos", unitCost: "950", rate: "1600" },
  { key: "dining-ceiling", room: "Dining room", catalog: ["Gypsum false ceiling with cove", "ceiling"], quantity: "30", unit: "sqm", unitCost: "85", rate: "160" },
  { key: "dining-paint", room: "Dining room", catalog: ["Wall painting, 2 coats", "paint"], quantity: "60", unit: "sqm", unitCost: "14", rate: "28" },
  { key: "bed-wardrobe", room: "Master bedroom", catalog: ["Wardrobe · hinged", "wardrobe"], title: "Hinged wardrobe · wall to wall, matt laminate", quantity: "1", unit: "nos", unitCost: "8400", rate: "14500" },
  { key: "bed-floor", room: "Master bedroom", catalog: ["Engineered oak flooring 14mm", "flooring"], quantity: "30", unit: "sqm", unitCost: "190", rate: "320" },
  { key: "bed-paint", room: "Master bedroom", catalog: ["Wall painting, 2 coats", "paint"], quantity: "80", unit: "sqm", unitCost: "14", rate: "28" },
];

const TERMS_50_40_10: Term[] = [
  { title: "Advance on signing", percent: 50, trigger: "Signed agreement", requiredForRelease: true, requiredForProduction: false },
  { title: "Before production", percent: 40, trigger: "Before factory production starts", requiredForRelease: false, requiredForProduction: true },
  { title: "On handover", percent: 10, trigger: "At client handover", requiredForRelease: false, requiredForProduction: false },
];

const DEMO_CODE = "123456";
const DEMO_CLIENT = { displayName: "Dana Demo", email: "demo.client@palmliving.test", mobile: "+971501234567", demoCode: DEMO_CODE };

const joineryMaterials = [
  { name: "Oak veneer, natural", code: "OAK-NAT", specification: "Crown cut, matt lacquer, 0.6 mm on 18 mm MDF", quantity: "14", unit: "sheet" },
  { name: "Soft-close hinges and drawer runners", code: "HW-SC", specification: "Concealed 110° hinges; full-extension runners", quantity: "24", unit: "nos" },
];

const SCENARIOS: Scenario[] = [
  {
    key: "villa-12", ns: "", reference: "SHOWCASE-VILLA-12", client: DEMO_CLIENT, owner: "sales",
    title: "Demo Client — Villa 12", area: "Dubai Hills", emirate: "dubai", daysAgo: 56, amount: 118_000,
    summary: "Demonstration enquiry: a four-bedroom villa; living room, dining room and master bedroom with a fitted media wall made in the factory. All records are a demonstration, not a real client.",
    pick: { source: 0, channel: 0, type: /interior|fit.?out|full/i },
    rooms: ["Living room", "Dining room", "Master bedroom"],
    requirements: [
      { key: "living-sofa", room: "Living room", title: "Feature sofa for the family lounge", note: "Deep, low seating; must seat five.", category: "Furniture", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Annie Sofa - Length 2000mm"] },
      { key: "living-media", room: "Living room", title: "Fitted media wall with hidden storage", note: "Wall-to-wall joinery in oak veneer with concealed cable routing; made in the factory.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["TV unit"] },
      { key: "living-floor", room: "Living room", title: "Engineered oak flooring", note: "Wide plank, matt finish.", category: "Flooring", priority: "preferred", quantity: 45, unit: "sqm", catalog: ["Engineered oak flooring 14mm"] },
      { key: "dining-light", room: "Dining room", title: "Pendant light over the dining table", note: "Warm, dimmable, centred on the table.", category: "Lighting", priority: "preferred", quantity: 1, unit: "nos", catalog: ["Pendant light", "Mandy Pendant Light - Large"] },
      { key: "dining-ceiling", room: "Dining room", title: "False ceiling with cove lighting", note: "Gypsum cove around the dining area.", category: "Ceiling", priority: "optional", quantity: 30, unit: "sqm" },
      { key: "bed-wardrobe", room: "Master bedroom", title: "Hinged wardrobe, wall to wall", note: "Full-height, soft-close hinges, matt laminate.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Wardrobe · hinged"] },
    ],
    inspiration: [
      { key: "mood-console", title: "Marble console in the entrance", catalog: ["Freja Marble Console"] },
      { key: "mood-sofa", title: "Warm boucle seating", catalog: ["Annie Sofa - Length 2000mm"] },
      { key: "mood-light", title: "Brass pendant over the table", catalog: ["Brass pendant light"] },
      { key: "mood-oak", title: "Oak and off-white palette", catalog: ["Engineered oak flooring 14mm"] },
    ],
    measurement: { requirement: "living-media", title: "Media wall opening", width: 4500, height: 2800 },
    design: "accepted", lines: VILLA_LINES, terms: TERMS_50_40_10, stop: "handover", made: /media wall|wardrobe/i, materials: joineryMaterials,
    execution: {
      startDaysAgo: 21, promiseDays: 75, productionPayment: true,
      tasks: [
        { key: "task:drawings", title: "Shop drawings for the media wall and wardrobe", role: "designer", start: -18, due: -12, made: true, status: "done" },
        { key: "task:ordering", title: "Order veneer and hardware", role: "buyer", start: -12, due: -8, made: true, needsMaterials: true, status: "done" },
        { key: "task:flooring", title: "Lay the engineered oak flooring", role: "site", start: -6, due: -2, made: false, status: "done" },
        { key: "task:installation", title: "Install the media wall and wardrobe", role: "site", start: 3, due: 6, made: true, status: "done" },
      ],
      orders: ORDERS_RECEIVED(-10, -9), factory: "done", siteStartDaysAgo: 6, reports: 1,
      snags: [{ key: "snag:1", title: "Shadow gap uneven on the media wall's left return", severity: "minor", source: "inspection", room: "Living room", close: true }],
      stagesUntil: null, handover: true,
    },
  },
  {
    key: "marina-1804", ns: "marina-1804:", reference: "SHOWCASE-MARINA-1804", owner: "sales",
    client: { displayName: "Reem Al Marzouqi", email: "reem.marzouqi@example.test", mobile: "+971502000002", demoCode: DEMO_CODE },
    title: "Marina Apartment 1804", area: "Dubai Marina", emirate: "dubai", daysAgo: 42, amount: 86_000,
    summary: "Two-bedroom apartment on the 18th floor: open-plan living and dining with a fitted TV wall, a walk-in wardrobe and new lighting throughout. Fictional client for the showcase.",
    pick: { source: 1, channel: 0, type: /interior|fit.?out|full/i },
    rooms: ["Living and dining", "Master bedroom", "Guest bedroom"],
    requirements: [
      { key: "living-tv", room: "Living and dining", title: "Fitted TV wall with floating shelves", note: "Walnut veneer, back-lit niches, made in the factory.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["TV unit"] },
      { key: "living-sofa", room: "Living and dining", title: "Three-seat sofa facing the sea", note: "Low back so the view stays open.", category: "Furniture", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Annie Sofa - Length 2000mm"] },
      { key: "living-dining", room: "Living and dining", title: "Dining chairs for six", note: "Upholstered, easy to clean.", category: "Furniture", priority: "preferred", quantity: 6, unit: "nos", catalog: ["Andrea Curved Dining Chair"] },
      { key: "master-wardrobe", room: "Master bedroom", title: "Walk-in wardrobe carcasses", note: "Open shelving with LED strips.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Wardrobe · hinged"] },
      { key: "guest-bed", room: "Guest bedroom", title: "Queen bed with upholstered headboard", note: "Soft, neutral tone.", category: "Furniture", priority: "optional", quantity: 1, unit: "nos", catalog: ["Devon Cloud Bed"] },
    ],
    inspiration: [
      { key: "mood-walnut", title: "Walnut and warm white", catalog: ["Walnut veneer", "Walnut veneer (sheet)"] },
      { key: "mood-mirror", title: "Round mirror in the hallway", catalog: ["Darla Round Mirror"] },
      { key: "mood-chairs", title: "Curved dining chairs", catalog: ["Andrea Curved Dining Chair"] },
    ],
    measurement: { requirement: "living-tv", title: "TV wall opening", width: 3600, height: 2700 },
    design: "accepted",
    lines: [
      { key: "living-tv", room: "Living and dining", catalog: ["TV unit", "media"], title: "Fitted TV wall · walnut veneer, back-lit niches", quantity: "1", unit: "nos", unitCost: "7400", rate: "12900" },
      { key: "living-sofa", room: "Living and dining", catalog: ["Annie Sofa - Length 2000mm", "sofa", "Pendant light"], title: "Three-seat sofa · warm boucle", quantity: "1", unit: "nos", unitCost: "11400", rate: "19000" },
      { key: "living-chairs", room: "Living and dining", catalog: ["Andrea Curved Dining Chair", "chair", "LED downlight 9W warm"], title: "Curved dining chair", quantity: "6", unit: "nos", unitCost: "1900", rate: "3200" },
      { key: "living-lights", room: "Living and dining", catalog: ["LED downlight 9W warm", "downlight", "light"], quantity: "16", unit: "nos", unitCost: "45", rate: "95" },
      { key: "living-paint", room: "Living and dining", catalog: ["Wall painting, 2 coats", "paint"], quantity: "140", unit: "sqm", unitCost: "14", rate: "28" },
      { key: "master-wardrobe", room: "Master bedroom", catalog: ["Wardrobe · hinged", "wardrobe"], title: "Walk-in wardrobe · open carcasses with LED strips", quantity: "1", unit: "nos", unitCost: "6200", rate: "10800" },
      { key: "master-floor", room: "Master bedroom", catalog: ["Engineered oak flooring 14mm", "flooring"], quantity: "28", unit: "sqm", unitCost: "190", rate: "320" },
      { key: "guest-bed", room: "Guest bedroom", catalog: ["Devon Cloud Bed", "bed", "Pendant light"], title: "Queen bed · upholstered headboard", quantity: "1", unit: "nos", unitCost: "8400", rate: "14000" },
    ],
    terms: [
      { title: "Advance on signing", percent: 40, trigger: "Signed agreement", requiredForRelease: true, requiredForProduction: false },
      { title: "Before production", percent: 30, trigger: "Before factory production starts", requiredForRelease: false, requiredForProduction: true },
      { title: "On delivery to site", percent: 20, trigger: "Furniture delivered to site", requiredForRelease: false, requiredForProduction: false },
      { title: "On handover", percent: 10, trigger: "At client handover", requiredForRelease: false, requiredForProduction: false },
    ],
    stop: "project", made: /tv wall|wardrobe/i,
    materials: [
      { name: "Walnut veneer, natural", code: "WAL-NAT", specification: "Quarter cut, matt lacquer, 0.6 mm on 18 mm MDF", quantity: "10", unit: "sheet" },
      { name: "LED strip 3000K with drivers", code: "LED-3K", specification: "Warm white, dimmable, 5 m reels", quantity: "6", unit: "nos" },
    ],
    execution: {
      startDaysAgo: 14, promiseDays: 60, productionPayment: true, overdue: { title: "On delivery to site", daysAgo: 5 },
      tasks: [
        { key: "task:drawings", title: "Shop drawings for the TV wall and wardrobe", role: "designer", start: -12, due: -7, made: true, status: "done" },
        { key: "task:ordering", title: "Order veneer, LED strips and furniture", role: "buyer", start: -7, due: -3, made: true, needsMaterials: true, status: "done" },
        { key: "task:electrical", title: "First fix for the niche lighting", role: "site", start: -2, due: 4, made: false, status: "in_progress" },
        { key: "task:installation", title: "Install the TV wall and wardrobe", role: "site", start: 12, due: 16, made: true },
      ],
      // The veneer is in (the factory has started); the furniture and the lighting are on order, still to receive.
      orders: [
        { key: "joinery-materials", label: "veneer and LED strips", pick: "materials", supplier: 0, receive: true, expected: -8, promised: -6 },
        { key: "furniture", label: "furniture", pick: /sofa|chair|bed/i, supplier: 1, receive: false, expected: 5, promised: 7 },
        { key: "lighting-and-flooring", label: "lighting and flooring", pick: /./, supplier: 2, receive: false, expected: 6, promised: 8 },
      ],
      factory: "in_production", siteStartDaysAgo: null, reports: 0, snags: [],
      stagesUntil: "procurement", handover: false,
    },
  },
  {
    key: "ranches-7", ns: "ranches-7:", reference: "SHOWCASE-RANCHES-7", owner: "salesAdmin",
    client: { displayName: "Omar and Layla Haddad", email: "haddad.family@example.test", mobile: "+971553000003", demoCode: DEMO_CODE },
    title: "Arabian Ranches Townhouse 7", area: "Arabian Ranches", emirate: "dubai", daysAgo: 35, amount: 74_000,
    summary: "Townhouse refresh: new kitchen base cabinets, a study with fitted shelving, flooring and paint on the ground floor. Fictional client for the showcase.",
    pick: { source: 2, channel: 1, type: /interior|fit.?out|full/i },
    rooms: ["Kitchen", "Study", "Family room"],
    requirements: [
      { key: "kitchen-base", room: "Kitchen", title: "Kitchen base cabinets, L-shaped", note: "Soft-close drawers, quartz worktop.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Kitchen base cabinet"] },
      { key: "study-shelves", room: "Study", title: "Fitted study shelving", note: "Floor to ceiling, oak veneer.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Wardrobe · hinged"] },
      { key: "family-floor", room: "Family room", title: "Porcelain tile flooring", note: "Large format, matte.", category: "Flooring", priority: "preferred", quantity: 38, unit: "sqm", catalog: ["Porcelain tile 60x120 matte"] },
      { key: "family-paint", room: "Family room", title: "Repaint the ground floor", note: "Warm white; two coats.", category: "Finishes", priority: "preferred", quantity: 160, unit: "sqm", catalog: ["Wall painting, 2 coats"] },
    ],
    inspiration: [
      { key: "mood-quartz", title: "Quartz worktop, pale grey", catalog: ["Quartz worktop 20 mm"] },
      { key: "mood-oak", title: "Oak shelving", catalog: ["Oak veneer (sheet)"] },
    ],
    measurement: { requirement: "kitchen-base", title: "Kitchen run", width: 3200, height: 900 },
    design: "accepted",
    lines: [
      { key: "kitchen-base", room: "Kitchen", catalog: ["Kitchen base cabinet", "cabinet"], title: "Kitchen base cabinets · L-shaped run, soft-close", quantity: "1", unit: "nos", unitCost: "9200", rate: "15800" },
      { key: "kitchen-worktop", room: "Kitchen", catalog: ["Quartz worktop 20 mm", "worktop", "Calacatta marble slab"], quantity: "6", unit: "sqm", unitCost: "420", rate: "760" },
      { key: "kitchen-sink", room: "Kitchen", catalog: ["Undermount stainless sink", "sink", "Brushed brass mixer tap"], quantity: "1", unit: "nos", unitCost: "380", rate: "690" },
      { key: "study-shelves", room: "Study", catalog: ["Wardrobe · hinged", "wardrobe"], title: "Fitted study shelving · oak veneer, floor to ceiling", quantity: "1", unit: "nos", unitCost: "4600", rate: "8200" },
      { key: "family-floor", room: "Family room", catalog: ["Porcelain tile 60x120 matte", "tile", "flooring"], quantity: "38", unit: "sqm", unitCost: "95", rate: "180" },
      { key: "family-paint", room: "Family room", catalog: ["Wall painting, 2 coats", "paint"], quantity: "160", unit: "sqm", unitCost: "14", rate: "28" },
      { key: "family-lights", room: "Family room", catalog: ["LED downlight 9W warm", "downlight", "light"], quantity: "10", unit: "nos", unitCost: "45", rate: "95" },
    ],
    terms: TERMS_50_40_10, stop: "site", made: /kitchen base|study shelving/i,
    materials: [
      { name: "Oak veneer, natural", code: "OAK-NAT", specification: "Crown cut, matt lacquer, 0.6 mm on 18 mm MDF", quantity: "9", unit: "sheet" },
      { name: "Soft-close hinges and drawer runners", code: "HW-SC", specification: "Concealed 110° hinges; full-extension runners", quantity: "36", unit: "nos" },
    ],
    execution: {
      startDaysAgo: 25, promiseDays: 20, productionPayment: true,
      tasks: [
        { key: "task:drawings", title: "Shop drawings for the kitchen and study", role: "designer", start: -22, due: -17, made: true, status: "done" },
        { key: "task:ordering", title: "Order veneer, hardware, tiles and lighting", role: "buyer", start: -17, due: -13, made: true, needsMaterials: true, status: "done" },
        { key: "task:tiling", title: "Tile the family room floor", role: "site", start: -7, due: -4, made: false, status: "in_progress" },
        { key: "task:installation", title: "Install the kitchen cabinets and study shelving", role: "site", start: -3, due: 2, made: true, status: "in_progress" },
      ],
      orders: ORDERS_RECEIVED(-12, -10), factory: "done", siteStartDaysAgo: 8, reports: 3,
      snags: [
        { key: "snag:1", title: "Chip on the worktop edge by the hob", severity: "major", source: "inspection", room: "Kitchen", close: false },
        { key: "snag:2", title: "Study shelf 3 not level", severity: "minor", source: "client", room: "Study", close: false },
      ],
      stagesUntil: "installation", handover: false,
    },
  },
  {
    key: "jlt-office", ns: "jlt-office:", reference: "SHOWCASE-JLT-OFFICE", owner: "salesAdmin",
    client: { displayName: "Faris Khoury", email: "faris.khoury@example.test", mobile: "+971524000004", demoCode: DEMO_CODE },
    approvers: [{ ...DEMO_CLIENT, decides: true }],
    title: "JLT Office Fit-out", area: "Jumeirah Lake Towers", emirate: "dubai", daysAgo: 14, amount: 92_000,
    summary: "A 180 sqm office on the 21st floor: reception desk, meeting room joinery, open-plan workstations and acoustic ceiling. Fictional client for the showcase.",
    pick: { source: 3, channel: 0, type: /commercial|office|fit.?out|interior/i },
    rooms: ["Reception", "Meeting room", "Open plan"],
    requirements: [
      { key: "reception-desk", room: "Reception", title: "Curved reception desk", note: "Solid surface top, back-lit logo panel; made in the factory.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["TV unit"] },
      { key: "meeting-storage", room: "Meeting room", title: "Credenza and wall storage", note: "Walnut veneer, lockable.", category: "Joinery", priority: "preferred", quantity: 1, unit: "nos", catalog: ["Wardrobe · hinged"] },
      { key: "open-ceiling", room: "Open plan", title: "Acoustic false ceiling", note: "Perforated gypsum with cove lighting.", category: "Ceiling", priority: "must_have", quantity: 120, unit: "sqm", catalog: ["Gypsum false ceiling with cove"] },
    ],
    inspiration: [{ key: "mood-brass", title: "Brass details", catalog: ["Brushed brass handle 160mm", "Brass pendant light"] }],
    measurement: { requirement: "reception-desk", title: "Reception desk footprint", width: 3800, height: 1100 },
    design: "accepted",
    lines: [
      { key: "reception-desk", room: "Reception", catalog: ["TV unit", "media"], title: "Curved reception desk · solid surface, back-lit panel", quantity: "1", unit: "nos", unitCost: "11500", rate: "19800" },
      { key: "meeting-storage", room: "Meeting room", catalog: ["Wardrobe · hinged", "wardrobe"], title: "Meeting room credenza and wall storage · walnut", quantity: "1", unit: "nos", unitCost: "5800", rate: "9900" },
      { key: "open-ceiling", room: "Open plan", catalog: ["Gypsum false ceiling with cove", "ceiling"], quantity: "120", unit: "sqm", unitCost: "85", rate: "160" },
      { key: "open-lights", room: "Open plan", catalog: ["LED downlight 9W warm", "downlight", "light"], quantity: "40", unit: "nos", unitCost: "45", rate: "95" },
      { key: "open-floor", room: "Open plan", catalog: ["Engineered oak flooring 14mm", "flooring"], quantity: "150", unit: "sqm", unitCost: "190", rate: "320" },
      { key: "open-paint", room: "Open plan", catalog: ["Wall painting, 2 coats", "paint"], quantity: "260", unit: "sqm", unitCost: "14", rate: "28" },
    ],
    terms: [
      { title: "Advance on signing", percent: 50, trigger: "Signed agreement", requiredForRelease: true, requiredForProduction: true },
      { title: "On completion", percent: 50, trigger: "At handover", requiredForRelease: false, requiredForProduction: false },
    ],
    stop: "quotation_issued", made: /reception desk|credenza/i, materials: joineryMaterials,
    execution: { startDaysAgo: 0, promiseDays: 60, productionPayment: false, tasks: [], orders: [], factory: "in_production", siteStartDaysAgo: null, reports: 0, snags: [], stagesUntil: null, handover: false },
  },
  {
    key: "penthouse", ns: "penthouse:", reference: "SHOWCASE-EH-PENTHOUSE", owner: "sales",
    client: { displayName: "Sofia Bennett", email: "sofia.bennett@example.test", mobile: "+971565000005", demoCode: DEMO_CODE },
    title: "Emirates Hills Penthouse", area: "Emirates Hills", emirate: "dubai", daysAgo: 9, amount: 240_000,
    summary: "Penthouse living floor: a formal lounge, a dining room for twelve and a bar; marble, brass and bespoke joinery throughout. Fictional client for the showcase.",
    pick: { source: 4, channel: 1, type: /interior|fit.?out|full/i },
    rooms: ["Formal lounge", "Dining room", "Bar"],
    requirements: [
      { key: "lounge-sofa", room: "Formal lounge", title: "Modular sofa for twelve", note: "Boucle, two facing rows.", category: "Furniture", priority: "must_have", quantity: 2, unit: "nos", catalog: ["Annie Sofa - Length 2000mm"] },
      { key: "lounge-console", room: "Formal lounge", title: "Marble console under the mirror", note: "Calacatta Viola.", category: "Furniture", priority: "preferred", quantity: 1, unit: "nos", catalog: ["Freja Marble Console", "Calacatta marble slab"] },
      { key: "dining-chairs", room: "Dining room", title: "Dining chairs for twelve", note: "Curved backs, velvet.", category: "Furniture", priority: "must_have", quantity: 12, unit: "nos", catalog: ["Andrea Curved Dining Chair"] },
      { key: "bar-joinery", room: "Bar", title: "Fitted bar with back-lit shelving", note: "Fluted oak front, brass rail; made in the factory.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["TV unit"] },
    ],
    inspiration: [
      { key: "mood-marble", title: "Calacatta and brass", catalog: ["Calacatta marble slab", "Freja Marble Console"] },
      { key: "mood-pendant", title: "Statement pendant over the table", catalog: ["Mandy Pendant Light - Large", "Brass pendant light"] },
    ],
    measurement: { requirement: "bar-joinery", title: "Bar wall", width: 5200, height: 3000 },
    design: "internal_review",
    lines: [
      { key: "lounge-sofa", room: "Formal lounge", catalog: ["Annie Sofa - Length 2000mm", "sofa", "Pendant light"], title: "Modular sofa · warm boucle", quantity: "2", unit: "nos", unitCost: "11400", rate: "19000" },
      { key: "lounge-console", room: "Formal lounge", catalog: ["Freja Marble Console", "console", "Calacatta marble slab"], title: "Marble console · Calacatta Viola", quantity: "1", unit: "nos", unitCost: "5200", rate: "9400" },
      { key: "dining-chairs", room: "Dining room", catalog: ["Andrea Curved Dining Chair", "chair", "LED downlight 9W warm"], title: "Curved dining chair · velvet", quantity: "12", unit: "nos", unitCost: "1900", rate: "3200" },
      { key: "dining-pendant", room: "Dining room", catalog: ["Mandy Pendant Light - Large", "Brass pendant light", "pendant"], quantity: "2", unit: "nos", unitCost: "950", rate: "1600" },
      { key: "bar-joinery", room: "Bar", catalog: ["TV unit", "media"], title: "Fitted bar · fluted oak, brass rail, back-lit shelving", quantity: "1", unit: "nos", unitCost: "24000", rate: "41000" },
      { key: "bar-paint", room: "Bar", catalog: ["Wall painting, 2 coats", "paint"], quantity: "90", unit: "sqm", unitCost: "14", rate: "28" },
    ],
    terms: TERMS_50_40_10, stop: "quotation_draft", made: /fitted bar/i, materials: joineryMaterials,
    execution: { startDaysAgo: 0, promiseDays: 90, productionPayment: false, tasks: [], orders: [], factory: "in_production", siteStartDaysAgo: null, reports: 0, snags: [], stagesUntil: null, handover: false },
  },
];

/** Six raw enquiries across the pipeline: new, contacted (follow-ups due today and overdue), qualified, lost. */
const ENQUIRIES: Array<{ key: string; displayName: string; email: string; mobile: string; title: string; summary: string; area: string; owner: "sales" | "salesAdmin"; daysAgo: number;
  pick: { source: number; channel: number }; amount: number; outcome: null | "new" | { channel: "call" | "whatsapp" | "email"; outcome: "no_answer" | "willing_to_talk" | "message_sent_no_reply" | "not_interested"; note: string; reason?: string; followUp?: { days: number; hour: number } } | "qualified" }> = [
  { key: "enq-1", displayName: "Hessa Al Suwaidi", email: "hessa.suwaidi@example.test", mobile: "+971506000011", title: "Al Barari villa · majlis and dining", summary: "Wants a new majlis and dining room before Ramadan.", area: "Al Barari", owner: "sales", daysAgo: 0, pick: { source: 0, channel: 1 }, amount: 150_000, outcome: "new" },
  { key: "enq-2", displayName: "Daniel Okafor", email: "daniel.okafor@example.test", mobile: "+971506000012", title: "Downtown apartment · living room refresh", summary: "Sofa, rug, lighting and curtains for a one-bedroom apartment.", area: "Downtown Dubai", owner: "salesAdmin", daysAgo: 1, pick: { source: 1, channel: 0 }, amount: 28_000, outcome: "new" },
  { key: "enq-3", displayName: "Mariam Haddad", email: "mariam.haddad@example.test", mobile: "+971506000013", title: "Mirdif townhouse · kitchen", summary: "Replace the kitchen cabinets and worktop.", area: "Mirdif", owner: "sales", daysAgo: 3, pick: { source: 2, channel: 0 }, amount: 45_000,
    outcome: { channel: "call", outcome: "no_answer", note: "Called twice; left a voicemail and a WhatsApp message.", followUp: { days: 0, hour: 16 } } },
  { key: "enq-4", displayName: "Yusuf Rahman", email: "yusuf.rahman@example.test", mobile: "+971506000014", title: "Business Bay office · reception and boardroom", summary: "Reception desk, boardroom table and acoustic panels.", area: "Business Bay", owner: "salesAdmin", daysAgo: 6, pick: { source: 3, channel: 1 }, amount: 110_000, outcome: "qualified" },
  { key: "enq-5", displayName: "Aisha Karim", email: "aisha.karim@example.test", mobile: "+971506000015", title: "Jumeirah villa · master suite", summary: "Bedroom joinery, dressing room and bathroom vanity.", area: "Jumeirah", owner: "sales", daysAgo: 8, pick: { source: 4, channel: 0 }, amount: 95_000,
    outcome: { channel: "whatsapp", outcome: "willing_to_talk", note: "Interested; asked for a showroom visit next week.", followUp: { days: 0, hour: 11 } } },
  { key: "enq-6", displayName: "Nikolai Petrov", email: "nikolai.petrov@example.test", mobile: "+971506000016", title: "Palm Jumeirah apartment · full fit-out", summary: "Full fit-out of a three-bedroom apartment.", area: "Palm Jumeirah", owner: "salesAdmin", daysAgo: 12, pick: { source: 0, channel: 0 }, amount: 210_000,
    outcome: { channel: "call", outcome: "not_interested", note: "Chose another studio after comparing proposals.", reason: "Went with another studio (price)." } },
  { key: "enq-8", displayName: "Noura Sabbagh", email: "noura.sabbagh@example.test", mobile: "+971506000017", title: "Motor City townhouse · study and guest room", summary: "Study desk, shelving and a guest bed.", area: "Motor City", owner: "sales", daysAgo: 7, pick: { source: 1, channel: 1 }, amount: 32_000,
    outcome: { channel: "email", outcome: "message_sent_no_reply", note: "Sent the brochure and price guide; no reply yet.", followUp: { days: -3, hour: 10 } } },
];

/** The first scenario's constants, kept for callers that read them. */
export const SHOWCASE = { reference: SCENARIOS[0].reference, client: DEMO_CLIENT, title: SCENARIOS[0].title, summary: SCENARIOS[0].summary, area: SCENARIOS[0].area, rooms: SCENARIOS[0].rooms };

const TEAM_ROLES: Record<string, ShowcaseRole> = {
  SALES: "sales", SALES_ADMIN: "salesAdmin", SHOWROOM: "sales", INTERIOR_DESIGN: "designer", QS: "estimator", FINANCE: "finance", PROCUREMENT: "buyer",
  PRODUCTION: "factory", PROJECT_MANAGERS: "projectManager", OPS_ADMIN: "manager",
};

const STOPS: Stop[] = ["enquiry", "qualified", "planning", "quotation_draft", "quotation_issued", "accepted", "project", "site", "handover"];

type Any = Record<string, any>;
type Actor = RequestActor & { userId: string; membershipId: string | null };
type Upload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type Ctx = { s: Scenario; rooms: Map<string, string>; ids: ScenarioIds };

/** A stage that can't go on in this run: reported, never a failure. */
class Skip extends Error {
  constructor(readonly reason: string) { super(reason); }
}

// ---------------------------------------------------------------- entry point

export async function seedShowcase(input: ShowcaseInput): Promise<ShowcaseResult> {
  const seed = new ShowcaseSeed(input);
  await seed.prepare();
  const restore = seed.suppressEmail();
  try {
    return await seed.run();
  } finally {
    restore();
  }
}

class ShowcaseSeed {
  readonly result: ShowcaseResult = { created: [], reused: [], skipped: [], scenarios: {} };
  private readonly pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  private readonly actors = new Map<string, Actor>();
  private readonly roles: Partial<Record<ShowcaseRole, string>> = {};
  private readonly portalTokens = new Map<string, string>();
  private catalog: Map<string, { id: string; name: string; kind: string; primaryAsset?: { id: string } | null }> | null = null;
  private slug = "";
  private timezone = "UTC";
  private currency = "";

  constructor(private readonly input: ShowcaseInput) {}

  private get w() { return this.input.workspaceId; }
  private get<T>(type: Type<T>): T { return this.input.app.get(type, { strict: false }); }
  private get db() { return this.get(DatabaseService); }

  private log(line: string) { (this.input.log ?? ((text: string) => process.stdout.write(`${text}\n`)))(line); }
  private made(label: string) { this.result.created.push(label); this.input.report?.record?.("showcase", "created", label); this.log(`  created  ${label}`); }
  private kept(label: string) { this.result.reused.push(label); this.input.report?.record?.("showcase", "reused", label); }
  private skip(stage: string, reason: string) {
    this.result.skipped.push({ stage, reason });
    this.input.report?.notes?.push(`showcase · ${stage}: ${reason}`);
    this.log(`  skipped  ${stage}: ${reason}`);
  }

  /** Runs a body through the API's validation pipe for its DTO, exactly as the controller would. */
  private validated<T>(dto: Type<T>, body: unknown): Promise<T> {
    return this.pipe.transform(body, { type: "body", metatype: dto }) as Promise<T>;
  }

  /** A stable id for a record of this scenario in this workspace (UUID-shaped, deterministic). */
  private id(ctx: Ctx | string, key: string) {
    const ns = typeof ctx === "string" ? ctx : ctx.s.ns;
    const hash = createHash("sha1").update(`wodana-showcase:${this.w}:${ns}${key}`).digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  // ---------------------------------------------------------------- people

  async prepare() {
    const workspace = (await this.db.tenantTransaction(this.w, this.input.actorUserId, (client) => client.query<{ slug: string; timezone: string; currency: string }>(
      `SELECT slug, coalesce(nullif(default_timezone, ''), 'UTC') AS timezone, default_currency AS currency FROM workspaces WHERE id = $1`, [this.w]))).rows[0];
    if (!workspace) throw new Error("Workspace not found.");
    this.timezone = workspace.timezone;
    this.currency = workspace.currency;
    // The client portal's own address (Settings → Client portal), which the client's side of the seed uses.
    const portal = (await this.db.tenantTransaction(this.w, this.input.actorUserId, (client) => client.query<{ slug: string | null }>(
      `SELECT slug FROM client_portal_settings WHERE workspace_id = $1`, [this.w]))).rows[0];
    this.slug = portal?.slug || workspace.slug;
    for (const [team, entry] of Object.entries(this.input.roleActors ?? {})) {
      const role = TEAM_ROLES[team];
      if (role && entry?.userId && entry.active !== false && !this.roles[role]) this.roles[role] = entry.userId;
    }
    for (const [role, userId] of Object.entries(this.input.actors ?? {})) if (userId) this.roles[role as ShowcaseRole] = userId;
    if (this.roles.factory && !this.roles.site) this.roles.site = this.roles.factory;
    await this.actor(this.input.actorUserId);
  }

  /** The person with this user id, as the API sees them after signing in, plus their membership here. */
  private async actor(userId: string): Promise<Actor> {
    const known = this.actors.get(userId);
    if (known) return known;
    const user = (await this.db.query<{ id: string; email: string; displayName: string; provider: string; subject: string }>(
      `SELECT person.id, person.primary_email AS email, person.display_name AS "displayName", identity.provider, identity.provider_subject AS subject
         FROM users person JOIN user_identities identity ON identity.user_id = person.id
        WHERE person.id = $1 ORDER BY (identity.provider = 'local') DESC, identity.created_at LIMIT 1`, [userId])).rows[0];
    if (!user) throw new Error(`No signed-in identity for user ${userId}.`);
    const membership = (await this.db.tenantTransaction(this.w, userId, (client) => client.query<{ id: string }>(
      `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [this.w, userId]))).rows[0];
    const actor: Actor = { provider: user.provider, subject: user.subject, email: user.email, displayName: user.displayName, userId: user.id, membershipId: membership?.id ?? null };
    this.actors.set(userId, actor);
    return actor;
  }

  /** The person for a role, or the run's actor when nobody is named (or the named person isn't a member). */
  private async as(role: ShowcaseRole): Promise<Actor> {
    const userId = this.roles[role];
    if (userId) {
      const actor = await this.actor(userId).catch(() => null);
      if (actor?.membershipId) return actor;
    }
    return this.actor(this.input.actorUserId);
  }

  /** Someone other than `who`, for the rules that need a second pair of eyes; `who` again when nobody else is there. */
  private async other(who: Actor, prefer: ShowcaseRole[] = ["owner", "manager", "finance", "projectManager", "sales", "estimator"]): Promise<Actor> {
    for (const role of prefer) {
      const candidate = await this.as(role);
      if (candidate.userId !== who.userId) return candidate;
    }
    return this.actor(this.input.actorUserId);
  }

  /** Tries the preferred person first; someone without the permission hands over to the run's actor. */
  private async tryAs<T>(preferred: Actor, work: (actor: Actor) => Promise<T>): Promise<T> {
    try { return await work(preferred); } catch (error) {
      const fallback = await this.actor(this.input.actorUserId);
      if (fallback.userId === preferred.userId || !(error instanceof HttpException) || error.getStatus() !== 403) throw error;
      return work(fallback);
    }
  }

  suppressEmail() {
    if (this.input.deliverEmail) return () => undefined;
    const mailer = this.get(TransactionalEmailService) as unknown as { send: (message: unknown) => Promise<unknown> };
    const original = mailer.send;
    mailer.send = async (message: unknown) => {
      const to = (message as { to?: string }).to ?? "?";
      const subject = (message as { subject?: string }).subject ?? "";
      this.input.report?.notices?.push(`email to ${to}: ${subject} (suppressed)`);
      return { status: "suppressed", suppressedReason: "seed", provider: null, messageId: null };
    };
    return () => { mailer.send = original; };
  }

  // ---------------------------------------------------------------- steps

  /** One idempotent step: `find` reads what exists; `create` writes it. */
  private async step<T>(label: string, find: () => Promise<T | null | undefined>, create: () => Promise<T>): Promise<T> {
    const found = await find();
    if (found !== null && found !== undefined) { this.kept(label); return found; }
    try {
      const created = await create();
      this.made(label);
      return created;
    } catch (error) {
      if (error instanceof Skip) throw error;
      throw new Error(`${label}: ${describe(error)}`, { cause: error });
    }
  }

  /** A change that moves an existing record on; `done` says when there is nothing left to do. */
  private async advance(label: string, done: boolean, change: () => Promise<unknown>) {
    if (done) { this.kept(label); return false; }
    try { await change(); } catch (error) {
      if (error instanceof Skip) throw error;
      throw new Error(`${label}: ${describe(error)}`, { cause: error });
    }
    this.made(label);
    return true;
  }

  private async stage(name: string, work: () => Promise<void>) {
    this.log(name);
    try { await work(); } catch (error) {
      if (error instanceof Skip) { this.skip(name, error.reason); return; }
      this.skip(name, describe(error));
    }
  }

  async run() {
    const only = this.input.only?.length ? new Set(this.input.only) : null;
    for (const s of SCENARIOS) {
      if (only && !only.has(s.key)) continue;
      const ctx: Ctx = { s, rooms: new Map(), ids: {} };
      this.result.scenarios[s.key] = ctx.ids;
      this.log(`── ${s.title} (${s.stop})`);
      await this.scenario(ctx);
    }
    if (!only || only.has("enquiries")) {
      this.log("── Enquiries across the pipeline");
      await this.stage("enquiries", () => this.enquiries());
    }
    return this.result;
  }

  /** The story up to the scenario's stop, one stage at a time. */
  private async scenario(ctx: Ctx) {
    const { s, ids } = ctx;
    const after = (stop: Stop) => STOPS.indexOf(s.stop) > STOPS.indexOf(stop);
    const at = (name: string) => `${s.key} · ${name}`;
    await this.stage(at("enquiry"), async () => { Object.assign(ids, await this.enquiry(ctx)); });
    if (!ids.leadId || !after("enquiry")) return;
    await this.stage(at("opportunity"), async () => { ids.opportunityId = await this.opportunity(ctx, ids.leadId!, ids.partyId!); });
    if (!ids.opportunityId || !after("qualified")) return;
    await this.stage(at("planning"), async () => { ids.caseId = await this.planningCase(ctx, ids.opportunityId!); });
    if (!ids.caseId) return;
    const caseId = ids.caseId;
    await this.stage(at("client contact"), async () => { ids.grantId = await this.portalContacts(ctx, caseId); });
    await this.stage(at("brief"), () => this.brief(ctx, caseId));
    await this.stage(at("site visit"), () => this.siteVisit(ctx, caseId));
    await this.stage(at("design"), () => this.design(ctx, caseId));
    if (!after("planning")) return;
    await this.stage(at("quotation"), async () => { ids.quoteId = await this.quotation(ctx, caseId); });
    if (!ids.quoteId || !after("quotation_draft")) return;
    const quoteId = ids.quoteId;
    await this.stage(at("quotation review and issue"), () => this.issue(ctx, caseId, quoteId, ids.grantId ?? ""));
    if (!after("quotation_issued")) return;
    await this.stage(at("client acceptance and deal"), () => this.approvals(ctx, caseId, quoteId, ids.opportunityId!));
    if (!after("accepted")) return;
    await this.stage(at("project"), async () => { ids.projectId = await this.project(ctx, caseId, quoteId); });
    if (!ids.projectId) return;
    const projectId = ids.projectId;
    await this.stage(at("client portal access"), () => this.invite(ctx, projectId));
    await this.stage(at("payments"), () => this.paymentsAfterStart(ctx, caseId, quoteId));
    await this.stage(at("plan"), () => this.plan(ctx, projectId));
    await this.stage(at("material list"), () => this.materials(ctx, projectId, caseId));
    await this.stage(at("purchasing"), async () => { ids.orderId = await this.purchasing(ctx, projectId); });
    await this.stage(at("factory"), async () => { ids.workOrderId = await this.factory(ctx, projectId); });
    if (s.execution.siteStartDaysAgo !== null) await this.stage(at("site"), () => this.site(ctx, projectId));
    await this.stage(at("stages"), () => this.stages(ctx, projectId));
    if (!after("site") || !s.execution.handover) return;
    await this.stage(at("handover and warranty"), () => this.handover(ctx, projectId, caseId));
  }

  // ---------------------------------------------------------------- CRM

  /** The intake choices in the workspace's own words: sources, channels, enquiry types, areas. */
  private async intakeOptions(actor: Actor) {
    const intake = this.get(CrmIntakeService);
    return (await intake.options(actor, this.w)) as { sources: Array<{ id: string }>; channels: Record<string, Array<{ id: string }>>; enquiryTypes: Array<{ id: string }>; emirates: Array<{ id: string }>; customerTypes: Array<{ id: string }>; budgetRanges: Array<{ id: string }>; referralBrokers?: Array<{ id: string }>; referralPartners?: Array<{ id: string }> };
  }

  private async findLead(actor: Actor, party: { displayName: string; email: string }) {
    const leads = this.get(CrmLeadsService);
    const list = (await leads.list(actor, this.w, { search: party.displayName, limit: 100 } as never)) as unknown as { data: Array<{ id: string; partyId: string; partyName: string; status: string; version: number }> };
    const parties = (await this.db.tenantTransaction(this.w, actor.userId, (db) => db.query<{ id: string }>(
      `SELECT DISTINCT party_id AS id FROM crm_contact_points WHERE workspace_id = $1 AND type = 'email' AND lower(raw_value) = $2`, [this.w, party.email.toLowerCase()]))).rows.map((row) => row.id);
    return list.data.find((lead) => lead.partyName === party.displayName && parties.includes(lead.partyId)) ?? null;
  }

  /** A manual enquiry, backdated, from one of the workspace's sources and channels, assigned to its owner. */
  private async intake(key: string, reference: string, party: { displayName: string; email: string; mobile: string }, facts: { title: string; summary: string; area: string; emirate?: string; daysAgo: number; owner: "sales" | "salesAdmin"; pick: { source: number; channel: number; type?: RegExp } }) {
    const actor = await this.actor(this.input.actorUserId);
    const owner = await this.as(facts.owner);
    const intake = this.get(CrmIntakeService);
    const find = () => this.findLead(actor, party);
    return this.step(`enquiry ${reference}`, find, async () => {
      const options = await this.intakeOptions(actor);
      if (!options.sources.length) throw new Skip("the workspace has no enquiry sources configured");
      const enquiryType = (facts.pick.type ? options.enquiryTypes.find((row) => facts.pick.type!.test(row.id)) : undefined)
        ?? options.enquiryTypes.find((row) => row.id !== "not_sure") ?? options.enquiryTypes[0];
      const emirate = options.emirates.find((row) => row.id === (facts.emirate ?? "dubai")) ?? options.emirates[0];
      const customerType = options.customerTypes.find((row) => /end_user|homeowner|individual/i.test(row.id)) ?? options.customerTypes[0];
      const budgetRange = options.budgetRanges.at(-1) ?? options.budgetRanges[0];
      // The chosen source and channel; a source this person may not use (or a referral list that's empty) hands over to the next one.
      let lastError: unknown = null;
      for (let attempt = 0; attempt < options.sources.length; attempt += 1) {
        const source = options.sources[(facts.pick.source + attempt) % options.sources.length];
        const channels = options.channels[source.id] ?? [];
        const channel = channels.length ? channels[facts.pick.channel % channels.length] : null;
        const referral = source.id === "referral" ? this.referral(channel?.id ?? "", owner, options) : null;
        if (source.id === "referral" && !referral) continue;
        const body = await this.validated(CreateIntakeEventDto, {
          source: source.id, channel: channel?.id ?? source.id, intakeMethod: "manual", externalEventId: reference,
          party: { displayName: party.displayName, email: party.email, mobile: party.mobile },
          title: facts.title, summary: facts.summary, serviceType: enquiryType?.id ?? "not_sure",
          details: { emirate: emirate?.id ?? "dubai", area: facts.area, ...(customerType ? { customerType: customerType.id } : {}), ...(budgetRange ? { budgetRange: budgetRange.id } : {}) },
          assignment: owner.membershipId ? { mode: "manual", ownerMembershipId: owner.membershipId } : { mode: "unassigned" },
          ...(referral ? { referral } : {}),
          originalPayload: { seed: "showcase", reference, fictional: true },
          receivedAt: daysAgo(facts.daysAgo).toISOString(),
        });
        try {
          await intake.createManual(actor, this.w, `seed:showcase:enquiry:${this.w}:${key}:${source.id}:${party.email.toLowerCase()}`, randomUUID(), body);
          lastError = null;
          break;
        } catch (error) {
          if (!(error instanceof HttpException) || ![403, 422].includes(error.getStatus())) throw error;
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      const created = await find();
      if (!created) throw new Error("the enquiry was recorded but is not listed");
      return created;
    });
  }

  /** Who referred a referral enquiry, in the shape its channel asks for; null when the list it needs is empty. */
  private referral(channel: string, owner: Actor, options: { referralBrokers?: Array<{ id: string }>; referralPartners?: Array<{ id: string }> }) {
    if (channel === "internal") return owner.membershipId ? { membershipId: owner.membershipId } : null;
    if (channel === "external") return { name: "A previous client", contact: "" };
    const list = channel === "broker" ? options.referralBrokers : options.referralPartners;
    return list?.length ? { option: list[0].id } : null;
  }

  private async enquiry(ctx: Ctx) {
    const { s } = ctx;
    const lead = await this.intake(s.key, s.reference, s.client, { title: s.title, summary: s.summary, area: s.area, emirate: s.emirate, daysAgo: s.daysAgo, owner: s.owner, pick: s.pick });
    return { leadId: lead.id, partyId: lead.partyId };
  }

  private async qualify(leadId: string, partyId: string, owner: Actor, facts: { title: string; summary: string; amount: number; daysAgo: number }) {
    const opportunities = this.get(CrmOpportunitiesService), leads = this.get(CrmLeadsService);
    const find = async () => {
      const list = (await opportunities.list(owner, this.w, { partyId, limit: 50 } as never)) as unknown as { data: Array<{ id: string; title: string }> };
      return list.data.find((row) => row.title === facts.title) ?? null;
    };
    return this.step(`opportunity ${facts.title}`, find, async () => {
      const pipelines = (await opportunities.listPipelines(owner, this.w)) as Array<{ id: string; isDefault: boolean; stages: Array<{ id: string; code: string; position: number }> }>;
      const pipeline = pipelines.find((row) => row.isDefault) ?? pipelines[0];
      if (!pipeline) throw new Skip("no sales pipeline is configured");
      const first = [...pipeline.stages].sort((a, b) => a.position - b.position)[0];
      const lead = (await leads.get(owner, this.w, leadId)) as unknown as { version: number };
      const body = await this.validated(QualifyLeadDto, {
        leadVersion: lead.version, partyId, leadId, pipelineId: pipeline.id, stageId: first.id, ...(owner.membershipId ? { ownerMembershipId: owner.membershipId } : {}),
        title: facts.title, description: facts.summary, amount: facts.amount, currencyCode: this.currency,
        expectedCloseAt: daysAgo(facts.daysAgo - 28).toISOString(), nextActionAt: daysAgo(-2).toISOString(),
      });
      return this.tryAs(owner, (actor) => opportunities.qualifyLead(actor, this.w, leadId, body) as Promise<{ id: string; title: string }>);
    });
  }

  private async opportunity(ctx: Ctx, leadId: string, partyId: string) {
    const { s } = ctx;
    const opportunity = await this.qualify(leadId, partyId, await this.as(s.owner), { title: s.title, summary: s.summary, amount: s.amount, daysAgo: s.daysAgo });
    return opportunity.id;
  }

  private async planningCase(ctx: Ctx, opportunityId: string) {
    const owner = await this.as(ctx.s.owner);
    const cases = this.get(PreProjectsService);
    const find = async () => {
      const list = (await cases.list(owner, this.w, { search: ctx.s.title, status: "all" } as never)) as { items: Array<{ id: string; opportunityId: string; status: string }> };
      return list.items.find((row) => row.opportunityId === opportunityId && row.status !== "qualified") ?? null;
    };
    const found = await this.step("planning record (converted)", find, async () => {
      await this.tryAs(owner, (actor) => cases.start(actor, this.w, opportunityId));
      const created = await find();
      if (!created) throw new Error("the planning record was started but is not listed");
      return created;
    });
    return found.id;
  }

  /** The client's portal identities on this case, each with the demonstration sign-in code; the one who decides is returned. */
  private async portalContacts(ctx: Ctx, caseId: string) {
    const actor = await this.actor(this.input.actorUserId);
    const admin = this.get(ClientPortalAdminService);
    const contacts = async () => ((await admin.contacts(actor, this.w, caseId)) as { contacts: Array<{ id: string; phone: string; version: number; demoCode: boolean }> }).contacts;
    const people = [{ ...ctx.s.client, decides: !(ctx.s.approvers ?? []).some((person) => person.decides) }, ...(ctx.s.approvers ?? [])];
    let decider = "";
    for (const person of people) {
      const grant = await this.step(`client portal contact ${person.displayName}`, async () => (await contacts()).find((row) => row.phone === person.mobile) ?? null, async () => {
        await admin.saveContact(actor, this.w, caseId, { name: person.displayName, phone: person.mobile, email: person.email, role: "approver", active: true });
        return (await contacts()).find((row) => row.phone === person.mobile)!;
      });
      const withCode = typeof (admin as unknown as { demoCode?: unknown }).demoCode === "function";
      if (!withCode) this.skip("demo sign-in code", "ClientPortalAdminService.demoCode is not available yet; set the code 123456 on the contact once it is");
      else await this.advance(`demo sign-in code for ${person.displayName}`, grant.demoCode, () => admin.demoCode(actor, this.w, caseId, grant.id, { commandId: this.id(ctx, `demo-code:${grant.id}:${grant.version}`), version: grant.version, code: person.demoCode }));
      if (person.decides) decider = grant.id;
    }
    return decider;
  }

  // ---------------------------------------------------------------- Planning

  private async brief(ctx: Ctx, caseId: string) {
    const { s, rooms } = ctx;
    const designer = await this.as("designer");
    const brief = this.get(BriefService);
    for (const name of s.rooms) {
      const id = this.id(ctx, `room:${name}`);
      const room = await this.step(`room ${name}`, async () => ((await brief.get(designer, this.w, caseId)) as { rooms: Array<{ id: string; name: string }> }).rooms.find((row) => row.id === id) ?? null,
        async () => brief.saveRoom(designer, this.w, caseId, await this.validated(SaveRoomDto, { id, version: 0, name })) as Promise<{ id: string }>);
      rooms.set(name, room.id);
    }
    const entries = async () => ((await brief.get(designer, this.w, caseId)) as { entries: Array<{ id: string; board?: unknown | null }> }).entries;
    let current = await entries();
    for (const item of s.requirements) {
      const id = this.id(ctx, `requirement:${item.key}`);
      const record = await this.catalogRecord(item.catalog);
      await this.step(`requirement ${item.title}`, async () => current.find((row) => row.id === id) ?? null, async () => {
        const body = await this.validated(SaveBriefEntryDto, {
          id, version: 0, kind: "requirement", title: item.title, roomId: rooms.get(item.room) ?? null, note: item.note, category: item.category, priority: item.priority,
          scopeStatus: "included", reviewStatus: "reviewed", quantity: item.quantity, unit: item.unit, referenceUrl: "", avoid: "", source: "client", assetIds: [],
          ...(record?.kind === "work" ? { catalogLinks: [{ role: "work", recordId: record.id }] } : {}),
        });
        const saved = await brief.saveEntry(designer, this.w, caseId, body) as { id: string };
        current = await entries();
        return saved;
      });
    }
    // Inspiration on the moodboard: Core Collection pictures when the workspace has them, otherwise the ideas alone.
    const pins: Array<{ entryId: string; x: number; y: number; width: number; z: number; sentiment: "love" | "avoid" }> = [];
    for (const [index, item] of s.inspiration.entries()) {
      const id = this.id(ctx, `inspiration:${item.key}`);
      const assetId = await this.picture(ctx, caseId, designer, `inspiration:${item.key}`, item.catalog);
      const entry = await this.step(`inspiration ${item.title}`, async () => current.find((row) => row.id === id) ?? null, async () => {
        const body = await this.validated(SaveBriefEntryDto, {
          id, version: 0, kind: "inspiration", title: item.title, roomId: null, note: item.catalog[0], category: "Inspiration", priority: "preferred",
          scopeStatus: "included", reviewStatus: "reviewed", unit: "nos", referenceUrl: "", avoid: "", source: "team", assetIds: assetId ? [assetId] : [],
        });
        const saved = await brief.saveEntry(designer, this.w, caseId, body) as { id: string };
        current = await entries();
        return saved;
      });
      pins.push({ entryId: entry.id, x: 40 + (index % 2) * 360, y: 40 + Math.floor(index / 2) * 300, width: 320, z: index, sentiment: "love" });
    }
    const pinned = new Set(current.filter((entry) => entry.board).map((entry) => entry.id));
    await this.advance("moodboard layout", pins.every((pin) => pinned.has(pin.entryId)), async () =>
      brief.saveMoodboardLayout(designer, this.w, caseId, await Promise.all(pins.map((pin) => this.validated(MoodboardPinDto, pin)))));
    // The site plan the quotation needs: a plan file on the record (the seed's own drawing tile).
    const planId = this.id(ctx, "asset:site-plan"), planEntry = this.id(ctx, "file:site-plan");
    await this.step("site plan file", async () => current.find((row) => row.id === planEntry) ?? null, async () => {
      await this.upload(caseId, designer, planId, tile(`${s.key}-site-plan`));
      const body = await this.validated(SaveBriefEntryDto, {
        id: planEntry, version: 0, kind: "file", title: `Site plan · ${s.title}`, roomId: null, note: "Measured plan from the site visit.", category: "site plan",
        priority: "must_have", scopeStatus: "included", reviewStatus: "reviewed", unit: "file", referenceUrl: "", avoid: "", source: "team", assetIds: [planId],
      });
      const saved = await brief.saveEntry(designer, this.w, caseId, body) as { id: string };
      current = await entries();
      return saved;
    });
  }

  /** The workspace catalog by lower-cased name: Core Collection or starter items, whatever is there. */
  private async catalogByName() {
    if (this.catalog) return this.catalog;
    const byName = new Map<string, { id: string; name: string; kind: string; primaryAsset?: { id: string } | null }>();
    try {
      const { CatalogService } = await import("../catalog/catalog.service");
      const actor = await this.actor(this.input.actorUserId);
      const list = (await this.get(CatalogService).list(actor, this.w)) as { items: Array<{ id: string; name: string; kind: string; primaryAsset?: { id: string } | null }> };
      for (const item of list.items) byName.set(item.name.trim().toLowerCase(), item);
    } catch (error) {
      this.log(`  note     catalog not readable: ${describe(error)}`);
    }
    this.catalog = byName;
    return byName;
  }

  /** The first of these names that is a catalog record here. */
  private async catalogRecord(names: string[] | undefined) {
    if (!names?.length) return null;
    const catalog = await this.catalogByName();
    for (const name of names) {
      const record = catalog.get(name.trim().toLowerCase());
      if (record) return record;
    }
    return null;
  }

  /** A Core Collection picture copied onto the case when the catalog record has one; otherwise nothing. */
  private async picture(ctx: Ctx, caseId: string, actor: Actor, key: string, names: string[]): Promise<string | null> {
    const record = await this.catalogRecord(names);
    if (!record?.primaryAsset) return null;
    try {
      const { CatalogAssetsService } = await import("../catalog/catalog-assets.service");
      const assets = this.get(CatalogAssetsService) as unknown as { read: (actor: RequestActor, workspaceId: string, recordId: string, assetId: string, preview: boolean) => Promise<{ body?: Buffer; buffer?: Buffer; mimeType?: string; contentType?: string; name?: string }> };
      const file = await assets.read(actor, this.w, record.id, record.primaryAsset.id, false);
      const buffer = file.body ?? file.buffer;
      if (!buffer) return null;
      const id = this.id(ctx, `asset:${key}`);
      await this.upload(caseId, actor, id, { buffer, originalname: file.name ?? `${key}.png`, mimetype: file.mimeType ?? file.contentType ?? "image/png", size: buffer.length });
      return id;
    } catch {
      return null;
    }
  }

  /** A case asset by stable id: uploaded once, found afterwards. */
  private async upload(caseId: string, actor: Actor, id: string, file: Upload) {
    const brief = this.get(BriefService);
    try { await brief.asset(actor, this.w, caseId, id, false); return id; } catch { /* not there yet */ }
    await brief.upload(actor, this.w, caseId, id, file);
    return id;
  }

  private async siteVisit(ctx: Ctx, caseId: string) {
    const { s, rooms } = ctx;
    const designer = await this.as("designer");
    const site = this.get(PlanningSiteService), specifications = this.get(ItemSpecificationService), brief = this.get(BriefService);
    const visitId = this.id(ctx, "site-visit");
    type Record_ = { id: string; version: number; status?: string; kind?: string; entryId?: string | null };
    const records = async () => (await site.list(designer, this.w, caseId)) as { visits?: Record_[]; measurements?: Record_[]; items?: Record_[] };
    const found = (state: Awaited<ReturnType<typeof records>>, id: string): Record_ | null =>
      [...(state.visits ?? []), ...(state.measurements ?? []), ...(state.items ?? [])].find((row) => row.id === id) ?? null;
    const outcome = `Measured ${s.rooms.map((room) => room.toLowerCase()).join(", ")}. ${s.measurement.title} ${(s.measurement.width / 1000).toFixed(1)} m; power where needed.`;
    await this.step("site visit", async () => found(await records(), visitId), async () => {
      const body = await this.validated(SaveSiteVisitDto, {
        id: visitId, version: 0, title: "Site visit · measurements and photos", note: outcome, assetIds: [], scheduledAt: daysAgo(s.daysAgo - 7).toISOString(), timezone: this.timezone,
        durationMinutes: 120, assigneeId: designer.userId, location: `${s.title} (fictional address)`, access: "Call the client on arrival.", status: "completed", outcome,
      });
      return site.saveVisit(designer, this.w, caseId, body);
    });
    // The made item's specification, then the opening measured against it and verified.
    const entryId = this.id(ctx, `requirement:${s.measurement.requirement}`);
    const entries = ((await brief.get(designer, this.w, caseId)) as { entries: Array<{ id: string }> }).entries;
    if (!entries.some((row) => row.id === entryId)) throw new Skip("the measured requirement is not on the brief");
    const history = (await specifications.history(designer, this.w, caseId, entryId)) as { items: Array<{ version: number }> };
    await this.advance("specification", history.items.length > 0, async () => specifications.save(designer, this.w, caseId, entryId, await this.validated(SaveItemSpecificationDto, {
      version: 0, refinedRequirement: "Made to the verified site opening; finishes as selected on the moodboard.", construction: "Factory-made carcasses, site-fitted.",
      inclusions: "Carcass, doors, cable management, installation.", exclusions: "Equipment and loose furniture.", assumptions: "Verified site opening.",
      materials: [], dimensions: [], designRefs: [],
    })));
    // One measurement per requirement: the one already on it (whatever its id) is the one taken forward.
    const onEntry = (state: Awaited<ReturnType<typeof records>>) => [...(state.items ?? []), ...(state.measurements ?? [])].find((row) => row.kind === "measurement" && row.entryId === entryId) ?? found(state, this.id(ctx, "measurement:main"));
    const existing = onEntry(await records());
    const measurementId = existing?.id ?? this.id(ctx, "measurement:main");
    // Verification needs the measured values and a supporting photo: the seed's site photo of the opening.
    const photoId = await this.upload(caseId, designer, this.id(ctx, "asset:measurement-photo"), tile(`${s.key}-opening`));
    // Each save is checked against the specification it measures, which the save itself revises: read it fresh every time.
    const measurementBody = async (version: number) => this.validated(SaveSiteMeasurementDto, {
      id: measurementId, version, title: s.measurement.title, note: "Measured on the site visit with a laser measure.", assetIds: [photoId], roomId: rooms.get(s.requirements.find((item) => item.key === s.measurement.requirement)?.room ?? "") ?? null, entryId, visitId,
      specificationVersion: Math.max(((await specifications.history(designer, this.w, caseId, entryId)) as { items: Array<{ version: number }> }).items[0]?.version ?? 1, 1),
      dimensions: [
        { id: this.id(ctx, "dimension:width"), name: "Width", unit: "mm", basis: "site_opening", measured: s.measurement.width, source: "team", evidence: "Laser measure" },
        { id: this.id(ctx, "dimension:height"), name: "Height", unit: "mm", basis: "site_opening", measured: s.measurement.height, source: "team", evidence: "Laser measure" },
      ],
    });
    await this.step(`measurement · ${s.measurement.title}`, async () => existing, async () => site.saveMeasurement(designer, this.w, caseId, await measurementBody(0)));
    const measurement = onEntry(await records());
    if (!measurement) throw new Skip("the measurement was saved but is not listed");
    await this.advance("measurement verified", measurement.status === "verified", async () => {
      // An unverified measurement is saved again with its photo (the same values), then verified.
      await site.saveMeasurement(designer, this.w, caseId, await measurementBody(measurement.version));
      const fresh = onEntry(await records())!;
      return this.tryAs(designer, (actor) => site.review(actor, this.w, caseId, fresh.id, { version: fresh.version, status: "verified", note: "Checked against the drawing." } as ReviewSiteMeasurementDto));
    });
  }

  private async design(ctx: Ctx, caseId: string) {
    const { s, rooms } = ctx;
    const designer = await this.as("designer");
    const designs = this.get(DesignService);
    const designId = this.id(ctx, "design:concept"), versionId = this.id(ctx, "design:concept:v1"), assetId = this.id(ctx, "asset:design-concept");
    const list = async () => ((await designs.list(designer, this.w, caseId)) as { items: Array<{ id: string; version: number; versions: Array<{ id: string; status: string }> }> }).items;
    let design = await this.step("concept board", async () => (await list()).find((row) => row.id === designId) ?? null, async () => {
      await this.upload(caseId, designer, assetId, tile(`${s.key}-concept`));
      await designs.uploadFiles(designer, this.w, caseId, await this.validated(UploadDesignFilesDto, {
        roomId: rooms.get(s.rooms[0]) ?? null, note: "Concept board: palette, key pieces and the made joinery.",
        files: [{ id: designId, versionId, assetId, title: `${s.rooms[0]} concept board`, documentType: "Concept / mood board", note: "Revision 1", includedClientRounds: 1 }],
      }));
      return (await list()).find((row) => row.id === designId)!;
    });
    const status = () => design.versions.find((version) => version.id === versionId)?.status ?? "";
    const refresh = async () => { design = (await list()).find((row) => row.id === designId)!; };
    const activity = async (actor: Actor, key: string, action: string, extra: Record<string, unknown> = {}) => {
      await refresh();
      return designs.activity(actor, this.w, caseId, designId, await this.validated(DesignActivityDto, { id: this.id(ctx, `design-activity:${key}`), version: design.version, versionId, action, note: "", decisionBy: "", ...extra }));
    };
    const reviewer = await this.other(designer, ["manager", "owner", "projectManager"]);
    if (["draft", "uploaded"].includes(status())) {
      await this.advance("design · internal review requested", false, () => activity(designer, "internal_review", "internal_review", { reviewerId: reviewer.userId, contextConfirmed: true }));
      await refresh();
    }
    if (s.design === "internal_review") { if (status() === "internal_review") this.kept("design · waiting for internal review"); return; }
    if (status() === "internal_review") { await this.advance("design · internally approved", false, () => activity(reviewer, "internal_approved", "internal_approved", { note: "Layout and selections checked." })); await refresh(); }
    if (status() === "internal_approved") { await this.advance("design · shared with the client", false, () => activity(designer, "client_review", "client_review")); await refresh(); }
    if (status() === "client_review") {
      await this.advance("design · accepted by the client in the portal", false, async () => {
        const view = await this.portalView(ctx);
        const project = view.projects.find((row) => row.id === caseId);
        const shared = project?.decisions?.designs?.find((row: Any) => row.id === versionId);
        if (!shared?.canDecide) throw new Skip("the design is not open for the client's decision in the portal");
        await this.portalDecision(ctx, "design_decision", `design:${caseId}:${versionId}:accept`, { caseId, versionId, decision: "accept", note: "Love it. Go ahead." });
      });
    } else if (status() === "approved") this.kept("design · accepted by the client");
    else if (status()) this.skip("design", `the concept board is ${status()}`);
  }

  // ---------------------------------------------------------------- Quotation

  private async quotation(ctx: Ctx, caseId: string) {
    const { s, rooms } = ctx;
    const salesAdmin = await this.as("salesAdmin");
    const commercial = this.get(CommercialService), builder = this.get(QuotationBuilderService);
    const state = async () => (await commercial.state(salesAdmin, this.w, caseId)) as unknown as { data: Any };
    let current = await state();
    await this.advance("service route (main quotation, materials, procurement, factory, site, installation)", Boolean(current.data.palmFlow), async () => {
      await commercial.command(salesAdmin, this.w, caseId, { action: "set_palm_flow", revision: current.data.revision,
        scope: { design: false, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true } });
      current = await state();
    });
    const quote = await this.step("quotation", async () => (current.data.quotes ?? []).find((row: Any) => row.kind === "quotation") ?? null, async () => {
      const created = (await commercial.command(salesAdmin, this.w, caseId, { action: "create", revision: current.data.revision })) as { data: Any };
      current = await state();
      return created.data.quotes.at(-1);
    });
    const quoteId = quote.id as string;
    if (quote.status !== "draft") { this.kept("quotation lines and terms"); return quoteId; }
    const built = (await builder.builder(salesAdmin, this.w, caseId, quoteId)) as unknown as { lines: Array<{ id: string; version: number }> };
    const existing = new Set(built.lines.map((line) => line.id));
    const search = async (queries: string[]) => {
      for (const query of queries) {
        const hits = (await builder.search(salesAdmin, this.w, caseId, quoteId, query, 10).catch(() => ({ items: [] }))) as { items: Array<{ id: string; name: string; unitCode: string; description: string | null }> };
        const hit = hits.items.find((item) => item.name.trim().toLowerCase() === query.toLowerCase()) ?? hits.items[0];
        if (hit) return hit;
      }
      return null;
    };
    // Realistic lines from the workspace's own catalog; a line whose item isn't in the catalog is entered by hand.
    const ops: unknown[] = [];
    let fromCatalog = 0;
    for (const line of s.lines) {
      const id = this.id(ctx, `line:${line.key}`);
      if (existing.has(id)) continue;
      const hit = await search(line.catalog);
      const fields: Any = { id, quantity: line.quantity, unit: hit?.unitCode || line.unit, rate: line.rate, unitCost: line.unitCost, areaId: rooms.get(line.room) ?? null,
        title: line.title ?? hit?.name ?? line.catalog[0], description: hit?.description ?? "" };
      if (hit) { fromCatalog += 1; ops.push({ op: "catalog", itemId: hit.id, line: fields }); } else ops.push({ op: "upsert", line: fields });
    }
    const editor = await this.actor(this.input.actorUserId);
    if (ops.length) {
      await this.advance(`${ops.length} quotation lines (${fromCatalog} from the catalog)`, false, async () => {
        try { await builder.apply(salesAdmin, this.w, caseId, quoteId, { ops }); } catch (error) {
          // Without cost permission the sales admin can't enter the cost side: the run's actor does.
          if (!(error instanceof HttpException) || error.getStatus() !== 403) throw error;
          await builder.apply(editor, this.w, caseId, quoteId, { ops });
        }
      });
    } else this.kept("quotation lines");
    await this.price(ctx, caseId, quoteId);
    const terms = ((await builder.builder(salesAdmin, this.w, caseId, quoteId)) as unknown as { quote: { paymentTerms: Array<{ title: string; percent: number }> } }).quote.paymentTerms;
    await this.advance(`payment schedule ${s.terms.map((term) => term.percent).join(" / ")}`, terms.length === s.terms.length && terms.every((term, index) => term.title === s.terms[index].title && Number(term.percent) === s.terms[index].percent),
      () => builder.setPaymentTerms(salesAdmin, this.w, caseId, quoteId, { terms: s.terms.map((term) => ({ id: this.id(ctx, `term:${term.title}`), ...term })) }));
    return quoteId;
  }

  /**
   * The seed's rate and cost on every line: a catalog build-up without costs, or a price book without a price,
   * would otherwise leave the QS nothing to review. Only a draft can be priced.
   */
  private async price(ctx: Ctx, caseId: string, quoteId: string) {
    const builder = this.get(QuotationBuilderService);
    const actor = await this.actor(this.input.actorUserId);
    const priced = (await builder.builder(actor, this.w, caseId, quoteId)) as unknown as { quote: { status: string }; lines: Array<{ id: string; version: number; rate: string; unitCost: string | null; pricingMode?: string; catalogPrice?: { status: string } | null }> };
    const fix = ctx.s.lines.map((line) => ({ line, row: priced.lines.find((row) => row.id === this.id(ctx, `line:${line.key}`)) }))
      .filter(({ line, row }) => row && (row.pricingMode === "build_up" || Number(row.rate) !== Number(line.rate) || Number(row.unitCost ?? 0) !== Number(line.unitCost) || (row.catalogPrice && row.catalogPrice.status !== "resolved")))
      .map(({ line, row }) => ({ op: "upsert", line: { id: row!.id, version: row!.version, pricingMode: "rate", rate: line.rate, unitCost: line.unitCost } }));
    if (priced.quote.status !== "draft") return fix.length;
    await this.advance(`${fix.length} lines priced by the seed`, !fix.length, () => builder.apply(actor, this.w, caseId, quoteId, { ops: fix }));
    return 0;
  }

  private async commercialCommand(caseId: string, actor: Actor, action: string, extra: Record<string, unknown> = {}) {
    const commercial = this.get(CommercialService);
    const current = (await commercial.state(actor, this.w, caseId)) as unknown as { data: Any };
    return (await commercial.command(actor, this.w, caseId, { action, revision: current.data.revision, ...extra })) as { data: Any };
  }

  private async commercialData(caseId: string, actor?: Actor) {
    const commercial = this.get(CommercialService);
    return ((await commercial.state(actor ?? await this.as("salesAdmin"), this.w, caseId)) as unknown as { data: Any }).data;
  }

  /** Review and issue: submitted by Sales admin, the QS estimate, issued to the client's decision-maker. */
  private async issue(ctx: Ctx, caseId: string, quoteId: string, grantId: string) {
    const salesAdmin = await this.as("salesAdmin");
    const quote = async () => ((await this.commercialData(caseId)).quotes as Any[]).find((row) => row.id === quoteId)!;
    let status = (await quote()).status as string;
    if (status === "internal_review" && (await this.price(ctx, caseId, quoteId)) > 0) {
      // Submitted before its costs were complete: the QS sends it back, the lines are priced, and it goes in again.
      const estimator = await this.as("estimator");
      await this.advance("quotation returned by the QS for costs", false, () => this.tryAs(estimator, (actor) => this.commercialCommand(caseId, actor, "return", { quoteId, note: "Enter the cost side before the estimate review." })));
      await this.price(ctx, caseId, quoteId);
      status = "draft";
    }
    if (status === "draft") { await this.advance("quotation submitted for review", false, () => this.commercialCommand(caseId, salesAdmin, "submit", { quoteId })); status = "internal_review"; }
    if (status === "internal_review") {
      const estimator = await this.as("estimator");
      await this.advance("QS estimate approved", false, () => this.tryAs(estimator, (actor) => this.commercialCommand(caseId, actor, "qs_approve", { quoteId })));
      status = "internal_approved";
    }
    if (status === "internal_approved") {
      if (!grantId) throw new Skip("no client contact to issue the quotation to");
      await this.advance("quotation issued to the client", false, () => this.commercialCommand(caseId, salesAdmin, "issue", { quoteId, approverId: grantId }));
      status = "issued";
    }
    if (status === "issued") this.kept("quotation awaiting the client's decision");
  }

  /** The client accepts in the portal; then the agreement, the advance, the won opportunity and the deal review. */
  private async approvals(ctx: Ctx, caseId: string, quoteId: string, opportunityId: string) {
    const salesAdmin = await this.as("salesAdmin");
    const quote = async () => ((await this.commercialData(caseId)).quotes as Any[]).find((row) => row.id === quoteId)!;
    let status = (await quote()).status as string;
    if (status === "issued") {
      await this.advance("quotation accepted by the client in the portal", false, async () => {
        const view = await this.portalView(ctx);
        const project = view.projects.find((row) => row.id === caseId);
        const issued = project?.decisions?.quotes?.find((row: Any) => row.id === quoteId);
        if (!issued?.canDecide) throw new Skip("the quotation is not open for the client's decision in the portal");
        await this.portalDecision(ctx, "quote_decision", `quote:${caseId}:${quoteId}:accept`, { caseId, quoteId, decision: "accept", selectedOptionLineIds: [], note: "", hash: issued.hash });
      });
      status = "accepted";
    } else if (status === "accepted") this.kept("quotation accepted by the client");
    if (status !== "accepted") throw new Skip(`the quotation is ${status}`);

    let data = await this.commercialData(caseId);
    const reference = `AGR-${ctx.s.key.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-2026`;
    // Evidence reads as it would on a real file: the product refuses to execute or verify anything marked as a demonstration.
    await this.advance("agreement recorded", Boolean(data.agreement) && isOperationalEvidence(data.agreement), () => this.commercialCommand(caseId, salesAdmin, "agreement", { quoteId, reference,
      terms: "Accepted quotation terms; the firm's standard terms and conditions apply.", evidence: `Signed agreement ${reference} on file (showcase).`, evidenceKind: "operational" }));
    data = await this.commercialData(caseId);
    const owner = await this.as("owner");
    await this.advance("agreement executed", data.agreement?.status === "executed", () => this.tryAs(owner, (actor) => this.commercialCommand(caseId, actor, "execute_agreement")));
    data = await this.commercialData(caseId);
    const release = (data.payments as Any[]).find((payment) => payment.sourceQuoteId === quoteId && payment.requiredForRelease);
    if (!release) throw new Skip("the accepted quotation has no release payment");
    await this.payment(ctx, caseId, release, "advance", `RCPT-${ctx.s.key.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-ADV-1`);

    // Sales marks the opportunity won once the client accepted and paid.
    const opportunities = this.get(CrmOpportunitiesService);
    const sales = await this.as(ctx.s.owner);
    const opportunity = (await opportunities.get(sales, this.w, opportunityId)) as unknown as { status: string; version: number; pipelineId: string };
    await this.advance("opportunity won", opportunity.status === "won", async () => {
      const pipelines = (await opportunities.listPipelines(sales, this.w)) as Array<{ id: string; stages: Array<{ id: string; code: string }> }>;
      const won = pipelines.find((row) => row.id === opportunity.pipelineId)?.stages.find((stage) => stage.code === "won");
      const body = await this.validated(TransitionOpportunityDto, { version: opportunity.version, ...(won ? { stageId: won.id } : {}), status: "won", reason: "Quotation accepted and advance received." });
      await this.tryAs(sales, (actor) => opportunities.transition(actor, this.w, opportunityId, body));
    });

    data = await this.commercialData(caseId);
    const commissionLines = [{ recipientName: sales.displayName, type: "sales", basis: "percent", value: 2 }];
    const review = data.ownerReview as Any | undefined;
    await this.advance("deal submitted for Finance and Owner review", Boolean(review && review.quoteId === quoteId), () => this.commercialCommand(caseId, salesAdmin, "submit_owner_review", {
      checklist: { agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true }, commissionLines,
      paymentProofUrl: `https://example.invalid/receipts/${reference}`, note: "Showcase deal file.",
    }));
    data = await this.commercialData(caseId);
    const finance = await this.as("finance");
    await this.advance("deal confirmed by Finance", !["pending_finance", "submitted"].includes(data.ownerReview?.status), () =>
      this.tryAs(finance, (actor) => this.commercialCommand(caseId, actor, "review_deal_finance", { decision: "confirm", paymentVerified: true, commissionLines, note: "Receipt and commission checked." })));
    data = await this.commercialData(caseId);
    await this.advance("deal approved by the Owner", data.ownerReview?.status !== "pending_approval", () =>
      this.tryAs(owner, (actor) => this.commercialCommand(caseId, actor, "decide_owner_review", { decision: "approve", note: "Approved for delivery." })));
    data = await this.commercialData(caseId);
    if (data.ownerReview?.status !== "approved") throw new Skip(`the deal review is ${data.ownerReview?.status ?? "not started"}`);
  }

  /** A client payment: reported by Sales with its bank reference, verified by Finance. */
  private async payment(ctx: Ctx, caseId: string, payment: Any, label: string, reference: string) {
    const salesAdmin = await this.as("salesAdmin"), finance = await this.as("finance");
    if (payment.status === "verified") { this.kept(`${label} payment verified`); return; }
    const data = await this.commercialData(caseId);
    const receipts = (data.receipts ?? []) as Any[];
    await this.advance(`${label} payment reported`, receipts.some((receipt) => receipt.paymentId === payment.id), () =>
      this.commercialCommand(caseId, salesAdmin, "report_payment_receipt", { paymentId: payment.id, reference, evidence: "Bank transfer confirmation on file (showcase).", evidenceKind: "operational" }));
    await this.advance(`${label} payment verified by Finance`, false, () => this.tryAs(finance, (actor) => this.commercialCommand(caseId, actor, "verify_payment", { paymentId: payment.id })));
    void ctx;
  }

  // ---------------------------------------------------------------- Client portal (the client's side)

  private async portalView(ctx: Ctx) {
    const portal = this.get(ClientPortalService);
    const client = ctx.s.client;
    let token = this.portalTokens.get(client.mobile);
    if (!token) {
      const challenge = (await portal.challenge(this.slug, { phone: client.mobile }, "", `seed:${ctx.s.key}`)) as { challengeId: string };
      const session = (await portal.login(this.slug, { challengeId: challenge.challengeId, code: client.demoCode })) as { token: string };
      token = session.token;
      this.portalTokens.set(client.mobile, token);
    }
    const view = (await portal.view(this.slug, token)) as { projects: Any[] };
    return { token, projects: view.projects };
  }

  private async portalDecision(ctx: Ctx, action: string, purpose: string, body: Record<string, unknown>) {
    const portal = this.get(ClientPortalService);
    const { token } = await this.portalView(ctx);
    const challenge = (await portal.challenge(this.slug, { purpose }, token, `seed:${ctx.s.key}`)) as { challengeId: string };
    const result = (await portal.command(this.slug, token, { commandId: randomUUID(), action, ...body, challengeId: challenge.challengeId, code: ctx.s.client.demoCode })) as { ok?: boolean };
    if (!result.ok) throw new Error(`the client's ${action} did not go through`);
  }

  // ---------------------------------------------------------------- Project

  private async project(ctx: Ctx, caseId: string, quoteId: string) {
    const { s } = ctx;
    const projects = this.get(ProjectCoreService);
    const pm = await this.as("projectManager");
    const actor = await this.actor(this.input.actorUserId);
    const started = await this.step("project started from the accepted quotation", async () => {
      const readiness = (await projects.startState(actor, this.w, caseId)) as { project?: { id: string } | null };
      return readiness.project?.id ? { projectId: readiness.project.id } : null;
    }, async () => {
      const readiness = (await projects.startState(actor, this.w, caseId)) as { canStart: boolean; checks: Array<{ key: string; ok: boolean }> };
      if (!readiness.canStart) throw new Skip(`start rules: ${readiness.checks.filter((check) => !check.ok).map((check) => check.key).join(", ") || "not startable"}`);
      const lead = pm.membershipId ?? actor.membershipId;
      return this.tryAs(pm, (who) => projects.start(who, this.w, caseId, { quoteId, leadMembershipId: lead, name: s.title, startDate: dayFrom(-s.execution.startDaysAgo), promiseDate: dayFrom(s.execution.promiseDays) }) as Promise<{ projectId: string }>);
    });
    const projectId = started.projectId;
    const roles: Array<[string, ShowcaseRole]> = [["quantity_surveyor", "estimator"], ["procurement", "buyer"], ["site_supervisor", "site"], ["factory_lead", "factory"], ["designer", "designer"]];
    for (const [role, key] of roles) {
      const person = await this.as(key);
      if (!person.membershipId || person.userId === actor.userId && key !== "designer") continue;
      const detail = (await projects.get(actor, this.w, projectId)) as unknown as { project: { version: number; status: string }; team: Array<{ role: string; member: { membershipId: string } | null }> };
      if (!["active", "on_hold"].includes(detail.project.status)) { this.kept("project team (the project is closed)"); break; }
      const holder = detail.team.find((row) => row.role === role)?.member?.membershipId ?? null;
      await this.advance(`team · ${role}`, holder === person.membershipId || (holder !== null && holder !== person.membershipId),
        () => projects.command(actor, this.w, projectId, { action: "set_member", role, membershipId: person.membershipId, version: detail.project.version }));
    }
    return projectId;
  }

  private async invite(ctx: Ctx, projectId: string) {
    const admin = this.get(ClientPortalAdminService);
    const actor = await this.actor(this.input.actorUserId);
    const portal = (await admin.project(actor, this.w, projectId)) as { client: { status: string; version: number; blocked: string | null } };
    await this.advance("client invited to the portal (delivery suppressed)", ["invited", "active"].includes(portal.client.status), async () => {
      if (portal.client.blocked) throw new Skip(`the client can't be invited: ${portal.client.blocked}`);
      await admin.inviteClient(actor, this.w, projectId, { commandId: this.id(ctx, `invite:${projectId}:${portal.client.version}`), version: portal.client.version });
    });
  }

  /** After the start: the production payment (when the story has it paid) and a milestone that fell due unpaid. */
  private async paymentsAfterStart(ctx: Ctx, caseId: string, quoteId: string) {
    const { s } = ctx;
    const data = await this.commercialData(caseId);
    const production = (data.payments as Any[]).find((payment) => payment.sourceQuoteId === quoteId && payment.requiredForProduction);
    if (production && s.execution.productionPayment) await this.payment(ctx, caseId, production, "production", `RCPT-${s.key.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-PROD-2`);
    else if (production) this.kept("production payment left unpaid");
    if (s.execution.overdue) {
      const due = (data.payments as Any[]).find((payment) => payment.title === s.execution.overdue!.title);
      if (!due) { this.skip("overdue payment", `no milestone "${s.execution.overdue.title}"`); return; }
      const salesAdmin = await this.as("salesAdmin");
      const dueDate = dayFrom(-s.execution.overdue.daysAgo);
      await this.advance(`milestone "${due.title}" due ${dueDate}, unpaid`, due.dueDate === dueDate || due.status !== "pending", () => this.commercialCommand(caseId, salesAdmin, "payment", {
        paymentId: due.id, title: due.title, amount: due.amount, dueDate, requiredForRelease: due.requiredForRelease === true, requiredForProduction: due.requiredForProduction === true, reference: due.reference ?? "",
      }));
    }
  }

  private async plan(ctx: Ctx, projectId: string) {
    const { s } = ctx;
    const projects = this.get(ProjectCoreService), work = this.get(ProjectWorkService);
    const pm = await this.as("projectManager");
    const detail = async () => (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number; status: string } };
    const scope = async () => (await projects.scope(pm, this.w, projectId)) as unknown as { lines: Array<{ id: string; title: string; packageId: string | null }>; packages: Array<{ id: string; name: string; supply: string }> };
    let current = await scope();
    // The joinery is made in the factory; the rest is bought or done on site.
    const joinery = (line: { title: string }) => s.made.test(line.title);
    let made = current.packages.find((pkg) => pkg.supply === "make" && current.lines.some((line) => joinery(line) && line.packageId === pkg.id)) ?? current.packages.find((pkg) => pkg.supply === "make");
    if (!made) {
      made = await this.step("package · Fitted joinery (made in the factory)", async () => current.packages.find((pkg) => pkg.name === "Fitted joinery") ?? null, async () => {
        const state = await detail();
        await projects.command(pm, this.w, projectId, { action: "save_package", name: "Fitted joinery", supply: "make", version: state.project.version });
        current = await scope();
        return current.packages.find((pkg) => pkg.name === "Fitted joinery")!;
      });
    } else this.kept(`package · ${made.name} (made in the factory)`);
    const moving = current.lines.filter((line) => joinery(line) && line.packageId !== made!.id).map((line) => line.id);
    await this.advance("joinery lines in the factory package", !moving.length, async () => {
      const state = await detail();
      await projects.command(pm, this.w, projectId, { action: "assign_lines", lineIds: moving, packageId: made!.id, version: state.project.version });
      current = await scope();
    });
    // The plan the team works from.
    const board = async () => ((await work.board(pm, this.w, projectId)) as { items: Array<{ id: string; title: string; status: string; version: number }> }).items;
    let items = await board();
    for (const task of s.execution.tasks) {
      const id = this.id(ctx, task.key);
      const assignee = await this.as(task.role);
      await this.step(`task · ${task.title}`, async () => items.find((row) => row.id === id) ?? null, async () => {
        await work.command(pm, this.w, projectId, { action: "create", id, type: "task", title: task.title, packageId: task.made ? made!.id : null, assigneeId: assignee.membershipId,
          startDate: dayFrom(task.start), dueDate: dayFrom(task.due), needsMaterials: task.needsMaterials === true });
        items = await board();
        return items.find((row) => row.id === id)!;
      });
      const item = items.find((row) => row.id === id);
      if (item && task.status && item.status !== task.status && item.status !== "done")
        await this.advance(`task ${task.status.replace("_", " ")} · ${task.title}`, false, () => work.command(pm, this.w, projectId, { action: "update", itemId: item.id, version: item.version, status: task.status }));
    }
  }

  private async materials(ctx: Ctx, projectId: string, caseId: string) {
    const { s } = ctx;
    const projects = this.get(ProjectCoreService);
    const pm = await this.as("projectManager");
    const list = async () => (await projects.materials(pm, this.w, projectId)) as unknown as { state?: string; revision?: { status: string } | null; items: Array<{ id: string; name: string }> };
    const scope = (await projects.scope(pm, this.w, projectId)) as unknown as { lines: Array<{ id: string; title: string }> };
    const joinery = scope.lines.filter((line) => s.made.test(line.title)).map((line) => line.id);
    let current = await list();
    for (const material of s.materials) {
      await this.step(`material · ${material.name}`, async () => current.items.find((row) => row.name === material.name) ?? null, async () => {
        const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number } };
        await projects.command(pm, this.w, projectId, { action: "save_material", name: material.name, code: material.code, specification: material.specification,
          quantity: material.quantity, unit: material.unit, boqLineIds: joinery, version: detail.project.version });
        current = await list();
        return current.items.find((row) => row.name === material.name)!;
      });
    }
    const state = () => current.state ?? current.revision?.status ?? "draft";
    if (["draft", "changed", "changes_requested"].includes(state())) {
      await this.advance("material list sent to the client", false, async () => {
        const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number } };
        await projects.command(pm, this.w, projectId, { action: "send_materials", version: detail.project.version });
        current = await list();
      });
    }
    if (state() === "sent") {
      await this.advance("material list signed off by the client in the portal", false, async () => {
        const view = await this.portalView(ctx);
        const project = view.projects.find((row) => row.id === caseId);
        const materials = project?.decisions?.materials;
        if (!materials?.canDecide) throw new Skip("the material list is not open for the client's decision in the portal");
        await this.portalDecision(ctx, "materials_decision", `materials:${caseId}:${materials.id}:submit`,
          { caseId, revisionId: materials.id, decisions: materials.items.map((item: Any) => ({ itemId: item.id, decision: "approved" })) });
      });
    } else if (state() === "signed_off") this.kept("material list signed off by the client");
    else throw new Skip(`the material list is ${state()}`);
  }

  // ---------------------------------------------------------------- Purchasing

  /**
   * Two orders: the joinery materials (veneer, hardware) to the first supplier in the register, then everything
   * else the project buys (flooring, lights, furniture) to the next one. Each is submitted, approved by someone
   * else, sent without an email and confirmed by the supplier; received at the factory and inspected by someone
   * else when the story has the goods in.
   */
  private async purchasing(ctx: Ctx, projectId: string) {
    const orders = this.get(OrdersService), suppliers = this.get(SuppliersService);
    const buyer = await this.as("buyer");
    const register = (await suppliers.list(buyer, this.w)) as unknown as { suppliers: Array<{ id: string; name: string; approval: string; status: string }> };
    const usable = register.suppliers.filter((row) => row.status !== "archived" && row.approval === "approved");
    if (!usable.length) throw new Skip("the supplier register has no approved supplier");
    type Need = { title: string; source: string; sourceId: string; projectId: string; remaining: string | null; blocked: string | null; unit: string };
    const needs = async () => ((await orders.needs(buyer, this.w)) as unknown as { needs: Need[] }).needs.filter((need) => need.projectId === projectId);
    const price = (need: { title: string; source: string }) => need.source === "material"
      ? (/veneer/i.test(need.title) ? "180" : /led/i.test(need.title) ? "95" : "12")
      : (/floor|tile/i.test(need.title) ? "190" : /pendant/i.test(need.title) ? "950" : /sofa|bed|console/i.test(need.title) ? "8000" : /chair|worktop|sink/i.test(need.title) ? "400" : "45");
    const tag = ctx.s.key.toUpperCase().replace(/[^A-Z0-9]+/g, "");
    let firstId = "";
    for (const [index, plan] of ctx.s.execution.orders.entries()) {
      const supplier = usable[plan.supplier % usable.length];
      const pick = (need: { title: string; source: string }) => plan.pick === "materials" ? need.source === "material" : need.source !== "material" && plan.pick.test(need.title);
      const id = await this.order(ctx, projectId, plan, `${plan.label} to ${supplier.name}`, supplier, pick, price,
        { supplierReference: `SO-${tag}-${1201 + index * 17}`, deliveryNote: `DN-${tag}-${4471 + index * 31}`, notes: `${plan.label[0].toUpperCase()}${plan.label.slice(1)} for ${ctx.s.title} (showcase).` }, needs);
      firstId ||= id;
    }
    return firstId;
  }

  private async order(ctx: Ctx, projectId: string, plan: Order, label: string, supplier: { id: string; name: string }, pick: (need: { title: string; source: string }) => boolean,
    price: (need: { title: string; source: string }) => string, detail: { supplierReference: string; deliveryNote: string; notes: string },
    needs: () => Promise<Array<{ title: string; source: string; sourceId: string; remaining: string | null; blocked: string | null }>>) {
    const orders = this.get(OrdersService), receiving = this.get(ReceivingService);
    const key = plan.key;
    const buyer = await this.as("buyer");
    const orderId = this.id(ctx, `purchase-order:${key}`);
    const get = async () => { try { return (await orders.get(buyer, this.w, orderId)) as unknown as { order: Any; lines: Any[]; receipts?: Any[] }; } catch { return null; } };
    // Nothing left for this order (an earlier one covered it): nothing to do.
    if (!(await get()) && !(await needs()).some((need) => pick(need) && Number(need.remaining ?? 0) > 0)) { this.kept(`${key} · nothing left to order`); return ""; }
    let order = await this.step(`purchase order · ${label}`, get, async () => {
      const mine = (await needs()).filter((need) => pick(need) && Number(need.remaining ?? 0) > 0);
      if (!mine.length) throw new Skip(`nothing left to order for ${key}`);
      const blocked = mine.find((need) => need.blocked);
      if (blocked) throw new Skip(`purchasing is blocked: ${blocked.blocked}`);
      const lines = mine.map((need) => ({ source: need.source, ...(need.source === "material" ? { materialItemId: need.sourceId } : { boqLineId: need.sourceId }), quantity: need.remaining, unitPrice: price(need) }));
      await orders.create(buyer, this.w, { id: orderId, vendorId: supplier.id, expectedDate: dayFrom(plan.expected), notes: detail.notes, lines });
      return (await get())!;
    });
    const command = async (actor: Actor, action: string, extra: Record<string, unknown> = {}) => {
      const fresh = (await get())!;
      return orders.command(actor, this.w, orderId, { action, version: fresh.order.version, ...extra });
    };
    let status = order.order.status as string;
    if (status === "draft") { await this.advance(`${key} · submitted`, false, () => command(buyer, "submit")); order = (await get())!; status = order.order.status; }
    if (status === "pending_approval") {
      const approver = await this.other(buyer, ["owner", "manager", "projectManager", "finance"]);
      await this.advance(`${key} · approved`, false, () => command(approver, "approve"));
      status = "approved";
    }
    if (status === "approved") { await this.advance(`${key} · sent to the supplier (no email)`, false, () => command(buyer, "send", { to: null })); status = "sent"; }
    if (status === "sent") { await this.advance(`${key} · supplier confirmation recorded`, false, () => command(buyer, "confirm", { promisedDate: dayFrom(plan.promised), supplierReference: detail.supplierReference })); status = "confirmed"; }
    if (!plan.receive) { this.kept(`${key} · waiting for the delivery`); return orderId; }
    order = (await get())!;
    const receiptId = this.id(ctx, `receipt:${key}`);
    await this.step(`${key} · delivery received at the factory`, async () => (order.receipts ?? []).find((row: Any) => row.id === receiptId) ?? null, async () => {
      const form = (await receiving.receiving(buyer, this.w, orderId)) as unknown as { defaultPlace: string; places: Array<{ key: string; kind: string }>; lines: Array<{ id: string; outstanding: string }> };
      const place = form.places.find((row) => row.kind === "factory")?.key ?? form.places.find((row) => row.kind === "store")?.key ?? form.defaultPlace;
      const lines = form.lines.filter((line) => Number(line.outstanding) > 0).map((line) => ({ orderLineId: line.id, received: line.outstanding }));
      if (!lines.length) throw new Skip("everything on the order has arrived");
      return receiving.receive(buyer, this.w, { id: receiptId, orderId, place, receivedOn: dayFrom(Math.min(plan.promised, 0)), deliveryNote: detail.deliveryNote, lines });
    });
    const inspector = await this.other(buyer, ["owner", "manager", "projectManager", "factory"]);
    const full = (await receiving.receipt(inspector, this.w, receiptId)) as unknown as { lines: Array<{ id: string; pending: string }> };
    await this.advance(`${key} · delivery inspected and accepted`, !full.lines.some((line) => Number(line.pending) > 0), () =>
      receiving.inspect(inspector, this.w, receiptId, { lines: full.lines.filter((line) => Number(line.pending) > 0).map((line) => ({ id: line.id, accepted: line.pending, rejected: "0" })) }));
    return orderId;
  }

  // ---------------------------------------------------------------- Factory

  private async factory(ctx: Ctx, projectId: string) {
    const { s } = ctx;
    const factory = this.get(FactoryService);
    const maker = await this.as("factory");
    const actor = await this.actor(this.input.actorUserId);
    const state = async () => (await factory.state(maker, this.w)) as unknown as { toMake: Array<{ lineId: string; projectId: string; title: string; left: string }>; orders: Array<{ id: string; boqLineId: string; projectId: string; status: string }>; workcenters: Array<{ id: string; name: string }> };
    let current = await state();
    let workcenter = current.workcenters.find((row) => /joinery/i.test(row.name)) ?? current.workcenters[0];
    if (!workcenter) {
      const id = this.id("", "workcenter:joinery");
      workcenter = await this.step("workcenter Joinery", async () => null, async () => {
        await factory.saveWorkcenter(actor, this.w, { id, name: "Joinery", hoursPerDay: "8" });
        current = await state();
        return current.workcenters.find((row) => row.id === id) ?? { id, name: "Joinery" };
      });
    } else this.kept(`workcenter ${workcenter.name}`);
    // One work order per line the factory makes; in the "in production" story only the first goes that far, the rest stay planned.
    const lines = current.toMake.filter((row) => row.projectId === projectId);
    if (!lines.length) {
      // A finished project no longer lists lines to make; its work orders are the record.
      const done = current.orders.filter((row) => row.projectId === projectId);
      if (done.length) { this.kept(`${done.length} factory work orders`); return done[0].id; }
      throw new Skip("the project has no factory line (package supply: make)");
    }
    let firstId = "";
    for (const [index, line] of lines.entries()) {
      // A work order already on the line (however it was planned) is the one taken forward.
      const orderId = current.orders.find((row) => row.boqLineId === line.lineId && row.status !== "cancelled")?.id ?? this.id(ctx, `work-order:${line.lineId}`);
      firstId ||= orderId;
      const short = line.title.split("·")[0].trim().toLowerCase();
      const get = async () => { try { return (await factory.order(maker, this.w, orderId)) as unknown as { order: Any; releaseChecks: Array<{ key: string; passed: boolean; missing: string }>; reports: Any[] }; } catch { return null; } };
      let order = await this.step(`factory work order · ${short}`, get, async () => {
        if (Number(line.left) <= 0) throw new Skip(`${short} is fully planned already`);
        await factory.plan(maker, this.w, { id: orderId, lineId: line.lineId, quantity: line.left, workcenterId: workcenter!.id, plannedStart: dayFrom(s.execution.factory === "done" ? -7 : -2), plannedEnd: dayFrom(s.execution.factory === "done" ? -1 : 6) });
        return (await get())!;
      });
      const command = async (who: Actor, action: string, extra: Record<string, unknown> = {}) => {
        const fresh = (await get())!;
        await factory.command(who, this.w, orderId, { action, version: fresh.order.version, ...extra });
      };
      let status = order.order.status as string;
      const finish = s.execution.factory === "done";
      if (!finish && index > 0) { this.kept(`${short} · planned`); continue; }
      if (status === "planned") {
        await this.advance(`${short} · drawing approved`, order.releaseChecks.some((check) => check.key === "drawing" && check.passed), () => command(maker, "approve_drawing", { reference: `${short.slice(0, 2).toUpperCase()}-${index + 1} rev B` }));
        order = (await get())!;
        const blocked = order.releaseChecks.filter((check) => !check.passed);
        if (blocked.length) { this.skip(`factory · ${short}`, `not releasable: ${blocked.map((check) => check.missing).join("; ")}`); continue; }
        await this.advance(`${short} · work order released`, false, () => command(maker, "release"));
        status = "released";
      }
      if (status === "released") { await this.advance(`${short} · production started`, false, () => command(maker, "start")); status = "in_production"; }
      if (!finish) { this.kept(`${short} · in production`); continue; }
      if (status === "in_production") {
        order = (await get())!;
        const reportId = this.id(ctx, `work-order:${line.lineId}:report-1`);
        const approver = await this.other(maker, ["owner", "manager", "projectManager"]);
        await this.advance(`${short} · output reported`, order.reports.some((report) => report.id === reportId), () => factory.command(maker, this.w, orderId, { action: "report", id: reportId, good: order.order.left ?? order.order.quantity, note: "Carcass and doors complete." }));
        order = (await get())!;
        const report = order.reports.find((row) => row.id === reportId);
        await this.advance(`${short} · output approved`, !report || report.status !== "pending", () => command(approver, "decide_report", { reportId, decision: "approve" }));
        order = (await get())!;
        await this.advance(`${short} · quality checked`, Number(order.order.toCheck ?? 0) <= 0, () => factory.command(approver, this.w, orderId, { action: "check", id: this.id(ctx, `work-order:${line.lineId}:check-1`), passed: order.order.toCheck }));
      } else if (["ready", "closed", "dispatched"].includes(status)) this.kept(`${short} · work order ${status}`);
    }
    return firstId;
  }

  // ---------------------------------------------------------------- Site

  private async site(ctx: Ctx, projectId: string) {
    const { s, rooms } = ctx;
    const site = this.get(SiteService), work = this.get(ProjectWorkService);
    const pm = await this.as("projectManager"), supervisor = await this.as("site");
    const state = async () => (await site.state(pm, this.w, projectId)) as unknown as { site: { startedOn: string | null }; reports: Array<{ id: string; version: number; status: string; photos?: unknown[] }> };
    let current = await state();
    await this.advance("site work started", Boolean(current.site.startedOn), () => site.command(pm, this.w, projectId, { action: "start_site", on: dayFrom(-(s.execution.siteStartDaysAgo ?? 0)) }));
    current = await state();
    const approver = await this.other(supervisor, ["projectManager", "owner", "manager"]);
    const notes = [
      "Carcasses installed; first coat of paint on the walls.",
      "Second coat of paint; electrical points tested.",
      "Doors hung and aligned; site cleaned for the client's visit.",
    ];
    for (let day = 1; day <= s.execution.reports; day += 1) {
      const reportId = this.id(ctx, `site-report:${day}`);
      let report = current.reports.find((row) => row.id === reportId);
      if (!report) {
        await this.step(`daily site report ${dayFrom(-day)} with a photo`, async () => null, async () => {
          await site.command(supervisor, this.w, projectId, { id: reportId, action: "save_report", reportDate: dayFrom(-day), weather: day % 2 ? "Clear" : "Hazy", workforce: [{ trade: "Carpenters", people: 3 }, { trade: "Painters", people: 2 }],
            notes: notes[(day - 1) % notes.length], lines: [] });
          await site.uploadPhoto(supervisor, this.w, projectId, reportId, this.id(ctx, `site-report:${day}:photo`), tile(`${s.key}-site-${day}`) as never);
          current = await state();
          return current.reports.find((row) => row.id === reportId)!;
        });
        report = current.reports.find((row) => row.id === reportId);
      } else this.kept(`daily site report ${dayFrom(-day)}`);
      if (report && report.status === "draft") { await this.advance(`site report ${dayFrom(-day)} submitted`, false, () => site.command(supervisor, this.w, projectId, { action: "submit", reportId, version: report!.version })); current = await state(); report = current.reports.find((row) => row.id === reportId); }
      if (report && report.status === "submitted") await this.advance(`site report ${dayFrom(-day)} approved`, false, () => site.command(approver, this.w, projectId, { action: "approve", reportId, version: report!.version }));
    }
    // Snags found on site: some fixed and closed with a photo after, some still open.
    const board = async () => ((await work.board(pm, this.w, projectId)) as { items: Array<{ id: string; version: number; status: string }> }).items;
    for (const item of s.execution.snags) {
      const snagId = this.id(ctx, item.key);
      let snag = (await board()).find((row) => row.id === snagId);
      if (!snag) {
        await this.step(`snag · ${item.title}`, async () => null, async () => {
          await work.command(pm, this.w, projectId, { action: "create", id: snagId, type: "snag", title: item.title, severity: item.severity, source: item.source,
            areaId: rooms.get(item.room) ?? null, assigneeId: supervisor.membershipId, dueDate: dayFrom(item.close ? 2 : 3) });
          return (await board()).find((row) => row.id === snagId)!;
        });
        snag = (await board()).find((row) => row.id === snagId);
      } else this.kept(`snag · ${item.title}`);
      if (!item.close) { if (snag && snag.status !== "done") this.kept(`snag open · ${item.title}`); continue; }
      if (snag && snag.status === "todo") { await this.advance("snag fixed (in review)", false, () => work.command(supervisor, this.w, projectId, { action: "update", itemId: snagId, version: snag!.version, status: "in_review" })); snag = (await board()).find((row) => row.id === snagId); }
      if (snag && snag.status === "in_review") {
        const detail = (await work.item(pm, this.w, projectId, snagId)) as unknown as { photos?: Array<{ kind: string }> };
        await this.advance("snag photo after", (detail.photos ?? []).some((photo) => photo.kind === "after"), () => work.uploadPhoto(supervisor, this.w, projectId, snagId, this.id(ctx, `${item.key}:after`), "after", tile(`${s.key}-${item.key}-after`) as never));
        snag = (await board()).find((row) => row.id === snagId);
        // Someone other than who fixed it closes a snag: the project manager, or the owner when they are the same person.
        const closer = pm.userId === supervisor.userId ? await this.other(supervisor, ["projectManager", "owner", "manager"]) : pm;
        await this.advance("snag closed by the project manager", false, () => work.command(closer, this.w, projectId, { action: "update", itemId: snagId, version: snag!.version, status: "done" }));
      } else if (snag?.status === "done") this.kept("snag closed");
    }
  }

  /** Stages move forward while their checks pass, up to the stage the story leaves current. */
  private async stages(ctx: Ctx, projectId: string) {
    const projects = this.get(ProjectCoreService);
    const pm = await this.as("projectManager");
    const until = ctx.s.execution.stagesUntil;
    for (let guard = 0; guard < 20; guard += 1) {
      const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number; status: string }; stages: Array<{ id: string; key: string; status: string; checks: Array<{ key: string; kind: string; passed: boolean }> }> };
      const stage = detail.stages.find((row) => row.status === "current");
      if (!stage || detail.project.status !== "active") return;
      if (until && stage.key === until) { this.kept(`project at stage "${stage.key}"`); return; }
      for (const check of stage.checks.filter((row) => row.kind === "confirm" && !row.passed)) {
        const fresh = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number } };
        await this.advance(`stage ${stage.key} · ${check.key} confirmed`, false, () => projects.command(pm, this.w, projectId, { action: "confirm_check", stageId: stage.id, checkKey: check.key, version: fresh.project.version }));
      }
      const after = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number }; stages: Array<{ id: string; checks: Array<{ passed: boolean; key: string }> }> };
      const ready = after.stages.find((row) => row.id === stage.id)!;
      if (!ready.checks.every((check) => check.passed)) { this.log(`  note     project stays at "${stage.key}": ${ready.checks.filter((check) => !check.passed).map((check) => check.key).join(", ")}`); return; }
      await this.advance(`stage ${stage.key} completed`, false, () => projects.command(pm, this.w, projectId, { action: "complete_stage", stageId: stage.id, version: after.project.version }));
    }
  }

  // ---------------------------------------------------------------- Handover and warranty

  private async handover(ctx: Ctx, projectId: string, caseId: string) {
    const { s, rooms } = ctx;
    const handover = this.get(HandoverService), warranty = this.get(WarrantyService);
    const pm = await this.as("projectManager");
    const packId = this.id(ctx, `handover:${s.key}`);
    const state = async () => (await handover.state(pm, this.w, projectId)) as unknown as { packs: Array<{ id: string; status: string; version: number; documents: unknown[] }> };
    let current = await state();
    let pack = current.packs.find((row) => row.id === packId);
    if (!pack) {
      await this.step(`handover pack · ${s.title}`, async () => null, async () => {
        await handover.command(pm, this.w, projectId, { action: "create_pack", id: packId, title: `${s.title} handover`, areaIds: [...rooms.values()] });
        current = await state();
        return current.packs.find((row) => row.id === packId)!;
      });
      pack = current.packs.find((row) => row.id === packId);
    } else this.kept(`handover pack · ${s.title}`);
    if (!pack) return;
    if (pack.status === "draft") {
      await this.advance("warranty document attached", pack.documents.length > 0, async () => {
        const pdf = Buffer.from("%PDF-1.4\n% Joinery and furniture warranty (showcase)\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
        await handover.uploadDocument(pm, this.w, projectId, packId, this.id(ctx, `handover:${s.key}:warranty`), { kind: "warranty", title: "Joinery and furniture warranty" },
          { buffer: pdf, originalname: "warranty.pdf", mimetype: "application/pdf", size: pdf.length } as never);
      });
      current = await state();
      pack = current.packs.find((row) => row.id === packId)!;
      await this.advance("handover pack issued to the client", false, async () => {
        try { await handover.command(pm, this.w, projectId, { action: "issue", packId, version: pack!.version }); } catch (error) {
          if (!(error instanceof HttpException) || error.getStatus() !== 409) throw error;
          // Stages still run: the manager confirms the handover goes ahead with what's open.
          await handover.command(pm, this.w, projectId, { action: "issue", packId, version: pack!.version, confirmOpen: true, openReason: "Showcase handover; remaining stages are administrative." });
        }
      });
      current = await state();
      pack = current.packs.find((row) => row.id === packId)!;
    }
    if (pack.status === "issued") {
      await this.advance("handover accepted by the client in the portal", false, async () => {
        const view = await this.portalView(ctx);
        const project = view.projects.find((row) => row.id === caseId);
        const open = project?.decisions?.handovers?.find((row: Any) => row.id === packId && row.canDecide);
        if (!open) throw new Skip("the handover is not open for the client's decision in the portal");
        await this.portalDecision(ctx, "handover_decision", `handover:${caseId}:${packId}:accept`, { caseId, packId, decision: "accept", outstanding: [] });
      });
    } else if (pack.status === "accepted") this.kept("handover accepted by the client");
    const cover = (await warranty.state(pm, this.w, projectId)) as unknown as { items: Array<{ title: string; startsOn: string; endsOn: string }> };
    if (cover.items.length) this.log(`  note     warranty runs on ${cover.items.length} items from ${cover.items[0].startsOn} to ${cover.items[0].endsOn}`);
    else this.skip("warranty", "no warranty items started (the handover is not accepted)");
  }

  // ---------------------------------------------------------------- Enquiries across the pipeline

  private async enquiries() {
    const leads = this.get(CrmLeadsService);
    for (const enquiry of ENQUIRIES) {
      const reference = `SHOWCASE-${enquiry.key.toUpperCase()}`;
      await this.stage(`enquiries · ${reference}`, async () => {
        const owner = await this.as(enquiry.owner);
        const lead = await this.intake(enquiry.key, reference, enquiry, { title: enquiry.title, summary: enquiry.summary, area: enquiry.area, daysAgo: enquiry.daysAgo, owner: enquiry.owner, pick: enquiry.pick });
        const current = (await leads.get(owner, this.w, lead.id)) as unknown as { status: string; version: number };
        if (enquiry.outcome === "new" || enquiry.outcome === null) { this.kept(`${reference} · new`); return; }
        if (enquiry.outcome === "qualified") {
          if (current.status === "qualified") { this.kept(`${reference} · qualified`); return; }
          await this.qualify(lead.id, lead.partyId, owner, { title: enquiry.title, summary: enquiry.summary, amount: enquiry.amount, daysAgo: enquiry.daysAgo });
          return;
        }
        const contact = enquiry.outcome;
        const followUp = contact.followUp ? dateAt(contact.followUp.days, contact.followUp.hour).toISOString() : undefined;
        if (current.status === "new") {
          await this.advance(`${reference} · ${contact.channel} logged (${contact.outcome.replace(/_/g, " ")})`, false, async () =>
            this.tryAs(owner, async (actor) => leads.logContact(actor, this.w, lead.id, await this.validated(LogContactDto, {
              version: current.version, channel: contact.channel, outcome: contact.outcome, note: contact.note, ...(contact.reason ? { reason: contact.reason } : {}), ...(followUp ? { nextActionAt: followUp } : {}),
            }))));
        } else this.kept(`${reference} · ${current.status}`);
        // The follow-up is a task on the enquiry, its next action, so it shows in Today and the overdue list.
        if (followUp && current.status !== "disqualified") await this.followUp(lead.id, lead.partyId, owner, `Follow up with ${enquiry.displayName}`, followUp);
      });
    }
  }

  /** A pending follow-up task on the lead, due at the given time, marked as its next action (found again by title). */
  private async followUp(leadId: string, partyId: string, owner: Actor, title: string, dueAt: string) {
    const { CrmActivitiesService } = await import("../crm/activities/crm-activities.service");
    const { CreateActivityDto } = await import("../crm/activities/dto/activities.dto");
    const activities = this.get(CrmActivitiesService);
    const find = async () => {
      const list = (await activities.list(owner, this.w, { leadId, limit: 100 } as never)) as unknown as { data: Array<{ id: string; title: string; status: string }> };
      return list.data.find((row) => row.title === title && row.status === "pending") ?? null;
    };
    await this.step(`follow-up task · ${title} (${dueAt.slice(0, 10)})`, find, async () =>
      this.tryAs(owner, async (actor) => activities.create(actor, this.w, await this.validated(CreateActivityDto, {
        leadId, partyId, type: "task", title, description: "Call back and book the showroom visit.", ...(owner.membershipId ? { ownerMembershipId: owner.membershipId } : {}), priority: "normal", dueAt, isNextAction: true,
      }))));
  }
}

// ---------------------------------------------------------------- helpers

/** An error as a person reads it: the API message, not a stack. */
function describe(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message = typeof response === "string" ? response : (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join("; ") : message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

/** A calendar date `days` from today (negative: in the past). */
function dayFrom(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A moment `days` from today at the given hour (local to the process; enough for a follow-up). */
function dateAt(days: number, hour: number) {
  const at = new Date(Date.now() + days * 86_400_000);
  at.setHours(hour, 0, 0, 0);
  return at;
}

/** A small, valid PNG for demonstration pictures (the seed carries no camera): a 64×64 tile whose colour comes from its label. */
function tile(label: string): Upload {
  const size = 64;
  const seed = createHash("sha1").update(label).digest();
  const [r, g, b] = [150 + (seed[0] % 80), 140 + (seed[1] % 80), 130 + (seed[2] % 80)];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const shade = (x >> 3) % 2 === (y >> 3) % 2 ? 0 : 18;
      const at = y * (size * 3 + 1) + 1 + x * 3;
      raw[at] = r - shade; raw[at + 1] = g - shade; raw[at + 2] = b - shade;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { buffer: png, originalname: `${label}.png`, mimetype: "image/png", size: png.length };
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
