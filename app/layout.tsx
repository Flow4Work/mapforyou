import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MapForYou",
  description: "Korean menus translated into English and Japanese",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
