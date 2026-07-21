
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IS_ENTERPRISE } from "@/lib/edition";

export const metadata: Metadata = {
  title: "Revenue",
};

export default function RevenueLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!IS_ENTERPRISE) {
    redirect("/dashboard");
  }

  return children;
}
