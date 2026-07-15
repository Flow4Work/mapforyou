import type { Metadata } from "next";
import "./globals.css";
import "./discovery.css";
import "./discovery-map.css";
import "./media.css";

export const metadata: Metadata = {
  title: "MapForYou | Translated Seoul Menus",
  description: "Explore Seoul restaurants on a map and read English and Japanese menus before you visit.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
