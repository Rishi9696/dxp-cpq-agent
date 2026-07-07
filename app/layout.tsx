import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "DXP Product Recommender",
  description: "Minimal Claude-managed agent that recommends products by intent",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
