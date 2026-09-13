import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Stack } from "../primitives/layout";
import { Heading } from "../primitives/typography";
import { InteriorProjectFlow, MeasurementSummary, SnagList } from "../domain/interior";
import { ProcurementChain, ThreeWayMatch } from "../domain/finance";
import { ActivityFeed, NotificationInbox, PresenceBar, SharingControls } from "./activity";
import { AIResult, AutomationPreview } from "./ai";
import { IntegrationConnectionRow, SyncLog } from "./integrations";
import { ApprovalRow, TaskChecklist } from "./workflow";

function PatternGallery() {
  return <Stack gap={8}>
    <section><Heading size="sm">Interior lifecycle</Heading><InteriorProjectFlow current="technical" /></section>
    <section><Heading size="sm">Workflow and approvals</Heading><TaskChecklist items={[{ id: "1", title: "Client design approval", complete: true, assignee: "Diya Nair" }, { id: "2", title: "Production drawing review", complete: false, due: "Today" }]} /><ApprovalRow approver="Kabir Arora" description="Frozen scope and selling price" label="Approve BOQ baseline" /></section>
    <section><Heading size="sm">Procurement controls</Heading><ProcurementChain current="quotes" material="Oak veneer panels" quantity={48} unit="sheets" /><ThreeWayMatch bill={47} goodsReceived={46} purchaseOrder={48} /></section>
    <section><Heading size="sm">Integrations</Heading><IntegrationConnectionRow account="operations@palmlivingae.com" lastSync="4 min ago" name="Google Workspace" state="connected" /><SyncLog entries={[{ id: "1", occurredAt: "10:42", status: "success", summary: "Calendar sync complete" }, { id: "2", occurredAt: "10:45", status: "error", summary: "QuickBooks account needs attention", detail: "Token expired" }]} /></section>
    <section><Heading size="sm">Collaboration</Heading><PresenceBar people={["Diya Nair", "Kabir Arora"]} updatedAt="just now" /><ActivityFeed items={[{ id: "1", actor: "Diya Nair", action: "approved", target: "Kitchen concept", occurredAt: "4 minutes ago", kind: "approval" }, { id: "2", actor: "Kabir Arora", action: "mentioned you on", target: "Living room BOQ", occurredAt: "12 minutes ago", kind: "comment" }]} /><NotificationInbox items={[{ id: "1", title: "Drawing approved", description: "The kitchen joinery drawing can move to production.", occurredAt: "Now", read: false }]} /><SharingControls /><SnagList items={[{ id: "1", area: "Master bedroom", issue: "Realign wardrobe shutter", status: "open", assignee: "Kabir Arora", due: "5 Sep" }]} /><MeasurementSummary depth={600} height={2400} label="Wardrobe niche" width={3200} /></section>
    <section><Heading size="sm">Human-approved AI</Heading><AIResult confidence={92} rationale="The recommendation uses approved requirements and the current production schedule." title="Two schedule conflicts found">Move the veneer approval two days earlier to protect the production slot.</AIResult><AutomationPreview actions={["Create the task", "Assign Diya Nair", "Notify the production lead"]} summary="Wodana will prepare the corrective action, but nothing changes until you approve." /></section>
  </Stack>;
}

const meta = {
  title: "Design system/Product patterns",
  component: PatternGallery,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Reusable workflow, collaboration, integration, finance, interior-design, and human-approved AI patterns. They compose the same public primitives and inherit theme, density, locale, and direction." } } },
} satisfies Meta<typeof PatternGallery>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const RightToLeft: Story = { globals: { direction: "rtl" } };
export const Dark: Story = { globals: { theme: "dark" } };
export const HighContrast: Story = { globals: { theme: "high-contrast" } };
