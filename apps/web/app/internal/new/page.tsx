import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/internal/auth";
import { ProvisioningPage } from "./provisioning-page";

export const metadata: Metadata = { title: "Add customer · Wodana Control" };

export default async function NewCustomerPage() {
  if (!await getOperatorSession()) redirect("/internal/sign-in");
  return <ProvisioningPage />;
}
