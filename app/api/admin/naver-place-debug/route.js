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
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });

    const query = "롯데리아 성수역점 서울특별시 성동구 아차산로7길 28";
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/p/api/search/allSearch"),
      { timeout: 15000 },
    );
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    const response = await responsePromise;
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 30000) };
    }
    return NextResponse.json({ url: response.url(), data });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
