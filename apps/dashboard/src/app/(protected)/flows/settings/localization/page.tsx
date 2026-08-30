import type { Metadata } from "next";
import { LocalizationSettingsPage } from "@/features/flows/SettingsPages";
export const metadata: Metadata = {
  title: "Localization · Flows · SuperBoard",
};
export default function Page() {
  return <LocalizationSettingsPage />;
}
