import { useState } from "react";
import { ArrowUpRight, Copy, Plus } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Button, ButtonGroup, MenuButton, SplitButton } from "./actions";
import { Checkbox, FieldStack, InputAction, SelectField, Switch, TextAreaField, TextInput } from "./forms";
import { Badge, Callout, EmptyState, Progress } from "./status";
import { Skeleton } from "./skeleton";
import { Heading } from "../primitives/typography";
import { Stack } from "../primitives/layout";
import { CharacterCount, DateTimeInput, DurationInput, EmailInput, MentionInput, OtpInput, PasswordInput, RecurrenceField, RichTextEditor, SignatureField, TimeZoneField } from "./advanced-forms";
import { EditableField, EditableFieldList } from "./editable-field";

function AdvancedFormExample() {
  const [otp, setOtp] = useState("");
  const [comment, setComment] = useState("");
  const [duration, setDuration] = useState(90);
  return <div style={{ maxWidth: 640 }}><FieldStack><EmailInput label="Email" placeholder="name@studio.com" /><PasswordInput label="Password" /><div><span className="wd-field-label">Verification code</span><OtpInput onChange={setOtp} value={otp} /></div><DurationInput label="Duration" onChange={setDuration} value={duration} /><DateTimeInput label="Review time" /><RecurrenceField /><TimeZoneField /><RichTextEditor label="Client brief" /><MentionInput onChange={setComment} people={[{ id: "diya", label: "Diya Nair" }, { id: "kabir", label: "Kabir Arora" }]} value={comment} /><CharacterCount max={500} value={comment} /><EditableFieldList><EditableField label="Space name" onSave={() => undefined} value="Living room" /></EditableFieldList><SignatureField label="Client signature" /></FieldStack></div>;
}

function FormExample() {
  const [website, setWebsite] = useState("wodana.com");
  return <div style={{ maxWidth: 560 }}><FieldStack><TextInput isRequired label="Full name" placeholder="Type your name" /><TextInput isRequired label="Website" onChange={setWebsite} prefix="https://" suffix={<InputAction aria-label="Copy website"><Copy aria-hidden="true" size={15} />Copy</InputAction>} value={website} /><TextInput inputType="email" isRequired label="Email" placeholder="Type your email address" /><Button size="large"><Plus aria-hidden="true" size={17} />Add another</Button><Button size="large" variant="gradient">Submit <ArrowUpRight aria-hidden="true" size={17} /></Button><SelectField items={[{ id: "new", label: "New" }, { id: "active", label: "Active" }]} label="Status" /><TextAreaField label="Notes" placeholder="Add context…" /><Checkbox>Include taxes</Checkbox><Switch>Client can view</Switch></FieldStack></div>;
}

const meta = {
  title: "Design system/Components",
  component: Button,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Accessible actions, fields, and feedback with compact Wodana styling. All controls support keyboard focus, disabled/loading states, theme, density, and RTL." } } },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
  render: () => <Stack gap={4}><ButtonGroup><Button variant="primary">Save changes</Button><Button>Preview</Button><Button variant="quiet">Cancel</Button><Button variant="danger">Delete</Button></ButtonGroup><ButtonGroup><Button isDisabled>Disabled</Button><Button isLoading>Saving</Button></ButtonGroup><SplitButton items={[{ id: "draft", label: "Save as draft" }, { id: "template", label: "Save as template" }]} label="Create invoice" /><MenuButton items={[{ id: "edit", label: "Edit" }, { id: "archive", label: "Archive", tone: "danger" }]} /></Stack>,
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.tab(); await expect(canvas.getByRole("button", { name: "Save changes" })).toHaveFocus(); },
};

export const Forms: Story = {
  render: () => <FormExample />,
};

export const Feedback: Story = {
  render: () => <Stack gap={4}><div><Heading size="sm">Status badges</Heading><Badge tone="success">Approved</Badge> <Badge tone="warning">Needs review</Badge> <Badge tone="danger">Blocked</Badge></div><Callout title="Approval required" tone="warning">The production order remains blocked until the technical drawing is approved.</Callout><Progress label="Project completion" value={68} /><Skeleton lines={3} /><EmptyState description="Adjust filters or create the first record." title="No records" /></Stack>,
};

export const AdvancedForms: Story = {
  render: () => <AdvancedFormExample />,
  parameters: { docs: { description: { story: "Internationalized scheduling, secure entry, rich text, mentions, inline editing, and signature primitives in the same compact property system." } } },
};
