import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Frame, type Page } from "puppeteer-core";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIVE_REGIONS = ["seongsu", "hongdae"] as const;
const MAX_BATCH_SIZE = 10;
const MAX_STATUS_ROWS = 100;
const REQUEST_DEADLINE_MS = 52_000;
const NAVIGATION_TIMEOUT_MS = 12_000;

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about", "accounts", "challenge", "developer", "direct", "directory", "emails", "explore",
  "legal", "p", "press", "privacy", "reel", "reels", "stories", "terms", "tv", "web",
]);

const BLOCK_PATTERN = /captcha|자동입력|비정상적인 접근|접근이 제한|서비스 이용이 제한|요청이 차단/i;
const EXCLUDED_WEBSITE_HOSTS = [
  "naver.com", "naver.me", "instagram.com", "facebook.com", "youtube.com", "youtu.be",
  "twitter.com", "x.com", "blog.naver.com", "booking.naver.com", "smartplace.naver.com",
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
  instagram_url: string | null;
  instagram_username: string | null;
  instagram_status: string | null;
  instagram_source: string | null;
  instagram_confidence: number | null;
  instagram_candidates: unknown;
  instagram_search_query: string | null;
  instagram_checked_at: string | null;
  naver_place_id: string | null;
  naver_place_url: string | null;
  official_website_url: string | null;
  naver_place_checked_at: string | null;
};

type NaverCandidate = {
  provider: "naver_place";
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

type BrowserElement = {
  frameIndex: number;
  elementIndex: number;
  frameUrl: string;
  text: string;
  href: string;
  dataId: string;
  placeId: string | null;
  score: number;
};

class NaverBlockedError extends Error {
  constructor() {
    super("네이버가 자동 요청을 제한했습니다. 이번 실행을 즉시 중단했습니다.");
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/&amp;/gi, "&").replace(/[^0-9a-z가-힣]/g, "");
}

function canonicalName(value: string) {
  return compact(
    value
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/(?:성수점|홍대점|연남점|서울숲점|본점|직영점|지점)$/g, ""),
  );
}

function addressHints(value: string) {
  return [...new Set(
    value
      .split(/\s+/)
      .map((part) => compact(part))
      .filter((part) => part.length >= 2),
  )].slice(-5);
}

function normalizeInstagramProfile(value: string) {
  const raw = value.trim().replace(/&amp;/gi, "&");
  if (!raw) return null;
  if (/^[a-z0-9._]{1,30}$/i.test(raw) && !RESERVED_INSTAGRAM_PATHS.has(raw.toLowerCase())) {
    const username = raw.toLowerCase();
    return { username, url: `https://www.instagram.com/${username}/` };
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host !== "instagram.com") return null;
    const username = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
    if (!username || RESERVED_INSTAGRAM_PATHS.has(username) || !/^[a-z0-9._]{1,30}$/.test(username)) return null;
    return { username, url: `https://www.instagram.com/${username}/` };
  } catch {
    return null;
  }
}

function naverSearchUrl(row: RestaurantRow) {
  const query = `${row.name} ${row.road_address || row.address || ""}`.trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function extractPlaceId(value: string) {
  const decoded = decodeURIComponent(value || "");
  const patterns = [
    /\/entry\/place\/(\d{5,})/i,
    /pcmap\.place\.naver\.com\/(?:restaurant|cafe|place|hospital|hairshop|nailshop|accommodation)\/(\d{5,})/i,
    /[?&](?:placeId|id)=(\d{5,})/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }
  return /^\d{5,}$/.test(decoded.trim()) ? decoded.trim() : null;
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

function isPublicWebsite(urlValue: string) {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    return !EXCLUDED_WEBSITE_HOSTS.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
  } catch {
    return false;
  }
}

function scoreElement(row: RestaurantRow, text: string, href: string, dataId: string) {
  const sourceName = canonicalName(row.name);
  const blob = compact(`${text} ${href} ${dataId}`);
  let score = 0;
  if (sourceName && blob.includes(sourceName)) score += 60;
  const hints = addressHints(row.road_address || row.address || "");
  score += Math.min(30, hints.filter((hint) => blob.includes(hint)).length * 10);
  const phone = String(row.phone || "").replace(/\D/g, "");
  if (phone.length >= 8 && blob.includes(phone)) score += 20;
  if (extractPlaceId(href) || extractPlaceId(dataId)) score += 8;
  return score;
}

async function frameElements(page: Page, row: RestaurantRow) {
  const all: BrowserElement[] = [];
  const frames = page.frames();
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    try {
      const items = await frame.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("a[href],button,[role='button'],[data-id],[data-place-id]"))
          .slice(0, 1200)
          .map((element, elementIndex) => ({
            elementIndex,
            text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
            href: element instanceof HTMLAnchorElement ? element.href : "",
            dataId:
              element.getAttribute("data-place-id") ||
              element.getAttribute("data-id") ||
              element.getAttribute("data-cid") ||
              "",
          })),
      );
      for (const item of items) {
        const placeId = extractPlaceId(item.href) || extractPlaceId(item.dataId);
        const score = scoreElement(row, item.text, item.href, item.dataId);
        if (score > 0 || placeId) {
          all.push({ ...item, frameIndex, frameUrl: frame.url(), placeId, score });
        }
      }
    } catch {
      // Cross-origin or detached frames are ignored.
    }
  }
  return all.sort((a, b) => b.score - a.score);
}

async function clickElement(page: Page, candidate: BrowserElement) {
  const frame = page.frames()[candidate.frameIndex];
  if (!frame) return false;
  try {
    return await frame.evaluate((elementIndex) => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>("a[href],button,[role='button'],[data-id],[data-place-id]"));
      const element = elements[elementIndex];
      if (!element) return false;
      element.click();
      return true;
    }, candidate.elementIndex);
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

async function waitForPlaceId(page: Page, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = [page.url(), ...page.frames().map((frame) => frame.url())];
    for (const value of values) {
      const placeId = extractPlaceId(value);
      if (placeId) return placeId;
    }
    const elements = await frameElements(page, {
      source_id: "", name: "", road_address: null, address: null, latitude: null, longitude: null, phone: null,
      category: null, region_key: null, instagram_url: null, instagram_username: null, instagram_status: null,
      instagram_source: null, instagram_confidence: null, instagram_candidates: [], instagram_search_query: null,
      instagram_checked_at: null, naver_place_id: null, naver_place_url: null, official_website_url: null,
      naver_place_checked_at: null,
    });
    const id = elements.map((item) => item.placeId).find(Boolean);
    if (id) return id;
    await delay(350);
  }
  return null;
}

async function findPlaceId(page: Page, row: RestaurantRow) {
  const elements = await frameElements(page, row);
  const direct = elements.find((item) => item.placeId && item.score >= 35);
  if (direct?.placeId) return direct.placeId;

  const clickable = elements.find((item) => item.score >= 35);
  if (clickable && (await clickElement(page, clickable))) {
    return await waitForPlaceId(page);
  }
  return null;
}

async function collectLinks(page: Page) {
  const links: Array<{ href: string; text: string; frameUrl: string }> = [];
  const htmlChunks: string[] = [];
  for (const frame of page.frames()) {
    try {
      const frameLinks = await frame.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .slice(0, 1000)
          .map((anchor) => ({
            href: anchor.href,
            text: (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
          })),
      );
      links.push(...frameLinks.map((item) => ({ ...item, frameUrl: frame.url() })));
      htmlChunks.push((await frame.content()).slice(0, 600_000));
    } catch {
      // Ignore detached frames.
    }
  }
  return { links, html: htmlChunks.join("\n") };
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

async function inspectNaverPlace(page: Page, row: RestaurantRow): Promise<NaverCandidate> {
  const searchUrl = naverSearchUrl(row);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await delay(1_200);
  if (await pageBlocked(page)) throw new NaverBlockedError();

  const placeId = await findPlaceId(page, row);
  if (!placeId) {
    return {
      provider: "naver_place", placeId: null, placeUrl: null, searchUrl, officialWebsite: null,
      instagramUrl: null, instagramUsername: null, discoverySource: "none", confidence: 0,
      reasons: ["검색 결과에서 주소가 일치하는 네이버 장소를 확정하지 못함"],
    };
  }

  const placeUrl = `https://map.naver.com/p/entry/place/${placeId}`;
  await page.goto(placeUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await delay(1_300);
  if (await pageBlocked(page)) throw new NaverBlockedError();

  const collected = await collectLinks(page);
  const rawValues = [
    ...collected.links.map((item) => item.href),
    ...(collected.html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/")
      .match(/https?:\/\/[^"'<>\s\\]+/gi) || []),
  ];

  let directProfile: ReturnType<typeof normalizeInstagramProfile> = null;
  let officialWebsite: string | null = null;
  for (const raw of rawValues) {
    const external = unwrapExternalUrl(raw, placeUrl);
    if (!external) continue;
    directProfile ||= normalizeInstagramProfile(external);
    if (!officialWebsite && isPublicWebsite(external)) officialWebsite = external;
  }

  if (directProfile) {
    return {
      provider: "naver_place", placeId, placeUrl, searchUrl, officialWebsite,
      instagramUrl: directProfile.url, instagramUsername: directProfile.username,
      discoverySource: "naver_place", confidence: 100,
      reasons: ["네이버 장소 상세에 등록된 인스타그램 링크"],
    };
  }

  const websiteProfile = officialWebsite ? await websiteInstagram(officialWebsite) : null;
  if (websiteProfile) {
    return {
      provider: "naver_place", placeId, placeUrl, searchUrl, officialWebsite,
      instagramUrl: websiteProfile.url, instagramUsername: websiteProfile.username,
      discoverySource: "official_website", confidence: 95,
      reasons: ["네이버 장소 상세의 공식 홈페이지에서 인스타그램 링크 확인"],
    };
  }

  return {
    provider: "naver_place", placeId, placeUrl, searchUrl, officialWebsite,
    instagramUrl: null, instagramUsername: null, discoverySource: "none", confidence: 80,
    reasons: [officialWebsite ? "장소와 공식 홈페이지는 확인했지만 인스타그램 링크 없음" : "장소는 확인했지만 외부 링크 없음"],
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
  page.setDefaultTimeout(8_000);
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

function normalizeCandidateList(value: unknown): NaverCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
    .map((candidate) => ({
      provider: "naver_place" as const,
      placeId: candidate.placeId ? String(candidate.placeId) : null,
      placeUrl: candidate.placeUrl ? String(candidate.placeUrl) : null,
      searchUrl: String(candidate.searchUrl || ""),
      officialWebsite: candidate.officialWebsite ? String(candidate.officialWebsite) : null,
      instagramUrl: candidate.instagramUrl ? String(candidate.instagramUrl) : null,
      instagramUsername: candidate.instagramUsername ? String(candidate.instagramUsername) : null,
      discoverySource: ["naver_place", "official_website"].includes(String(candidate.discoverySource))
        ? (String(candidate.discoverySource) as "naver_place" | "official_website")
        : "none",
      confidence: Number(candidate.confidence || 0),
      reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map(String) : [],
    }));
}

function serializeRow(row: RestaurantRow) {
  return {
    sourceId: row.source_id,
    name: row.name,
    address: row.road_address || row.address || "",
    category: row.category || "",
    regionKey: row.region_key || "",
    instagramUrl: row.instagram_url,
    instagramUsername: row.instagram_username,
    instagramStatus: row.instagram_status || "unchecked",
    instagramSource: row.instagram_source,
    confidence: row.instagram_confidence,
    candidates: normalizeCandidateList(row.instagram_candidates),
    searchQuery: row.instagram_search_query,
    checkedAt: row.instagram_checked_at,
    naverPlaceId: row.naver_place_id,
    naverPlaceUrl: row.naver_place_url,
    officialWebsiteUrl: row.official_website_url,
  };
}

function selectedRegions(region: string | null) {
  return ACTIVE_REGIONS.includes(region as RegionKey) ? [region as RegionKey] : [...ACTIVE_REGIONS];
}

const SELECT_FIELDS =
  "source_id,name,road_address,address,latitude,longitude,phone,category,region_key,instagram_url,instagram_username,instagram_status,instagram_source,instagram_confidence,instagram_candidates,instagram_search_query,instagram_checked_at,naver_place_id,naver_place_url,official_website_url,naver_place_checked_at";

async function loadStatus(region: string | null) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 환경변수가 연결되지 않았습니다.");
  const regions = selectedRegions(region);
  const { data, error } = await supabase
    .from("public_data_restaurants")
    .select(SELECT_FIELDS)
    .in("region_key", regions)
    .order("instagram_checked_at", { ascending: false, nullsFirst: false })
    .limit(2_000);
  if (error) throw error;
  const rows = (data || []) as RestaurantRow[];
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    const key = row.instagram_status || "unchecked";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  return {
    region: regions.length === 1 ? regions[0] : "all",
    total: rows.length,
    unchecked: counts.unchecked || 0,
    candidate: counts.candidate || 0,
    verified: counts.verified || 0,
    notFound: counts.not_found || 0,
    rejected: counts.rejected || 0,
    rows: rows
      .filter((row) => row.instagram_status !== "unchecked" || row.instagram_checked_at)
      .slice(0, MAX_STATUS_ROWS)
      .map(serializeRow),
  };
}

export async function GET(request: Request) {
  try {
    const region = new URL(request.url).searchParams.get("region");
    return NextResponse.json(await loadStatus(region));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "인스타그램 현황 조회 실패" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });
    const body = (await request.json()) as {
      action?: "scan" | "verify" | "manual" | "not_found" | "reject";
      region?: string;
      limit?: number;
      retry?: boolean;
      sourceId?: string;
      url?: string;
    };
    const action = body.action || "scan";
    const region = ACTIVE_REGIONS.includes(body.region as RegionKey) ? body.region! : "all";

    if (action === "scan") {
      const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
      const targetStatus = body.retry ? "not_found" : "unchecked";
      const { data, error } = await supabase
        .from("public_data_restaurants")
        .select(SELECT_FIELDS)
        .in("region_key", selectedRegions(region))
        .eq("instagram_status", targetStatus)
        .order(body.retry ? "instagram_checked_at" : "created_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw error;
      const stores = (data || []) as RestaurantRow[];
      if (!stores.length) {
        return NextResponse.json({ processed: 0, message: "확인할 가게가 없습니다.", ...(await loadStatus(region)) });
      }

      let browser: Browser | null = null;
      let page: Page | null = null;
      let processed = 0;
      let found = 0;
      let placeResolved = 0;
      let stopped = false;
      const startedAt = Date.now();

      try {
        browser = await launchBrowser();
        page = await preparePage(browser);
        for (const store of stores) {
          if (Date.now() - startedAt > REQUEST_DEADLINE_MS) break;
          let candidate: NaverCandidate;
          try {
            candidate = await inspectNaverPlace(page, store);
          } catch (error) {
            if (error instanceof NaverBlockedError) {
              stopped = true;
              break;
            }
            candidate = {
              provider: "naver_place", placeId: null, placeUrl: null, searchUrl: naverSearchUrl(store),
              officialWebsite: null, instagramUrl: null, instagramUsername: null, discoverySource: "none",
              confidence: 0, reasons: [error instanceof Error ? error.message : "네이버 장소 확인 실패"],
            };
          }

          const now = new Date().toISOString();
          const hasInstagram = Boolean(candidate.instagramUrl && candidate.instagramUsername);
          const status = hasInstagram ? "verified" : candidate.placeId ? "not_found" : "candidate";
          const source = hasInstagram
            ? candidate.discoverySource === "official_website"
              ? "naver_official_website"
              : "naver_place_direct"
            : candidate.placeId
              ? "naver_place_no_instagram"
              : "naver_place_unmatched";

          const { error: updateError } = await supabase
            .from("public_data_restaurants")
            .update({
              instagram_url: hasInstagram ? candidate.instagramUrl : null,
              instagram_username: hasInstagram ? candidate.instagramUsername : null,
              instagram_status: status,
              instagram_source: source,
              instagram_confidence: candidate.confidence,
              instagram_candidates: [candidate],
              instagram_search_query: candidate.searchUrl,
              instagram_checked_at: now,
              naver_place_id: candidate.placeId,
              naver_place_url: candidate.placeUrl,
              official_website_url: candidate.officialWebsite,
              naver_place_checked_at: now,
              updated_at: now,
            })
            .eq("source_id", store.source_id);
          if (updateError) throw updateError;
          processed += 1;
          if (candidate.placeId) placeResolved += 1;
          if (hasInstagram) found += 1;
          await delay(650);
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
        ...(await loadStatus(region)),
      });
    }

    const sourceId = body.sourceId?.trim() || "";
    if (!sourceId) return NextResponse.json({ error: "가게 ID가 없습니다." }, { status: 400 });
    const now = new Date().toISOString();

    if (action === "verify" || action === "manual") {
      const profile = normalizeInstagramProfile(body.url?.trim() || "");
      if (!profile) return NextResponse.json({ error: "인스타그램 프로필 URL을 정확히 입력해주세요." }, { status: 400 });
      const { error } = await supabase
        .from("public_data_restaurants")
        .update({
          instagram_url: profile.url,
          instagram_username: profile.username,
          instagram_status: "verified",
          instagram_source: action === "manual" ? "manual_verified" : "naver_verified",
          instagram_checked_at: now,
          updated_at: now,
        })
        .eq("source_id", sourceId)
        .in("region_key", [...ACTIVE_REGIONS]);
      if (error) throw error;
      return NextResponse.json({ saved: true, ...(await loadStatus(region)) });
    }

    const nextStatus = action === "reject" ? "rejected" : "not_found";
    const { error } = await supabase
      .from("public_data_restaurants")
      .update({
        instagram_url: null,
        instagram_username: null,
        instagram_status: nextStatus,
        instagram_checked_at: now,
        updated_at: now,
      })
      .eq("source_id", sourceId)
      .in("region_key", [...ACTIVE_REGIONS]);
    if (error) throw error;
    return NextResponse.json({ saved: true, ...(await loadStatus(region)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "인스타그램 처리 실패" },
      { status: 500 },
    );
  }
}
