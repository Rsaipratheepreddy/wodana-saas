import { redirect } from "next/navigation";

export default function UserSettingsPage() {
  redirect("/workspace/settings/security");
}
