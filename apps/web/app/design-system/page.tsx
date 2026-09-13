import type { Metadata } from "next";
import { DesignSystemShowcase } from "./showcase";

export const metadata: Metadata = {
  title: "Design system · Wodana",
  description: "Accessible foundations, components, patterns, and domain UI for the Wodana workspace.",
};

export default function DesignSystemPage() {
  return <DesignSystemShowcase />;
}
