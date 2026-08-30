import type { Metadata } from "next";
import { EnvironmentsSettingsPage } from "@/features/flows/SettingsPages";
export const metadata: Metadata = {
  title: "Environments · Flows · SuperBoard",
};
export default function Page() {
  return <EnvironmentsSettingsPage />;
}
