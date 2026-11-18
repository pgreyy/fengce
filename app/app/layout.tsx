import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Fengce", description: "Circuit policies for Safe on X Layer" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <b>Fengce</b>
          <a href="/">Catalog</a>
          <a href="/simulator">Simulator</a>
          <a href="/install">Install</a>
          <a href="/safe">Safe status</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
