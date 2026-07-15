import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const searchUrl = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(4500);

    const searchFrame = page.frames().find((frame) => frame.url().includes("pcmap.place.naver.com/place/list"));
    if (!searchFrame) return NextResponse.json({ error: "search frame missing" }, { status: 500 });

    const targetInfo = await searchFrame.evaluate(() => {
      const anchor = Array.from(document.querySelectorAll("a"))
        .find((item) => (item.innerText || item.textContent || "").includes("롯데리아 성수역점"));
      if (!anchor) return { found: false };
      anchor.setAttribute("data-mapforyou-debug", "1");
      return { found: true };
    });
    if (!targetInfo.found) return NextResponse.json({ error: "target missing" }, { status: 500 });

    const target = await searchFrame.$("[data-mapforyou-debug='1']");
    await target?.click();
    await sleep(5000);

    const frames = [];
    for (const frame of page.frames()) {
      try {
        const snapshot = await frame.evaluate(() => {
          const controls = Array.from(document.querySelectorAll("a,button,[role='button'],span,div"))
            .filter((element) => /홈페이지|인스타그램|페이스북/i.test((element.innerText || element.textContent || "").trim()))
            .slice(0, 80)
            .map((element) => ({
              tag: element.tagName,
              text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
              attrs: Object.fromEntries(Array.from(element.attributes || []).map((attr) => [attr.name, attr.value])),
              html: element.outerHTML.slice(0, 6000),
              reactKeys: Object.keys(element).filter((key) => key.startsWith("__react")).slice(0, 10),
            }));
          return {
            title: document.title,
            text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 2200),
            controls,
          };
        });
        frames.push({ url: frame.url(), ...snapshot });
      } catch (error) {
        frames.push({ url: frame.url(), error: error instanceof Error ? error.message : "frame error" });
      }
    }

    return NextResponse.json({ searchUrl, pageUrl: page.url(), frames });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
