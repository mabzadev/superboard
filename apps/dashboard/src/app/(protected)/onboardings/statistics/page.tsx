import type { Metadata } from "next";
import { OnboardingStatisticsPage } from "@/components/modules/OnboardingPages";

export const metadata: Metadata = {
  title: "Onboarding statistics · SuperBoard",
};

export default function Page() {
  return <OnboardingStatisticsPage />;
}
