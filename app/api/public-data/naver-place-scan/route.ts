import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Frame, type Page } from "puppeteer-core";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIVE_REGIONS = ["seongsu", "hongdae"] as const;
const MAX_BATCH_SIZE = 10;
const REQUEST_DEADLINE_MS = 52_000;
const NAVIGATION_TIMEOUT_MS = 13_000;
const BLOCK_PATTERN = /자동입력|비정상적인 접근|접근이 제한|서비스 이용이 제한|요청이 차단/i;

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about",
  "accounts",
  "challenge",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "p",
  "press",
  "privacy",
  "reel",
  "reels",
  "stories",
  "terms",
  "tv",
  "web",
]);

const EXCLUDED_WEBSITE_HOSTS = [
  "naver.com",
  "naver.me",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "blog.naver.com",
  "booking.naver.com",
  "smartplace.naver.com",
];

type RegionKey = (typeof ACTIVE_REGIONS)[number];

type RestaurantRow = {
  source_id: string;
  name: string;
  road_address: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  category: string | null;
  region_key: string | null;
};

type ScanResult = {
  placeId: string | null;
  placeUrl: string | null;
  searchUrl: string;
  officialWebsite: string | null;
  instagramUrl: string | null;
  instagramUsername: string | null;
  discoverySource: "naver_place" | "official_website" | "none";
  confidence: number;
  reasons: string[];
};

class NaverBlockedError extends Error {
  constructor() {
    super("네이버 접근 제한이 감지됐습니다.");
    this.name = "NaverBlockedError";
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function compact(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/&amp;/gi, "&")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function baseName(value: string) {
  return compact(
    value
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/(?:성수점|홍대점|연남점|서울숲점|본점|직영점|지점)$/g, ""),
  );
}

function addressHints(value: string) {
  const parts = value
    .split(/\s+/)
    .map((part) => compact(part))
    .filter((part) => part.length >= 2);
  const preferred = parts.filter((part) => /(?:구|동|가)$/.test(part) || /(?:로|길)\d*/.test(part));
  return [...new Set([...preferred, ...parts.slice(-4)])].slice(0, 7);
}

function naverSearchUrl(row: RestaurantRow) {
  const query = `${row.name} ${row.road_address || row.address || ""}`.trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function extractPlaceId(value: string) {
  let decoded = value || "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original value.
  }
  const patterns = [
    /\/entry\/place\/(\d{5,})/i,
    /pcmap\.place\.naver\.com\/(?:restaurant|cafe|place|hospital|hairshop|nailshop|accommodation)\/(\d{5,})/i,
    /[?&](?:placeId|id)=(\d{5,})/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function normalizeInstagramProfile(value: string) {
  const raw = value.trim().replace(/&amp;/gi, "&");
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host !== "instagram.com") return null;
    const username = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    if (!username || RESERVED_INSTAGRAM_PATHS.has(username) || !/^[a-z0-9._]{1,30}$/.test(username)) {
      return null;
    }
    return { username, url: `https://www.instagram.com/${username}/` };
  } catch {
    return null;
  }
}

function unwrapExternalUrl(rawValue: string, baseUrl: string) {
  const raw = rawValue.trim().replace(/&amp;/gi, "&");
  if (!raw || /^(javascript:|mailto:|tel:|data:)/i.test(raw)) return null;
  try {
    let url = new URL(raw, baseUrl);
    for (let depth = 0; depth < 2; depth += 1) {
      if (!/(^|\.)naver\.com$|(^|\.)naver\.me$/i.test(url.hostname)) break;
      const nested = ["url", "u", "target", "link", "redirect", "redirectUrl"]
        .map((key) => url.searchParams.get(key))
        .find(Boolean);
      if (!nested) break;
      url = new URL(decodeURIComponent(nested));
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicWebsite(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    return !EXCLUDED_WEBSITE_HOSTS.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
  } catch {
    return false;
  }
}

async function pageBlocked(page: Page) {
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => (document.body?.innerText || "").slice(0, 15_000));
      if (BLOCK_PATTERN.test(text)) return true;
    } catch {
      // Ignore detached frames.
    }
  }
  return false;
}

async function waitForSearchFrame(page: Page, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((item) => item.url().includes("pcmap.place.naver.com/place/list"));
    if (frame) {
      try {
        const hasResults = await frame.evaluate(() => Boolean(document.body?.innerText?.trim()));
        if (hasResults) return frame;
      } catch {
        // Retry while the frame is loading.
      }
    }
    await delay(250);
  }
  return null;
}

async function markBestResult(frame: Frame, row: RestaurantRow) {
  const fullName = compact(row.name);
  const shortName = baseName(row.name);
  const hints = addressHints(row.road_address || row.address || "");
  const phone = String(row.phone || "").replace(/\D/g, "");

  return await frame.evaluate(
    ({ fullName, shortName, hints, phone }) => {
      const normalize = (value: string) =>
        value
          .toLocaleLowerCase("ko-KR")
          .replace(/&amp;/gi, "&")
          .replace(/[^0-9a-z가-힣]/g, "");

      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
      let best: { anchor: HTMLAnchorElement; score: number; text: string } | null = null;

      for (const anchor of anchors) {
        const title = (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim();
        if (!title || title.length > 160) continue;

        let container: HTMLElement | null = anchor.closest("li");
        if (!container) {
          let current: HTMLElement | null = anchor.parentElement;
          for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
            const currentText = (current.innerText || "").replace(/\s+/g, " ").trim();
            if (currentText.length >= title.length && currentText.length <= 600) container = current;
          }
        }

        const containerText = (container?.innerText || title).replace(/\s+/g, " ").trim();
        const titleBlob = normalize(title);
        const containerBlob = normalize(containerText);
        let score = 0;

        if (fullName.length >= 2 && titleBlob.includes(fullName)) score += 100;
        else if (fullName.length >= 2 && containerBlob.includes(fullName)) score += 80;
        else if (shortName.length >= 2 && titleBlob.includes(shortName)) score += 55;
        else if (shortName.length >= 2 && containerBlob.includes(shortName)) score += 45;
        else continue;

        score += Math.min(30, hints.filter((hint) => containerBlob.includes(hint)).length * 10);
        if (phone.length >= 8 && containerBlob.includes(phone)) score += 20;
        if (/출발|도착|상세주소/.test(containerText)) score += 5;

        if (!best || score > best.score) best = { anchor, score, text: containerText.slice(0, 500) };
      }

      document.querySelectorAll("[data-mapforyou-match]").forEach((element) => {
        element.removeAttribute("data-mapforyou-match");
      });
      if (!best || best.score < 55) return { marked: false, score: best?.score || 0, text: best?.text || "" };
      best.anchor.setAttribute("data-mapforyou-match", "true");
      return { marked: true, score: best.score, text: best.text };
    },
    { fullName, shortName, hints, phone },
  );
}

async function clickBestSearchResult(page: Page, row: RestaurantRow) {
  const frame = await waitForSearchFrame(page);
  if (!frame) return { clicked: false, score: 0, text: "검색 결과 iframe을 불러오지 못함" };

  const marked = await markBestResult(frame, row);
  if (!marked.marked) return { clicked: false, score: marked.score, text: marked.text };

  const element = await frame.$("[data-mapforyou-match='true']");
  if (!element) return { clicked: false, score: marked.score, text: marked.text };
  await element.click();
  return { clicked: true, score: marked.score, text: marked.text };
}

async function waitForPlaceId(page: Page, timeoutMs = 9_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = [page.url(), ...page.frames().map((frame) => frame.url())];
    for (const value of values) {
      const placeId = extractPlaceId(value);
      if (placeId) return placeId;
    }
    await delay(300);
  }
  return null;
}

async function detailFrames(page: Page, placeId: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const frames = page.frames().filter((frame) => {
      const url = frame.url();
      return url.includes(`/${placeId}/`) || url.includes(`/entry/place/${placeId}`);
    });
    if (frames.length) return frames;
    await delay(250);
  }
  return page.frames();
}

async function collectDetailLinks(page: Page, placeId: string, placeUrl: string) {
  const links: string[] = [];
  const htmlChunks: string[] = [];
  const frames = await detailFrames(page, placeId);

  for (const frame of frames) {
    try {
      const frameLinks = await frame.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .slice(0, 1000)
          .map((anchor) => anchor.href),
      );
      links.push(...frameLinks);
      htmlChunks.push((await frame.content()).slice(0, 700_000));
    } catch {
      // Ignore detached frames.
    }
  }

  const decodedHtml = htmlChunks.join("\n").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const instagramMatches = decodedHtml.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]+/gi) || [];

  let directProfile: ReturnType<typeof normalizeInstagramProfile> = null;
  let officialWebsite: string | null = null;

  for (const raw of [...links, ...instagramMatches]) {
    const external = unwrapExternalUrl(raw, placeUrl);
    if (!external) continue;
    directProfile ||= normalizeInstagramProfile(external);
    if (!officialWebsite && isPublicWebsite(external)) officialWebsite = external;
  }

  return { directProfile, officialWebsite };
}

async function websiteInstagram(website: string) {
  if (!isPublicWebsite(website)) return null;
  try {
    const response = await fetch(website, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; MapForYouLinkChecker/1.0)",
      },
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("text/html")) return null;
    const html = (await response.text()).slice(0, 1_000_000).replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    const matches = html.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]+/gi) || [];
    for (const match of matches) {
      const profile = normalizeInstagramProfile(match);
      if (profile) return profile;
    }
  } catch {
    return null;
  }
  return null;
}

async function inspectStore(page: Page, row: RestaurantRow): Promise<ScanResult> {
  const searchUrl = naverSearchUrl(row);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await delay(1_800);
  if (await pageBlocked(page)) throw new NaverBlockedError();

  const clicked = await clickBestSearchResult(page, row);
  if (!clicked.clicked) {
    return {
      placeId: null,
      placeUrl: null,
      searchUrl,
      officialWebsite: null,
      instagramUrl: null,
      instagramUsername: null,
      discoverySource: "none",
      confidence: Math.min(clicked.score, 50),
      reasons: [clicked.text || "상호명과 주소가 맞는 네이버 장소를 선택하지 못함"],
    };
  }

  const placeId = await waitForPlaceId(page);
  if (!placeId) {
    return {
      placeId: null,
      placeUrl: null,
      searchUrl,
      officialWebsite: null,
      instagramUrl: null,
      instagramUsername: null,
      discoverySource: "none",
      confidence: Math.min(clicked.score, 70),
      reasons: ["검색 결과는 선택했지만 네이버 장소 ID를 확인하지 못함", clicked.text],
    };
  }

  const placeUrl = `https://map.naver.com/p/entry/place/${placeId}`;
  await page.goto(placeUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await delay(1_600);
  if (await pageBlocked(page)) throw new NaverBlockedError();

  const { directProfile, officialWebsite } = await collectDetailLinks(page, placeId, placeUrl);
  if (directProfile) {
    return {
      placeId,
      placeUrl,
      searchUrl,
      officialWebsite,
      instagramUrl: directProfile.url,
      instagramUsername: directProfile.username,
      discoverySource: "naver_place",
      confidence: 100,
      reasons: ["네이버 장소 상세에 등록된 인스타그램 링크", clicked.text],
    };
  }

  const websiteProfile = officialWebsite ? await websiteInstagram(officialWebsite) : null;
  if (websiteProfile) {
    return {
      placeId,
      placeUrl,
      searchUrl,
      officialWebsite,
      instagramUrl: websiteProfile.url,
      instagramUsername: websiteProfile.username,
      discoverySource: "official_website",
      confidence: 95,
      reasons: ["네이버 장소에 등록된 공식 홈페이지에서 인스타그램 링크 확인", clicked.text],
    };
  }

  return {
    placeId,
    placeUrl,
    searchUrl,
    officialWebsite,
    instagramUrl: null,
    instagramUsername: null,
    discoverySource: "none",
    confidence: 85,
    reasons: [
      officialWebsite ? "장소와 공식 홈페이지는 확인했지만 인스타그램 링크 없음" : "장소는 확인했지만 외부 링크 없음",
      clicked.text,
    ],
  };
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
  page.setDefaultTimeout(9_000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (["image", "media", "font"].includes(request.resourceType())) request.abort();
    else request.continue();
  });
  return page;
}

function selectedRegions(region: string | null) {
  return ACTIVE_REGIONS.includes(region as RegionKey) ? [region as RegionKey] : [...ACTIVE_REGIONS];
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

  try {
    const body = (await request.json()) as { region?: string; limit?: number; retry?: boolean };
    const region = ACTIVE_REGIONS.includes(body.region as RegionKey) ? body.region! : "all";
    const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const targetStatus = body.retry ? "not_found" : "unchecked";

    const { data, error } = await supabase
      .from("public_data_restaurants")
      .select("source_id,name,road_address,address,latitude,longitude,phone,category,region_key")
      .in("region_key", selectedRegions(region))
      .eq("instagram_status", targetStatus)
      .order(body.retry ? "instagram_checked_at" : "created_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw error;

    const stores = (data || []) as RestaurantRow[];
    if (!stores.length) return NextResponse.json({ processed: 0, message: "확인할 가게가 없습니다." });

    let browser: Browser | null = null;
    let page: Page | null = null;
    let processed = 0;
    let placeResolved = 0;
    let found = 0;
    let stopped = false;
    const startedAt = Date.now();

    try {
      browser = await launchBrowser();
      page = await preparePage(browser);

      for (const store of stores) {
        if (Date.now() - startedAt > REQUEST_DEADLINE_MS) break;

        let result: ScanResult;
        try {
          result = await inspectStore(page, store);
        } catch (scanError) {
          if (scanError instanceof NaverBlockedError) {
            stopped = true;
            break;
          }
          result = {
            placeId: null,
            placeUrl: null,
            searchUrl: naverSearchUrl(store),
            officialWebsite: null,
            instagramUrl: null,
            instagramUsername: null,
            discoverySource: "none",
            confidence: 0,
            reasons: [scanError instanceof Error ? scanError.message : "네이버 장소 확인 실패"],
          };
        }

        const now = new Date().toISOString();
        const hasInstagram = Boolean(result.instagramUrl && result.instagramUsername);
        const status = hasInstagram ? "verified" : result.placeId ? "not_found" : "candidate";
        const source = hasInstagram
          ? result.discoverySource === "official_website"
            ? "naver_official_website"
            : "naver_place_direct"
          : result.placeId
            ? "naver_place_no_instagram"
            : "naver_place_unmatched";

        const candidate = {
          provider: "naver_place",
          placeId: result.placeId,
          placeUrl: result.placeUrl,
          searchUrl: result.searchUrl,
          officialWebsite: result.officialWebsite,
          instagramUrl: result.instagramUrl,
          instagramUsername: result.instagramUsername,
          discoverySource: result.discoverySource,
          confidence: result.confidence,
          reasons: result.reasons,
        };

        const { error: updateError } = await supabase
          .from("public_data_restaurants")
          .update({
            instagram_url: hasInstagram ? result.instagramUrl : null,
            instagram_username: hasInstagram ? result.instagramUsername : null,
            instagram_status: status,
            instagram_source: source,
            instagram_confidence: result.confidence,
            instagram_candidates: [candidate],
            instagram_search_query: result.searchUrl,
            instagram_checked_at: now,
            naver_place_id: result.placeId,
            naver_place_url: result.placeUrl,
            official_website_url: result.officialWebsite,
            naver_place_checked_at: now,
            updated_at: now,
          })
          .eq("source_id", store.source_id);
        if (updateError) throw updateError;

        processed += 1;
        if (result.placeId) placeResolved += 1;
        if (hasInstagram) found += 1;
        await delay(700);
      }
    } finally {
      if (page) await page.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
    }

    return NextResponse.json({
      processed,
      placeResolved,
      found,
      stopped,
      message: stopped
        ? `${processed}곳 처리 후 네이버 접근 제한이 감지돼 즉시 중단했습니다.`
        : `${processed}곳 중 네이버 장소 ${placeResolved}곳을 확인했고 인스타그램 ${found}곳을 자동 저장했습니다.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "네이버 장소 자동 확인 실패" },
      { status: 500 },
    );
  }
}
