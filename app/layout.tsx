import type { Metadata } from "next";
import PublicQualityGuard from "@/components/PublicQualityGuard";
import "./globals.css";
import "./booking.css";
import "./discovery.css";
import "./discovery-map.css";
import "./media.css";
import "./detail-cleanup.css";

export const metadata: Metadata = {
  title: "MapForYou | 韓国の予約代行と日本語メニュー",
  description: "韓国のレストランや美容室の予約を日本語で依頼し、ソウルのお店と翻訳メニューを探せます。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body><PublicQualityGuard />{children}</body></html>;
}
