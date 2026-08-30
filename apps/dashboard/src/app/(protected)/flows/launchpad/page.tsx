import type { Metadata } from "next";
import { LaunchpadPage } from "@/features/flows/LaunchpadPage";
export const metadata: Metadata = { title: "Launchpad · Flows · SuperBoard" };
export default function Page() {
  return <LaunchpadPage />;
}
