import type { Metadata } from "next";
import PublicQualityGuard from "@/components/PublicQualityGuard";
import "./globals.css";
import "./discovery.css";
import "./discovery-map.css";
import "./media.css";
import "./detail-cleanup.css";
import "./mobile-polish.css";
import "./final-ui-polish.css";
import "./mobile-map-home.css";
import "./mobile-compact-layout.css";
import "./brand.css";

export const metadata: Metadata = {
  title: "ココチズ | ソウルのグルメマップ",
  description: "ソウルのおいしいお店を地図で探して、日本語のメニューや料理の写真をチェック。英語にも切り替えられます。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body><PublicQualityGuard />{children}</body></html>;
}
