import type { Metadata } from "next";
import { PaywallsPage } from "@/components/modules/PaywallsPage";

export const metadata: Metadata = { title: "Paywalls · SuperBoard" };

export default function Page() {
  return <PaywallsPage />;
}
