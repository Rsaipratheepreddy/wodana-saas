import { redirect } from "next/navigation";

/** The old address of a flow: each enquiry type now has its own steps, opened from Enquiry types. */
export default function Page() {
  redirect("/workspace/enquiry-types");
}
