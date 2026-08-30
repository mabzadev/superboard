import type { Metadata } from "next";
import { SdkSettingsPage } from "@/features/flows/SettingsPages";
export const metadata: Metadata = { title: "SDK · Flows · SuperBoard" };
export default function Page() {
  return <SdkSettingsPage />;
}
