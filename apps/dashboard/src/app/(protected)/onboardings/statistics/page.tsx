import type { Metadata } from "next";
import { OnboardingStatisticsPage } from "@/components/modules/OnboardingPages";

export const metadata: Metadata = {
  title: "Onboarding statistics · OpenGrow",
};

export default function Page() {
  return <OnboardingStatisticsPage />;
}
