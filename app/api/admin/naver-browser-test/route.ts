import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const query = incoming.searchParams.get("q")?.trim() || "롯데리아 성수역점 서울특별시 성동구 아차산로7길 28";
  const target = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;

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
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const frames = [];
    for (const frame of page.frames()) {
      try {
        const snapshot = await frame.evaluate(() => ({
          title: document.title,
          bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 2500),
          elements: Array.from(
            document.querySelectorAll<HTMLElement>(
              "a[href],button,[role='button'],[data-id],[data-place-id],[data-cid],[data-nclicks]",
            ),
          )
            .slice(0, 150)
            .map((element) => ({
              tag: element.tagName,
              text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
              href: element instanceof HTMLAnchorElement ? element.href : "",
              id: element.id,
              className: String(element.className || "").slice(0, 300),
              dataId:
                element.getAttribute("data-place-id") ||
                element.getAttribute("data-id") ||
                element.getAttribute("data-cid") ||
                "",
              nclicks: element.getAttribute("data-nclicks") || "",
              ariaLabel: element.getAttribute("aria-label") || "",
            })),
        }));
        frames.push({ url: frame.url(), ...snapshot });
      } catch (error) {
        frames.push({ url: frame.url(), error: error instanceof Error ? error.message : "frame error" });
      }
    }

    return NextResponse.json({ target, pageUrl: page.url(), frames });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
