import type { Metadata } from "next";
import { FlowUserDetailsPage } from "@/features/flows/UserDetailsPage";
export const metadata: Metadata = {
  title: "User runtime · Flows · SuperBoard",
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FlowUserDetailsPage userHash={decodeURIComponent(id)} />;
}
