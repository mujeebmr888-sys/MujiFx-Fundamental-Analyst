import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "MUJIFX Fundamental Analyst",
  description: "Institutional-style USD fundamental research — not a signal generator.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
