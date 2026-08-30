import type { Metadata } from "next";
import { FlowsUsersPage } from "@/features/flows/UsersPage";
export const metadata: Metadata = { title: "Users · Flows · SuperBoard" };
export default function Page() {
  return <FlowsUsersPage />;
}
