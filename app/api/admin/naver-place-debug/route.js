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

  const interestingResponses = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });
    page.on("response", (response) => {
      const url = response.url();
      if (/place|search|graphql|map\.naver|pcmap/i.test(url)) {
        interestingResponses.push({ status: response.status(), url: url.slice(0, 1000) });
      }
    });

    const query = "롯데리아 성수역점 서울특별시 성동구 아차산로7길 28";
    const searchUrl = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(4500);

    const searchFrame = page.frames().find((frame) => frame.url().includes("pcmap.place.naver.com/place/list"));
    if (!searchFrame) {
      return NextResponse.json({ error: "search frame missing", frames: page.frames().map((f) => f.url()) }, { status: 500 });
    }

    const before = await searchFrame.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const anchor = anchors.find((item) => (item.innerText || item.textContent || "").includes("롯데리아 성수역점"));
      if (!anchor) return { found: false };
      let node = anchor;
      const chain = [];
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        chain.push({
          tag: node.tagName,
          text: (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 700),
          attrs: Object.fromEntries(Array.from(node.attributes || []).map((attr) => [attr.name, attr.value])),
          html: node.outerHTML.slice(0, 5000),
        });
      }
      anchor.setAttribute("data-mapforyou-debug", "1");
      return { found: true, chain };
    });

    const target = await searchFrame.$("[data-mapforyou-debug='1']");
    if (target) {
      await target.click();
    }
    await sleep(5000);

    const afterFrames = [];
    for (const frame of page.frames()) {
      try {
        const snapshot = await frame.evaluate(() => ({
          title: document.title,
          text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1800),
          resources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /place|graphql|search|map\.naver/i.test(name)).slice(-60),
          ids: Array.from(document.querySelectorAll("[data-id],[data-place-id],[data-cid]"))
            .slice(0, 100)
            .map((element) => ({
              tag: element.tagName,
              text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
              id: element.getAttribute("data-place-id") || element.getAttribute("data-id") || element.getAttribute("data-cid") || "",
            })),
        }));
        afterFrames.push({ url: frame.url(), ...snapshot });
      } catch (error) {
        afterFrames.push({ url: frame.url(), error: error instanceof Error ? error.message : "frame error" });
      }
    }

    return NextResponse.json({
      searchUrl,
      pageUrl: page.url(),
      before,
      afterFrames,
      responses: interestingResponses.slice(-150),
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
