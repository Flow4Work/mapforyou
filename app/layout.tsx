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

export const metadata: Metadata = {
  title: "MapForYou | Translated Seoul Menus",
  description: "Explore Seoul restaurants on a map and read English and Japanese menus before you visit.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PublicQualityGuard />{children}</body></html>;
}
