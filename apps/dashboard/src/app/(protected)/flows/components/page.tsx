import type { Metadata } from "next";
import { ComponentsPage } from "@/features/flows/ComponentsPage";
export const metadata: Metadata = { title: "Components · Flows · SuperBoard" };
export default function Page() {
  return <ComponentsPage />;
}
