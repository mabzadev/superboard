import type { Metadata } from "next";
import { PaywallStatisticsPage } from "@/components/modules/PaywallsPage";

export const metadata: Metadata = { title: "Paywall statistics · SuperBoard" };

export default function Page() {
  return <PaywallStatisticsPage />;
}
