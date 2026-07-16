import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  chromium.setGraphicsMode = false;
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1280, height: 900 },
  });
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent("LOOOP 루프 성수점 베이커리 카페")}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const frames = [] as Array<Record<string, unknown>>;
    for (const frame of page.frames()) {
      try {
        const data = await frame.evaluate(() => ({
          url: location.href,
          title: document.title,
          text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 5000),
          links: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
            .slice(0, 100)
            .map((a) => ({ text: (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300), href: a.href })),
          dataIds: Array.from(document.querySelectorAll<HTMLElement>("[data-id],[data-place-id],[data-cid]"))
            .slice(0, 100)
            .map((e) => ({ text: (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300), id: e.getAttribute("data-place-id") || e.getAttribute("data-id") || e.getAttribute("data-cid") })),
        }));
        frames.push(data);
      } catch (error) {
        frames.push({ url: frame.url(), error: error instanceof Error ? error.message : String(error) });
      }
    }
    return NextResponse.json({ pageUrl: page.url(), frames });
  } finally {
    if (page) await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
