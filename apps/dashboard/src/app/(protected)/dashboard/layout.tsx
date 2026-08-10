import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Cross-module OpenGrow project metrics and setup progress.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
