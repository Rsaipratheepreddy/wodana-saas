import type { Tour } from "./types";

// Woddy's scripted tours. Together they follow one client's journey the way a person demos the product:
// the first call, the brief and the proposal, the project, the materials and what the client sees.
// Each tour opens with a short intro, makes one point per step and ends with a recap.
// - Narration is the English text, used as the i18n key (en.json).
// - `{client}` and `{project}` are read from the screen (the first real record); `{name}` is the viewer.
// - `voice` is the same line without names, recorded once as audio (see scripts/tours-script.mjs).
// - Targets are `data-tour` attributes only, never classes.
// Plain data with type-only imports, so the `scripts/tours-*.mjs` scripts can read it with Node directly.

export const tours: Tour[] = [
  {
    id: "home",
    title: "Home at a glance",
    screens: ["/workspace", "/workspace/home/*"],
    next: "enquiry-to-opportunity",
    steps: [
      {
        id: "intro",
        route: "/workspace",
        action: "wait",
        woddy: "hello",
        narration: "Hi {name}! In about two minutes I'll show you how a working day starts in Wodana. Sit back: I'll do the clicking, and nothing gets changed.",
        voice: "Hi there! In about two minutes I'll show you how a working day starts in Wodana. Sit back: I'll do the clicking, and nothing gets changed.",
      },
      {
        id: "attention",
        target: "home-widget-attention",
        action: "point",
        woddy: "thinking",
        narration: "Needs attention is your list for today: follow-ups that are due and clients waiting for a reply. Work from the top, and nobody is left waiting for a call back.",
      },
      {
        id: "sales",
        target: "nav-sales",
        action: "point",
        woddy: "working",
        narration: "Every new client starts in Sales. Calls, WhatsApp messages and website forms all land in one list, so nothing slips through.",
      },
      {
        id: "projects",
        target: "nav-projects",
        action: "point",
        woddy: "working",
        narration: "Once a client signs, the job moves to Projects, where the team plans the work and keeps an eye on every payment.",
      },
      {
        id: "ask-woddy",
        target: "woddy-menu",
        action: "point",
        woddy: "hello",
        narration: "Whenever you're unsure, ask me here. I can explain the screen you're on, or walk you through a whole flow like this one.",
      },
      {
        id: "edit-home",
        target: "home-edit",
        action: "point",
        woddy: "hello",
        narration: "And Home is yours to shape. Edit Home lets each person choose the widgets they care about, so an owner and a site supervisor each see their own day.",
      },
      {
        id: "recap",
        action: "wait",
        woddy: "celebrating",
        narration: "So in short: Home shows what needs you today, the menu follows the work from enquiry to handover, and I'm always one click away. Next, let's follow a real enquiry.",
      },
    ],
  },
  {
    id: "enquiry-to-opportunity",
    title: "From enquiry to opportunity",
    screens: ["/workspace/crm", "/workspace/crm/leads"],
    examples: [{ key: "client", source: "enquiry-customer", fallback: "our client" }],
    next: "quote-to-proposal",
    steps: [
      {
        id: "intro",
        route: "/workspace/crm/leads",
        target: "enquiry-list",
        action: "wait",
        woddy: "hello",
        narration: "Let's follow one client from the very first call. Say {client} gets in touch about their home: in about two minutes you'll see how that call becomes a real sales opportunity.",
        voice: "Let's follow one client from the very first call. Say a client gets in touch about their villa: in about two minutes you'll see how that call becomes a real sales opportunity.",
      },
      {
        id: "enquiries",
        target: "sales-tab-leads",
        action: "point",
        woddy: "thinking",
        narration: "Every call, WhatsApp message and website form lands here in Enquiries, so the whole team works from one list instead of scattered notes.",
      },
      {
        id: "client",
        target: "enquiry-customer",
        action: "point",
        woddy: "working",
        narration: "Here's {client}. At a glance you can see where they found you, what they need and who is following up.",
        voice: "Here's our client. At a glance you can see where they found you, what they need and who is following up.",
      },
      {
        id: "open",
        target: "enquiry-customer",
        action: "click",
        waitFor: "enquiry-detail",
        woddy: "working",
        narration: "Let's open the enquiry. Everything about the job lives in one place, so nobody has to ask the client the same question twice.",
      },
      {
        id: "details",
        target: "enquiry-properties",
        action: "point",
        woddy: "thinking",
        narration: "The stage, the owner and the next follow-up sit right at the top. If a follow-up is missing, that's the first thing to fix.",
      },
      {
        id: "next-step",
        target: "enquiry-next-step",
        action: "point",
        woddy: "thinking",
        narration: "This bar always shows the next move. Once the requirements are clear, the enquiry is ready to become an opportunity.",
      },
      {
        id: "convert",
        target: "enquiry-convert",
        action: "click",
        waitFor: "convert-form",
        woddy: "working",
        narration: "Converting hands {client} to the sales pipeline. Wodana asks only for what it needs: a name for the job, the sales owner, the next follow-up and an estimated value.",
        voice: "Converting hands the client to the sales pipeline. Wodana asks only for what it needs: a name for the job, the sales owner, the next follow-up and an estimated value.",
      },
      {
        id: "convert-fields",
        target: "convert-form",
        action: "point",
        woddy: "hello",
        narration: "The owner and the follow-up date matter most: they make sure somebody calls back on time. This is a demo, so I'll close it without saving.",
      },
      {
        id: "recap",
        action: "wait",
        woddy: "celebrating",
        narration: "So in short: every enquiry lands in one list, the details stay with the enquiry, and converting gives it an owner and a next step. Next, let's see how the quote comes together.",
      },
    ],
  },
  {
    id: "quote-to-proposal",
    title: "From brief to proposal",
    screens: ["/workspace/pre-projects", "/workspace/pre-projects/cases/*/*"],
    examples: [{ key: "project", source: "case-open", fallback: "one job" }],
    next: "project",
    steps: [
      {
        id: "intro",
        route: "/workspace/pre-projects",
        target: "planning-list",
        action: "wait",
        woddy: "hello",
        narration: "Once a client is serious, the job moves into Planning. In about three minutes I'll take {project} from the brief to a proposal the client can sign.",
        voice: "Once a client is serious, the job moves into Planning. In about three minutes I'll take one villa from the brief to a proposal the client can sign.",
      },
      {
        id: "open-case",
        target: "case-open",
        action: "open",
        woddy: "working",
        narration: "Let's open {project}. Each case keeps the brief, the site, the designs and the quotes together, in the order the work happens.",
        voice: "Let's open the case. It keeps the brief, the site, the designs and the quotes together, in the order the work happens.",
      },
      {
        id: "requirements",
        target: "case-tab-requirements",
        action: "open",
        waitFor: "page-content",
        woddy: "thinking",
        narration: "Requirements is the brief: every room and every wish in the client's own words, so the designer and the estimator start from the same page.",
      },
      {
        id: "site",
        target: "case-tab-site",
        action: "open",
        waitFor: "page-content",
        woddy: "working",
        narration: "Site holds the measurements and photos from the visit, so nobody prices a wardrobe for a wall they haven't measured.",
      },
      {
        id: "design",
        target: "case-tab-design",
        action: "open",
        waitFor: "page-content",
        woddy: "working",
        narration: "Design keeps the layouts and 3D views, with the client's approval on each one, so there's no debate later about what was agreed.",
      },
      {
        id: "quotes",
        target: "case-tab-quotes",
        action: "open",
        waitFor: "page-content",
        woddy: "thinking",
        narration: "And Quotes is where it all turns into a price. Let's open the quote.",
      },
      {
        id: "items",
        target: "quote-open",
        action: "open",
        waitFor: "quote-grid",
        woddy: "working",
        narration: "Every line comes from your catalog, grouped by room, so prices stay consistent from one quote to the next.",
      },
      {
        id: "new-line",
        target: "quote-new-line",
        action: "type",
        value: "Wardrobe",
        waitFor: "quote-line-input",
        woddy: "working",
        narration: "Adding a line is quick: start typing, and Wodana suggests the matching catalog item with its price. I'm only showing you, so this line won't be kept.",
      },
      {
        id: "terms",
        target: "quote-tab-terms",
        action: "click",
        woddy: "thinking",
        narration: "Terms holds what's included, what isn't, and how long the price is valid, so the proposal answers questions before they're asked.",
      },
      {
        id: "payments",
        target: "quote-tab-payments",
        action: "click",
        woddy: "thinking",
        narration: "Payments splits the total into milestones, like a deposit, a payment before carpentry and one at handover, so nobody has to chase the client for money later.",
      },
      {
        id: "document",
        target: "quote-tab-document",
        action: "click",
        waitFor: "quote-proposal",
        woddy: "working",
        narration: "Document is the proposal exactly as the client will see it, with your branding, the rooms and the payment plan.",
      },
      {
        id: "send",
        target: "quote-send",
        action: "point",
        woddy: "hello",
        narration: "When it's ready, Send for review passes it to a manager to check before it goes to the client. I'll leave that button for you.",
      },
      {
        id: "recap",
        action: "wait",
        woddy: "celebrating",
        narration: "So in short: the brief, the site and the designs feed one quote, and the quote becomes a branded proposal with a clear payment plan. Next, let's see what happens when the client signs.",
      },
    ],
  },
  {
    id: "project",
    title: "Running a project",
    screens: ["/workspace/projects/*", "/workspace/projects/*/*"],
    examples: [{ key: "project", source: "project-open", fallback: "this project" }],
    next: "purchasing",
    steps: [
      {
        id: "intro",
        route: "/workspace/projects",
        target: "project-list",
        action: "wait",
        woddy: "hello",
        narration: "When the client signs, the quote becomes a project. In about two minutes I'll show you how {project} is run, from the first stage to the handover.",
        voice: "When the client signs, the quote becomes a project. In about two minutes I'll show you how a project is run, from the first stage to the handover.",
      },
      {
        id: "open",
        target: "project-open",
        action: "open",
        waitFor: "project-properties",
        woddy: "working",
        narration: "Let's open {project}. The stage, the progress, the team and the agreed value sit right at the top.",
        voice: "Let's open the project. The stage, the progress, the team and the agreed value sit right at the top.",
      },
      {
        id: "stages",
        target: "project-tab-overview",
        action: "point",
        waitFor: "page-content",
        woddy: "thinking",
        narration: "The overview walks through the stages, from design to handover. Each stage has a short checklist, so the team always knows what finishes it.",
      },
      {
        id: "plan",
        target: "project-tab-plan",
        action: "click",
        waitFor: "page-content",
        woddy: "working",
        narration: "Plan is the task board. Work, site visits and snags are given to people with dates, so the site and the office see the same list.",
      },
      {
        id: "money",
        target: "project-tab-money",
        action: "click",
        waitFor: "page-content",
        woddy: "thinking",
        narration: "Money compares what the client has paid with what the job has spent. If spending runs ahead of payments, you'll know before the project starts losing money.",
      },
      {
        id: "site",
        target: "project-tab-site",
        action: "click",
        waitFor: "page-content",
        woddy: "working",
        narration: "Site collects the daily reports and photos from the team, so a client's question gets answered with a picture instead of a phone call.",
      },
      {
        id: "handover",
        target: "project-tab-handover",
        action: "click",
        waitFor: "page-content",
        woddy: "working",
        narration: "And Handover gathers the final checks, the documents and the warranty, so the keys go over with everything in order.",
      },
      {
        id: "recap",
        action: "wait",
        woddy: "celebrating",
        narration: "So in short: one project page holds the stages, the tasks, the money and the handover. Next, let's see how the materials get ordered.",
      },
    ],
  },
  {
    id: "purchasing",
    title: "Ordering materials",
    screens: ["/workspace/purchasing", "/workspace/purchasing/*"],
    next: "client-portal",
    steps: [
      {
        id: "intro",
        route: "/workspace/purchasing",
        target: "purchasing-to-order",
        action: "wait",
        woddy: "hello",
        narration: "Once a design is approved, the materials need ordering. In about two minutes I'll show you how nothing gets forgotten, or ordered twice.",
      },
      {
        id: "to-order",
        target: "purchasing-tab-to-order",
        action: "point",
        waitFor: "purchasing-to-order",
        woddy: "thinking",
        narration: "To order lists every material the projects still need, how much is left to order and when the site needs it, so nobody orders from memory.",
      },
      {
        id: "orders",
        target: "purchasing-tab-orders",
        action: "click",
        waitFor: "page-content",
        woddy: "working",
        narration: "Orders are the purchase orders sent to suppliers. Each one shows its status, so you can see what's confirmed and what's still waiting.",
      },
      {
        id: "order",
        target: "order-row",
        action: "click",
        waitFor: "order-detail",
        woddy: "working",
        narration: "Opening an order shows the items, the supplier and the delivery details in one place, with approval for the bigger amounts.",
      },
      {
        id: "deliveries",
        target: "purchasing-tab-deliveries",
        action: "click",
        waitFor: "page-content",
        woddy: "working",
        narration: "Deliveries tracks what's expected and what has arrived. Each delivery is checked against its order, so short or damaged items are caught at the door.",
      },
      {
        id: "suppliers",
        target: "purchasing-tab-suppliers",
        action: "click",
        waitFor: "page-content",
        woddy: "thinking",
        narration: "And Suppliers keeps every vendor with their prices and contacts, so the next order is quicker than the last.",
      },
      {
        id: "recap",
        action: "wait",
        woddy: "celebrating",
        narration: "So in short: the needs come from the projects, the orders go to suppliers, and deliveries are checked on arrival. Next, let's see what the client sees.",
      },
    ],
  },
  {
    id: "client-portal",
    title: "What the client sees",
    screens: ["/workspace/projects/*/updates"],
    examples: [{ key: "project", source: "project-open", fallback: "a project" }],
    steps: [
      {
        id: "intro",
        route: "/workspace/projects",
        target: "project-list",
        action: "wait",
        woddy: "hello",
        narration: "Clients love knowing where things stand. In about a minute I'll show you how they follow their project without having to call you.",
      },
      {
        id: "open",
        target: "project-open",
        action: "open",
        waitFor: "project-properties",
        woddy: "working",
        narration: "Let's open {project} and look at it the way the client will.",
        voice: "Let's open a project and look at it the way the client will.",
      },
      {
        id: "updates",
        target: "project-tab-updates",
        action: "click",
        waitFor: "portal-control",
        woddy: "working",
        narration: "Updates is where the team shares progress with the client. The client portal switch sits right at the top.",
      },
      {
        id: "manage",
        target: "portal-manage",
        action: "click",
        waitFor: "portal-sections",
        woddy: "thinking",
        narration: "Here you choose exactly what the client sees: the progress, the decisions waiting for them, the payments and the documents.",
      },
      {
        id: "sections",
        target: "portal-sections",
        action: "point",
        woddy: "hello",
        narration: "From their own portal they approve designs and quotes, pay milestones and download documents, on their phone and in their language. This is a demo, so I'll close it without saving.",
      },
      {
        id: "recap",
        action: "wait",
        woddy: "celebrating",
        narration: "So in short: clients see what you choose, when you choose, and fewer calls come in asking for news. That's the whole journey, from the first call to the handover.",
      },
    ],
  },
];

export function tourById(id: string | null | undefined): Tour | undefined {
  return tours.find((tour) => tour.id === id);
}

function patternMatches(pattern: string, path: string): boolean {
  const source = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+");
  return new RegExp(`^${source}/?$`).test(path);
}

/** The tour that explains this screen: the most specific pattern that matches the path. */
export function tourForPath(path: string, available: Tour[] = tours): Tour | undefined {
  let best: { tour: Tour; score: number } | undefined;
  for (const tour of available) {
    for (const pattern of tour.screens) {
      if (!patternMatches(pattern, path)) continue;
      const score = pattern.replace(/\*/g, "").length;
      if (!best || score > best.score) best = { tour, score };
    }
  }
  return best?.tour;
}
