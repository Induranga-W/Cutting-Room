import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cutting Room — Automated Video Editor",
  description: "Upload clips, hand them to the bots, get a graded, captioned, platform-ready cut.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
