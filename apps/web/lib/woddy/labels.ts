import { tKey } from "@/lib/i18n/keys";

/**
 * The words Business Core puts on Woddy's cards (titles with {placeholders}, field labels, fixed values) and
 * the refusals it sends. The card translates each where it renders; listing them here keeps them in en.json
 * for the translation pass.
 */
export const WODDY_CARD_LABELS = [
  // Titles
  tKey("Create an enquiry for {name}"), tKey("Update {record}"), tKey("Log {kind} on {record}"), tKey("Follow up with {client}"),
  tKey("Assign 1 chat to {name}"), tKey("Assign {count} chats to {name}"), tKey("Assign 1 enquiry to {name}"), tKey("Assign {count} enquiries to {name}"),
  tKey("Resolve 1 chat"), tKey("Resolve {count} chats"), tKey("Reopen 1 chat"), tKey("Reopen {count} chats"), tKey("Snooze 1 chat"), tKey("Snooze {count} chats"),
  tKey("Mark 1 chat unresolved"), tKey("Mark {count} chats unresolved"),
  tKey("Label 1 chat"), tKey("Label {count} chats"), tKey("Convert {record} to an opportunity"), tKey("Move {record} to {stage}"),
  tKey("Add the task {title} to {record}"), tKey("Mark {record} done"), tKey("Comment on {record}"),
  // Field labels
  tKey("Client"), tKey("Existing client"), tKey("Mobile"), tKey("Email"), tKey("Enquiry type"), tKey("Region"), tKey("Area"), tKey("Source"), tKey("Owner"),
  tKey("Summary"), tKey("Chat"), tKey("With"), tKey("When"), tKey("Type"), tKey("Title"), tKey("On"), tKey("Details"), tKey("Outcome"), tKey("Assign to"),
  tKey("State"), tKey("Until"), tKey("Add"), tKey("Remove"), tKey("Enquiry"), tKey("Opportunity"), tKey("Pipeline"), tKey("Next follow-up"), tKey("Stage"),
  tKey("Task"), tKey("Project"), tKey("Due"), tKey("Assignee"), tKey("Priority"), tKey("Notes"), tKey("Status"), tKey("Budget"), tKey("Client type"),
  // Values
  tKey("Linked to this chat"), tKey("Routing decides"), tKey("You"), tKey("Unassigned"), tKey("Open"), tKey("Unresolved"), tKey("Snoozed"), tKey("Resolved"), tKey("Spam"), tKey("Pending"),
  tKey("Done"), tKey("Low"), tKey("Normal"), tKey("High"), tKey("Urgent"), tKey("To do"), tKey("In progress"), tKey("In review"), tKey("Cancelled"),
  tKey("Call"), tKey("Meeting"), tKey("Note"), tKey("WhatsApp"), tKey("SMS"), tKey("Other"), tKey("Record"), tKey("Quote"),
  // Refusals
  tKey("This suggestion expired. Ask Woddy again."), tKey("Only the person who asked Woddy can confirm or cancel this."), tKey("This card changed; reload it."),
  tKey("This action is already running."), tKey("Tick at least one item, or cancel."), tKey("Only items on the card can be confirmed."),
  tKey("This Woddy action was not found."), tKey("This action is no longer available."), tKey("The chat was linked to another enquiry meanwhile."),
];
