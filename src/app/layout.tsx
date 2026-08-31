import type { ReactNode } from "react";
import "./global.css";

export const metadata = {
  title: "İş Zekâsı Ajanı",
  description: "Veriyi getirmekle kalmaz, nedenini de arar.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
