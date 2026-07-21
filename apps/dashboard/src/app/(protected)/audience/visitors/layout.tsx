
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Visitors",
};

export default function VisitorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
