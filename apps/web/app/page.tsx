import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "Wodana — Beautiful spaces. Beautifully managed.",
  description: "Bring your interior business together. Manage leads, plan rooms, build quotations, and keep your team connected in one Wodana workspace.",
};

export default function Home() {
  return <LandingPage />;
}
