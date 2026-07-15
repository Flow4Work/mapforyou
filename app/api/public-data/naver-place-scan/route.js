import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGIONS = ["seongsu", "hongdae"];
const MAX_BATCH_SIZE = 10;
const DEADLINE_MS = 52_000;
const NAV_TIMEOUT_MS = 13_000;
const BLOCK_PATTERN = /자동입력|비정상적인 접근|접근이 제한|서비스 이용이 제한|요청이 차단/i;
const DETAIL_FRAME_PATTERN = /pcmap\.place\.naver\.com\/(?:restaurant|cafe|place|hospital|hairshop|nailshop|accommodation)\/(\d{5,})\//i;

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about", "accounts", "challenge", "developer", "direct", "directory", "emails", "explore",
  "legal", "p", "press", "privacy", "reel", "reels", "stories", "terms", "tv", "web",
]);
const EXCLUDED_WEBSITE_HOSTS = [
  "naver.com", "naver.me", "instagram.com", "facebook.com", "youtube.com", "youtu.be",
  "twitter.com", "x.com", "blog.naver.com", "booking.naver.com", "smartplace.naver.com",
];

class NaverBlockedError extends Error {
  constructor() {
    super("네이버 접근 제한이 감지됐습니다.");
    this.name = "NaverBlockedError";
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function compact(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/&amp;/gi, "&")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function cleanName(value) {
  return String(value || "").replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

function shortName(value) {
  return compact(cleanName(value).replace(/(?:성수점|홍대점|연남점|서울숲점|본점|직영점|지점)$/g, ""));
}

function addressHints(value) {
  const parts = String(value || "").split(/\s+/).map(compact).filter((part) => part.length >= 2);
  const preferred = parts.filter((part) => /(?:구|동|가)$/.test(part) || /(?:로|길)\d*/.test(part));
  return [...new Set([...preferred, ...parts.slice(-4)])].slice(0, 7);
}

function targetRegions(region) {
  return REGIONS.includes(region) ? [region] : [...REGIONS];
}

function searchUrl(row) {
  const query = `${cleanName(row.name)} ${row.road_address || row.address || ""}`.trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function extractPlaceId(value) {
  let decoded = String(value || "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep original value.
  }
  const patterns = [
    /\/api\/place\/(?:marker|type)\/(\d{5,})/i,
    /\/place\/(\d{5,})(?:[/?#]|$)/i,
    /\/entry\/place\/(\d{5,})/i,
    DETAIL_FRAME_PATTERN,
    /[?&](?:placeId|id)=(\d{5,})/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function instagramProfile(value) {
  const raw = String(value || "").trim().replace(/&amp;/gi, "&");
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`);
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host !== "instagram.com") return null;
    const username = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    if (!username || RESERVED_INSTAGRAM_PATHS.has(username) || !/^[a-z0-9._]{1,30}$/.test(username)) return null;
    return { username, url: `https://www.instagram.com/${username}/` };
  } catch {
    return null;
  }
}

function externalUrl(rawValue, baseUrl) {
  const raw = String(rawValue || "").trim().replace(/&amp;/gi, "&");
  if (!raw || /^(javascript:|mailto:|tel:|data:)/i.test(raw)) return null;
  try {
    let url = new URL(raw, baseUrl);
    for (let depth = 0; depth < 3; depth += 1) {
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

function publicWebsite(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    return !EXCLUDED_WEBSITE_HOSTS.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
  } catch {
    return false;
  }
}

async function blocked(page) {
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

async function waitSearchFrame(page, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((item) => item.url().includes("pcmap.place.naver.com/place/list"));
    if (frame) {
      try {
        if ((await frame.evaluate(() => document.body?.innerText || "")).trim()) return frame;
      } catch {
        // Retry while rendering.
      }
    }
    await delay(250);
  }
  return null;
}

async function findBestResult(frame, row) {
  const full = compact(cleanName(row.name));
  const short = shortName(row.name);
  const hints = addressHints(row.road_address || row.address || "");
  const phone = String(row.phone || "").replace(/\D/g, "");

  return frame.evaluate(({ full, short, hints, phone }) => {
    const normalize = (value) => String(value || "")
      .toLocaleLowerCase("ko-KR")
      .replace(/&amp;/gi, "&")
      .replace(/[^0-9a-z가-힣]/g, "");

    const findBusinessId = (element) => {
      const nodes = [];
      let node = element;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) nodes.push(node);
      const seen = new WeakSet();
      let found = null;
      const walk = (value, depth) => {
        if (found || depth > 8 || value == null || (typeof value !== "object" && typeof value !== "function")) return;
        if (seen.has(value)) return;
        seen.add(value);
        for (const key of Object.keys(value)) {
          let child;
          try { child = value[key]; } catch { continue; }
          if (/^(?:businessId|placeId)$/i.test(key) && /^\d{5,}$/.test(String(child || ""))) {
            found = String(child);
            return;
          }
          if (child && (typeof child === "object" || typeof child === "function")) walk(child, depth + 1);
          if (found) return;
        }
      };
      for (const item of nodes) {
        for (const key of Object.keys(item).filter((key) => key.startsWith("__react"))) {
          walk(item[key], 0);
          if (found) return found;
        }
      }
      return null;
    };

    let best = null;
    for (const anchor of Array.from(document.querySelectorAll("a[role='button'],a[href]"))) {
      const title = (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim();
      if (!title || title.length > 160) continue;
      const container = anchor.closest("li") || anchor.parentElement;
      const text = (container?.innerText || title).replace(/\s+/g, " ").trim();
      const titleBlob = normalize(title);
      const textBlob = normalize(text);
      let score = 0;

      if (full.length >= 2 && titleBlob.includes(full)) score += 110;
      else if (full.length >= 2 && textBlob.includes(full)) score += 90;
      else if (short.length >= 2 && titleBlob.includes(short)) score += 60;
      else if (short.length >= 2 && textBlob.includes(short)) score += 50;
      else continue;

      score += Math.min(30, hints.filter((hint) => textBlob.includes(hint)).length * 10);
      if (phone.length >= 8 && textBlob.includes(phone)) score += 20;
      if (/출발|도착|상세주소/.test(text)) score += 5;
      if (!best || score > best.score) best = { anchor, score, text: text.slice(0, 500) };
    }

    if (!best || best.score < 60) return { score: best?.score || 0, text: best?.text || "", placeId: null };
    return { score: best.score, text: best.text, placeId: findBusinessId(best.anchor) };
  }, { full, short, hints, phone });
}

async function resolvePlaceId(page, row) {
  const url = searchUrl(row);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await delay(2_000);
  if (await blocked(page)) throw new NaverBlockedError();

  const frame = await waitSearchFrame(page);
  if (!frame) return { placeId: null, searchUrl: url, score: 0, text: "검색 결과를 불러오지 못함" };
  const result = await findBestResult(frame, row);
  return { placeId: result.placeId, searchUrl: url, score: result.score, text: result.text };
}

async function waitDetailFrame(page, placeId, timeoutMs = 9_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((item) => {
      const match = item.url().match(DETAIL_FRAME_PATTERN);
      return match?.[1] === placeId;
    });
    if (frame) {
      try {
        const ready = await frame.evaluate(() => {
          const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
          return text.length > 250 && /주소|전화번호|영업시간|홈페이지/.test(text);
        });
        if (ready) {
          await delay(1_500);
          return frame;
        }
      } catch {
        // Retry while rendering.
      }
    }
    await delay(250);
  }
  return null;
}

async function readPlaceLinks(page, placeId) {
  const placeUrl = `https://map.naver.com/p/entry/place/${placeId}`;
  await page.goto(placeUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const frame = await waitDetailFrame(page, placeId);
  if (!frame) return { placeUrl, instagram: null, website: null };
  if (await blocked(page)) throw new NaverBlockedError();

  const { links, html } = await frame.evaluate(() => ({
    links: Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 1500)
      .map((anchor) => ({
        href: anchor.href,
        text: (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
      })),
    html: document.documentElement.outerHTML.slice(0, 1_200_000),
  }));

  let instagram = null;
  const websites = [];
  for (const link of links) {
    const external = externalUrl(link.href, placeUrl);
    if (!external) continue;
    instagram ||= instagramProfile(external);
    if (publicWebsite(external)) websites.push({ url: external, priority: /홈페이지|website|공식/i.test(link.text) ? 1 : 0 });
  }

  const decodedHtml = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  for (const match of decodedHtml.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]+/gi) || []) {
    instagram ||= instagramProfile(match);
  }
  websites.sort((a, b) => b.priority - a.priority);
  return { placeUrl, instagram, website: websites[0]?.url || null };
}

async function websiteInstagram(website) {
  if (!publicWebsite(website)) return null;
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
    const html = (await response.text()).slice(0, 1_200_000).replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    for (const match of html.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]+/gi) || []) {
      const profile = instagramProfile(match);
      if (profile) return profile;
    }
  } catch {
    return null;
  }
  return null;
}

async function inspectStore(page, row) {
  const resolved = await resolvePlaceId(page, row);
  if (!resolved.placeId) {
    return {
      placeId: null,
      placeUrl: null,
      searchUrl: resolved.searchUrl,
      website: null,
      instagram: null,
      source: "none",
      confidence: Math.min(resolved.score, 70),
      reasons: [resolved.text || "상호명과 주소가 맞는 네이버 장소를 확인하지 못함"],
    };
  }

  const detail = await readPlaceLinks(page, resolved.placeId);
  if (detail.instagram) {
    return {
      placeId: resolved.placeId,
      placeUrl: detail.placeUrl,
      searchUrl: resolved.searchUrl,
      website: detail.website,
      instagram: detail.instagram,
      source: "naver_place",
      confidence: 100,
      reasons: ["네이버 장소 상세에 등록된 인스타그램 링크", resolved.text],
    };
  }

  const websiteProfile = detail.website ? await websiteInstagram(detail.website) : null;
  if (websiteProfile) {
    return {
      placeId: resolved.placeId,
      placeUrl: detail.placeUrl,
      searchUrl: resolved.searchUrl,
      website: detail.website,
      instagram: websiteProfile,
      source: "official_website",
      confidence: 95,
      reasons: ["네이버 장소의 공식 홈페이지에서 인스타그램 링크 확인", resolved.text],
    };
  }

  return {
    placeId: resolved.placeId,
    placeUrl: detail.placeUrl,
    searchUrl: resolved.searchUrl,
    website: detail.website,
    instagram: null,
    source: "none",
    confidence: 85,
    reasons: [detail.website ? "공식 홈페이지는 확인했지만 인스타그램 링크 없음" : "장소는 확인했지만 외부 링크 없음", resolved.text],
  };
}

async function launchBrowser() {
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
  });
}

async function preparePage(browser) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(9_000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });
  return page;
}

export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

  try {
    const body = await request.json();
    const region = REGIONS.includes(body.region) ? body.region : "all";
    const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const statuses = body.retry ? ["not_found", "candidate"] : ["unchecked"];

    let query = supabase
      .from("public_data_restaurants")
      .select("source_id,name,road_address,address,latitude,longitude,phone,category,region_key")
      .in("region_key", targetRegions(region));
    if (body.sourceId) {
      query = query.eq("source_id", String(body.sourceId)).limit(1);
    } else {
      query = query
        .in("instagram_status", statuses)
        .order(body.retry ? "instagram_checked_at" : "created_at", { ascending: true, nullsFirst: true })
        .limit(limit);
    }
    const { data, error } = await query;
    if (error) throw error;
    const stores = data || [];
    if (!stores.length) return NextResponse.json({ processed: 0, message: "확인할 가게가 없습니다." });

    let browser = null;
    let page = null;
    let processed = 0;
    let placeResolved = 0;
    let found = 0;
    let stopped = false;
    const startedAt = Date.now();

    try {
      browser = await launchBrowser();
      page = await preparePage(browser);
      for (const store of stores) {
        if (Date.now() - startedAt > DEADLINE_MS) break;
        let result;
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
            searchUrl: searchUrl(store),
            website: null,
            instagram: null,
            source: "none",
            confidence: 0,
            reasons: [scanError instanceof Error ? scanError.message : "네이버 장소 확인 실패"],
          };
        }

        const now = new Date().toISOString();
        const hasInstagram = Boolean(result.instagram?.url && result.instagram?.username);
        const status = hasInstagram ? "verified" : result.placeId ? "not_found" : "candidate";
        const source = hasInstagram
          ? result.source === "official_website" ? "naver_official_website" : "naver_place_direct"
          : result.placeId ? "naver_place_no_instagram" : "naver_place_unmatched";
        const candidate = {
          provider: "naver_place",
          placeId: result.placeId,
          placeUrl: result.placeUrl,
          searchUrl: result.searchUrl,
          officialWebsite: result.website,
          instagramUrl: result.instagram?.url || null,
          instagramUsername: result.instagram?.username || null,
          discoverySource: result.source,
          confidence: result.confidence,
          reasons: result.reasons,
        };

        const { error: updateError } = await supabase
          .from("public_data_restaurants")
          .update({
            instagram_url: result.instagram?.url || null,
            instagram_username: result.instagram?.username || null,
            instagram_status: status,
            instagram_source: source,
            instagram_confidence: result.confidence,
            instagram_candidates: [candidate],
            instagram_search_query: result.searchUrl,
            instagram_checked_at: now,
            naver_place_id: result.placeId,
            naver_place_url: result.placeUrl,
            official_website_url: result.website,
            naver_place_checked_at: now,
            updated_at: now,
          })
          .eq("source_id", store.source_id);
        if (updateError) throw updateError;

        processed += 1;
        if (result.placeId) placeResolved += 1;
        if (hasInstagram) found += 1;
        await delay(500);
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
