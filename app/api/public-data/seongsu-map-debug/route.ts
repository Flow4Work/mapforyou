import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "LOOOP 성수";
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
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const frames = [] as Array<Record<string, unknown>>;
    for (const frame of page.frames()) {
      try {
        const data = await frame.evaluate((q) => {
          const keyword = q.split(/\s+/).find((value) => value.length >= 2) || q;
          const matchedElements = Array.from(document.querySelectorAll<HTMLElement>("a,button,[role='button'],[role='link'],li,div"))
            .filter((element) => (element.innerText || element.textContent || "").includes(keyword))
            .slice(0, 12)
            .map((element) => ({
              text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
              tag: element.tagName,
              outerHTML: element.outerHTML.slice(0, 2500),
            }));
          const html = document.documentElement.innerHTML.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
          const snippets: string[] = [];
          let from = 0;
          while (snippets.length < 8) {
            const index = html.toLocaleLowerCase("ko-KR").indexOf(keyword.toLocaleLowerCase("ko-KR"), from);
            if (index < 0) break;
            snippets.push(html.slice(Math.max(0, index - 700), Math.min(html.length, index + keyword.length + 1200)));
            from = index + keyword.length;
          }
          return {
            url: location.href,
            title: document.title,
            text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 7000),
            matchedElements,
            snippets,
          };
        }, query);
        frames.push(data);
      } catch (error) {
        frames.push({ url: frame.url(), error: error instanceof Error ? error.message : String(error) });
      }
    }
    return NextResponse.json({ query, pageUrl: page.url(), frames });
  } finally {
    if (page) await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
