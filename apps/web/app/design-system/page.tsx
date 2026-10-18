import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemShowcase } from "./showcase";

export const metadata: Metadata = {
  title: "Design system · Wodana",
  description: "Accessible foundations, components, patterns, and domain UI for the Wodana workspace.",
};

export default function DesignSystemPage() {
  // The component catalogue is an engineering reference, not a product route.
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystemShowcase />;
}
