
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Android Setup",
};

export default function AndroidSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
