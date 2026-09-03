import type { ReactNode } from "react";
import "./widget.css";

export const metadata = {
  title: "İş Zekâsı Ajanı",
  // Widget bir iframe içinde yaşıyor; arama motorlarında görünmesinin
  // anlamı yok.
  robots: { index: false, follow: false },
};

export default function WidgetLayout({ children }: { children: ReactNode }) {
  return children;
}
