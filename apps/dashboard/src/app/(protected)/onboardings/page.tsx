import type { Metadata } from "next";
import { OnboardingsPage } from "@/components/modules/OnboardingPages";

export const metadata: Metadata = { title: "Onboardings · OpenGrow" };

export default function Page() {
  return <OnboardingsPage />;
}
