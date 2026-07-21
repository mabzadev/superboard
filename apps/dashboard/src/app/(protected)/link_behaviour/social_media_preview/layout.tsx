
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Social Media Preview",
};

export default function SocialMediaPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
