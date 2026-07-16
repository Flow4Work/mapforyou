import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 3;
const NAVIGATION_TIMEOUT_MS = 12_000;

const TARGETS = [
  { name: "페로몬 성수", query: "페로몬 성수 카페" },
  { name: "오우드", query: "오우드 성수 카페" },
  { name: "그라스커피랩 성수점", query: "그라스커피랩 성수점" },
  { name: "LOOOP 루프 성수점 베이커리 카페", query: "LOOOP 루프 성수점 베이커리 카페" },
  { name: "에낭 성수점", query: "에낭 성수점 카페" },
  { name: "entry55 라운지성수", query: "entry55 라운지성수" },
  { name: "에어드랍 커피 성수", query: "에어드랍 커피 성수" },
  { name: "맥파이앤타이거 성수티룸", query: "맥파이앤타이거 성수티룸" },
  { name: "성수르치아바타", query: "성수르치아바타" },
  { name: "클래식 해례커피 성수본점", query: "클래식 해례커피 성수본점" },
  { name: "파케파케 성수", query: "파케파케 성수" },
  { name: "마망젤라또 성수점", query: "마망젤라또 성수점" },
  { name: "첸첸 성수점", query: "첸첸 성수점 카페" },
  { name: "프렌즈앤아트", query: "프렌즈앤아트 성수 카페" },
  { name: "카페씨떼 성수", query: "카페씨떼 성수" },
  { name: "레이저요거트 성수점", query: "레이저요거트 성수점" },
  { name: "ddd", query: "ddd 성수 카페" },
  { name: "스탠다드브레드 성수", query: "스탠다드브레드 성수" },
  { name: "브릭샌드 성수 팩토리", query: "브릭샌드 성수 팩토리" },
  { name: "유키모찌 성수점", query: "유키모찌 성수점" },
  { name: "ETF베이커리 성수", query: "ETF베이커리 성수" },
  { name: "이파리서재", query: "이파리서재 성수" },
  { name: "브루크 성수", query: "브루크 성수 카페" },
  { name: "하하하성수", query: "하하하성수 카페" },
  { name: "사운드프로바이더 Cafe&Bar", query: "사운드프로바이더 Cafe&Bar 성수" },
  { name: "헤리스플랏", query: "헤리스플랏 성수" },
  { name: "밀스", query: "밀스 성수 베이커리" },
  { name: "피제리아앤 성수", query: "피제리아앤 성수" },
  { name: "코끼리베이글 성수", query: "코끼리베이글 성수" },
] as const;

type PlacePreview = {
  sourceId: string;
  naverPlaceId: string;
  naverPlaceUrl: string;
  name: string;
  roadAddress: string;
  address: string;
  phone: string;
  category: string;
  introduction: string;
  instagramUrl: string;
  instagramUsername: string;
  officialWebsiteUrl: string;
  latitude: number | null;
  longitude: number | null;
  menus: Array<{ nameKo: string; price: number; sourceText?: string }>;
  warnings: string[];
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/&amp;/gi, "&")
    .replace(/(?:성수점|성수본점|성수|본점|베이커리카페|카페앤바|cafe&bar)/gi, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function extractPlaceId(value: string) {
  let decoded = value || "";
  try { decoded = decodeURIComponent(decoded); } catch { /* keep */ }
  const patterns = [
    /\/entry\/place\/(\d{5,})/i,
    /(?:pcmap|m)\.place\.naver\.com\/(?:restaurant|cafe|place|hospital|hairshop|nailshop|accommodation)\/(\d{5,})/i,
    /[?&](?:placeId|id)=(\d{5,})/i,
    /^(\d{5,})$/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function launchBrowser() {
  chromium.setGraphicsMode = false;
  return await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
  });
}

async function preparePage(browser: Browser) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  page.setDefaultTimeout(7_000);
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (["image", "media", "font"].includes(request.resourceType())) request.abort();
    else request.continue();
  });
  return page;
}

async function elements(page: Page) {
  const values: Array<{ frameIndex: number; elementIndex: number; text: string; href: string; dataId: string; placeId: string | null }> = [];
  const frames = page.frames();
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    try {
      const items = await frame.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("a[href],button,[role='button'],[data-id],[data-place-id]"))
          .slice(0, 1600)
          .map((element, elementIndex) => ({
            elementIndex,
            text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600),
            href: element instanceof HTMLAnchorElement ? element.href : "",
            dataId: element.getAttribute("data-place-id") || element.getAttribute("data-id") || element.getAttribute("data-cid") || "",
          })),
      );
      for (const item of items) {
        values.push({ ...item, frameIndex, placeId: extractPlaceId(item.href) || extractPlaceId(item.dataId) });
      }
    } catch {
      // Ignore detached frames.
    }
  }
  return values;
}

async function findPlaceId(page: Page, targetName: string, query: string) {
  await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await delay(1_400);
  const target = compact(targetName);
  const candidates = (await elements(page))
    .map((item) => {
      const blob = compact(`${item.text} ${item.href} ${item.dataId}`);
      let score = 0;
      if (target && blob === target) score += 200;
      if (target && blob.includes(target)) score += 120;
      if (target && target.includes(blob) && blob.length >= 3) score += 60;
      if (item.placeId) score += 10;
      if (/성동구|성수/.test(item.text)) score += 20;
      return { ...item, score };
    })
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score);

  const direct = candidates.find((item) => item.placeId);
  if (direct?.placeId) return { placeId: direct.placeId, matchedText: direct.text, score: direct.score };

  const clickable = candidates[0];
  if (!clickable) return null;
  const frame = page.frames()[clickable.frameIndex];
  if (!frame) return null;
  try {
    await frame.evaluate((elementIndex) => {
      const list = Array.from(document.querySelectorAll<HTMLElement>("a[href],button,[role='button'],[data-id],[data-place-id]"));
      list[elementIndex]?.click();
    }, clickable.elementIndex);
  } catch {
    return null;
  }

  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    for (const value of [page.url(), ...page.frames().map((item) => item.url())]) {
      const placeId = extractPlaceId(value);
      if (placeId) return { placeId, matchedText: clickable.text, score: clickable.score };
    }
    const discovered = (await elements(page)).map((item) => item.placeId).find(Boolean);
    if (discovered) return { placeId: discovered, matchedText: clickable.text, score: clickable.score };
    await delay(350);
  }
  return null;
}

function namesAgree(expected: string, actual: string) {
  const left = compact(expected);
  const right = compact(actual);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error || `HTTP ${response.status}`);
  return data as T;
}

export async function GET(request: Request) {
  const batch = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get("batch") || 0)));
  const selected = TARGETS.slice(batch * BATCH_SIZE, batch * BATCH_SIZE + BATCH_SIZE);
  if (!selected.length) return NextResponse.json({ batch, done: true, total: TARGETS.length, results: [] });

  const origin = new URL(request.url).origin;
  let browser: Browser | null = null;
  let page: Page | null = null;
  const results: Array<Record<string, unknown>> = [];
  try {
    browser = await launchBrowser();
    page = await preparePage(browser);
    for (const target of selected) {
      try {
        const found = await findPlaceId(page, target.name, target.query);
        if (!found?.placeId) {
          results.push({ requestedName: target.name, status: "not_found" });
          continue;
        }
        const previewResponse = await postJson<{ preview?: PlacePreview; error?: string }>(
          `${origin}/api/public-data/curated-place/preview`,
          { url: found.placeId },
        );
        const preview = previewResponse.preview;
        if (!preview) throw new Error(previewResponse.error || "미리보기 없음");
        const addressOkay = /서울(?:특별시)?\s*성동구|서울\s*성동구/.test(preview.roadAddress || preview.address);
        const nameOkay = namesAgree(target.name, preview.name);
        if (!addressOkay || !nameOkay) {
          results.push({
            requestedName: target.name,
            status: "mismatch",
            placeId: found.placeId,
            actualName: preview.name,
            address: preview.roadAddress,
            matchedText: found.matchedText,
            nameOkay,
            addressOkay,
          });
          continue;
        }
        const complete = Boolean(
          preview.name && preview.roadAddress && preview.latitude != null && preview.longitude != null
          && preview.instagramUrl && preview.menus.length,
        );
        const saved = await postJson<{ test?: { menuCount?: number; publishStatus?: string; readyForPublic?: boolean } }>(
          `${origin}/api/public-data/curated-place`,
          { ...preview, action: "save", regionKey: "seongsu", publish: complete },
        );
        results.push({
          requestedName: target.name,
          status: "saved",
          placeId: found.placeId,
          actualName: preview.name,
          address: preview.roadAddress,
          instagram: Boolean(preview.instagramUrl),
          menuCount: preview.menus.length,
          coordinates: preview.latitude != null && preview.longitude != null,
          publishStatus: saved.test?.publishStatus || "draft",
          readyForPublic: Boolean(saved.test?.readyForPublic),
          warnings: preview.warnings,
        });
      } catch (error) {
        results.push({ requestedName: target.name, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
      await delay(500);
    }
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }

  return NextResponse.json({
    batch,
    done: (batch + 1) * BATCH_SIZE >= TARGETS.length,
    total: TARGETS.length,
    nextBatch: (batch + 1) * BATCH_SIZE < TARGETS.length ? batch + 1 : null,
    results,
  });
}
