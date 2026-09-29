import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "QuoteOS", template: "%s · QuoteOS" },
  description: "Configurable quote generation and lead qualification for professional-service businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
