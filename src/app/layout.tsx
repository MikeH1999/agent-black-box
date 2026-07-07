import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Black Box",
  description: "A Filecoin-backed trace capsule prototype for AI agents."
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
