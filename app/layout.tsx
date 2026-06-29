import type { ReactNode } from "react";

export const metadata = {
  title: "DXP Product Recommender",
  description: "Minimal Claude-managed agent that recommends products by intent",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem",
          background: "#0b0b0f",
          color: "#e8e8ea",
        }}
      >
        {children}
      </body>
    </html>
  );
}
