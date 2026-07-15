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
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await sleep(4500);

    const frame = page.frames().find((item) => item.url().includes("pcmap.place.naver.com/place/list"));
    if (!frame) return NextResponse.json({ error: "search frame missing" }, { status: 500 });

    const result = await frame.evaluate(() => {
      const anchor = Array.from(document.querySelectorAll("a"))
        .find((item) => (item.innerText || item.textContent || "").includes("롯데리아 성수역점"));
      if (!anchor) return { error: "anchor missing" };

      const findings = [];
      const seen = new WeakSet();
      const walk = (value, path, depth) => {
        if (depth > 7 || findings.length > 300 || value == null) return;
        if (typeof value !== "object" && typeof value !== "function") return;
        if (seen.has(value)) return;
        seen.add(value);
        for (const key of Object.keys(value)) {
          let child;
          try { child = value[key]; } catch { continue; }
          const childPath = `${path}.${key}`;
          if (
            /(?:^|_)(?:id|placeId|businessId|cid|name|address|roadAddress|url|href)$/i.test(key) ||
            /place|business|restaurant|cafe|address/i.test(key)
          ) {
            if (["string", "number", "boolean"].includes(typeof child)) {
              findings.push({ path: childPath, value: String(child).slice(0, 1000) });
            }
          }
          if (child && (typeof child === "object" || typeof child === "function")) walk(child, childPath, depth + 1);
        }
      };

      const nodes = [];
      let node = anchor;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) nodes.push(node);
      for (const [index, item] of nodes.entries()) {
        for (const key of Object.keys(item).filter((key) => key.startsWith("__react"))) {
          walk(item[key], `node${index}.${key}`, 0);
        }
      }
      return {
        text: (anchor.parentElement?.innerText || anchor.innerText || "").replace(/\s+/g, " ").slice(0, 1000),
        findings,
      };
    });

    return NextResponse.json(result);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
