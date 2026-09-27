import { redirect } from "next/navigation";

/** The old Jobs list: the work is followed in Planning, then Projects. */
export default function JobsEntryPage() {
  redirect("/workspace/pre-projects");
}
