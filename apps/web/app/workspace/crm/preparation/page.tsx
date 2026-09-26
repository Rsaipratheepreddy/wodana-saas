import { redirect } from "next/navigation";

/** Sales › Preparation merged into Planning: cases before their Deal File are Planning's "Before deal" stage. */
export default function SalesPreparationPage() {
  redirect("/workspace/pre-projects?stage=before_deal");
}
