import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAVIGATION_TIMEOUT_MS = 15_000;
const RESERVED_INSTAGRAM_PATHS = new Set([
  "about", "accounts", "challenge", "developer", "direct", "directory", "emails", "explore",
  "legal", "p", "press", "privacy", "reel", "reels", "stories", "terms", "tv", "web",
]);

type MenuDraft = {
  nameKo: string;
  price: number;
  sourceText?: string;
};

type PreviewResult = {
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
  menus: MenuDraft[];
  warnings: string[];
};

type SaveBody = PreviewResult & {
  action: "save";
  regionKey?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  publish?: boolean;
};

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

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractPlaceId(value: string) {
  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original value.
  }
  const patterns = [
    /\/entry\/place\/(\d{5,})/i,
    /pcmap\.place\.naver\.com\/(?:restaurant|cafe|place|hospital|hairshop|nailshop|accommodation)\/(\d{5,})/i,
    /[?&](?:placeId|id)=(\d{5,})/i,
    /^(\d{5,})$/,
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

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanName(value: string) {
  return normalizeSpace(value)
    .replace(/\s*[:|\-–]\s*네이버(?:\s*지도|\s*플레이스)?\s*$/i, "")
    .replace(/\s*네이버(?:\s*지도|\s*플레이스)?\s*$/i, "")
    .trim();
}

function likelyAddress(lines: string[]) {
  return lines.find((line) => {
    const value = normalizeSpace(line);
    return value.length >= 10 && value.length <= 130 && /서울(?:특별시)?\s+[^\s]+구\s+/.test(value) && /(?:로|길|동|가)\b/.test(value);
  }) ?? "";
}

function likelyPhone(lines: string[]) {
  const text = lines.join("\n");
  return text.match(/(?:02|0[3-9]\d)-?\d{3,4}-?\d{4}/)?.[0] ?? "";
}

function parseMenuLines(text: string) {
  const rawLines = text
    .split(/\n+/)
    .map(normalizeSpace)
    .filter((line) => line.length >= 1 && line.length <= 140);
  const excluded = /^(메뉴|홈|소식|리뷰|사진|지도|주문|예약|저장|공유|전화|영업시간|편의|정보|결제수단|가격표)$/;
  const pricePattern = /(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,6})\s*원?/;
  const results = new Map<string, MenuDraft>();

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const match = line.match(pricePattern);
    let name = "";
    let price = 0;
    let sourceText = line;

    if (match) {
      price = Number(match[1].replace(/,/g, ""));
      name = normalizeSpace(line.replace(match[0], "").replace(/[·|:：-]+$/, ""));
      if (!name && index > 0) name = rawLines[index - 1];
    } else if (index + 1 < rawLines.length) {
      const nextMatch = rawLines[index + 1].match(new RegExp(`^${pricePattern.source}$`));
      if (nextMatch) {
        name = line;
        price = Number(nextMatch[1].replace(/,/g, ""));
        sourceText = `${line} ${rawLines[index + 1]}`;
      }
    }

    name = normalizeSpace(name.replace(/^(대표|인기|추천)\s*/g, ""));
    if (!name || excluded.test(name) || name.length < 2 || name.length > 70) continue;
    if (!price || price < 500 || price > 1_000_000) continue;
    if (/주소|영업|리뷰|주차|예약|전화|방문자|블로그/.test(name)) continue;

    const key = `${name.toLowerCase()}:${price}`;
    if (!results.has(key)) results.set(key, { nameKo: name, price, sourceText });
    if (results.size >= 30) break;
  }

  return [...results.values()];
}

async function launchBrowser() {
  chromium.setGraphicsMode = false;
  return await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1280, height: 1000, deviceScaleFactor: 1 },
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

async function collectSnapshot(page: Page) {
  const titles: string[] = [];
  const descriptions: string[] = [];
  const headings: string[] = [];
  const texts: string[] = [];
  const links: string[] = [];

  for (const frame of page.frames()) {
    try {
      const snapshot = await frame.evaluate(() => ({
        title: document.title || "",
        ogTitle: document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content || "",
        description:
          document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ||
          document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
          "",
        headings: Array.from(document.querySelectorAll<HTMLElement>('h1,h2,[role="heading"]'))
          .slice(0, 80)
          .map((element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean),
        text: (document.body?.innerText || "").slice(0, 180_000),
        links: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .slice(0, 1600)
          .map((anchor) => anchor.href),
      }));
      titles.push(snapshot.ogTitle, snapshot.title);
      descriptions.push(snapshot.description);
      headings.push(...snapshot.headings);
      texts.push(snapshot.text);
      links.push(...snapshot.links);
    } catch {
      // Ignore detached or cross-origin frames.
    }
  }

  return { titles, descriptions, headings, texts, links };
}

async function clickMenuTab(page: Page) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(() => {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('a,button,[role="button"],[role="tab"]'));
        const target = elements.find((element) => {
          const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
          return text === "메뉴" || text === "메뉴판" || /^메뉴\s*\d*$/.test(text);
        });
        if (!target) return false;
        target.click();
        return true;
      });
      if (clicked) return true;
    } catch {
      // Try the next frame.
    }
  }
  return false;
}

function firstInstagram(values: string[]) {
  for (const value of values) {
    const direct = normalizeInstagramProfile(value);
    if (direct) return direct;
    const matches = value.match(/https?:\/\/(?:www\.|m\.)?instagram\.com\/[a-z0-9._]+/gi) ?? [];
    for (const match of matches) {
      const profile = normalizeInstagramProfile(match);
      if (profile) return profile;
    }
  }
  return null;
}

function firstOfficialWebsite(links: string[]) {
  for (const value of links) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (!/^https?:$/.test(url.protocol)) continue;
      if (["naver.com", "naver.me", "instagram.com", "facebook.com", "youtube.com", "x.com"].some(
        (excluded) => host === excluded || host.endsWith(`.${excluded}`),
      )) continue;
      return url.toString();
    } catch {
      // Ignore malformed links.
    }
  }
  return "";
}

async function previewNaverPlace(rawUrl: string): Promise<PreviewResult> {
  const input = rawUrl.trim();
  if (!input) throw new Error("네이버 장소 URL 또는 장소 ID를 입력해주세요.");

  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    browser = await launchBrowser();
    page = await preparePage(browser);

    const initialUrl = /^\d{5,}$/.test(input) ? `https://map.naver.com/p/entry/place/${input}` : input;
    await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await delay(1_500);

    const placeId = extractPlaceId(page.url()) || page.frames().map((frame) => extractPlaceId(frame.url())).find(Boolean) || extractPlaceId(input);
    if (!placeId) throw new Error("네이버 장소 ID를 확인하지 못했습니다. 검색 결과가 아닌 가게 상세 URL을 넣어주세요.");

    const canonicalUrl = `https://map.naver.com/p/entry/place/${placeId}`;
    if (!page.url().includes(`/entry/place/${placeId}`)) {
      await page.goto(canonicalUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      await delay(1_400);
    }

    const base = await collectSnapshot(page);
    const menuClicked = await clickMenuTab(page);
    if (menuClicked) await delay(1_500);
    const menuSnapshot = menuClicked ? await collectSnapshot(page) : base;

    const allLines = [...base.texts, ...menuSnapshot.texts]
      .join("\n")
      .split(/\n+/)
      .map(normalizeSpace)
      .filter(Boolean);
    const titleCandidates = [...base.titles, ...base.headings]
      .map(cleanName)
      .filter((value) => value && !/^(네이버|지도|메뉴|홈|리뷰|사진)$/.test(value));
    const name = titleCandidates.find((value) => value.length >= 2 && value.length <= 80) ?? "";
    const roadAddress = likelyAddress(allLines);
    const phone = likelyPhone(allLines);
    const introduction = normalizeSpace(base.descriptions.find(Boolean) ?? "").slice(0, 300);
    const instagram = firstInstagram([...base.links, ...menuSnapshot.links, ...base.texts]);
    const officialWebsiteUrl = firstOfficialWebsite([...base.links, ...menuSnapshot.links]);
    const menus = parseMenuLines(menuSnapshot.texts.join("\n"));
    const warnings: string[] = [];
    if (!name) warnings.push("가게명을 자동으로 확정하지 못했습니다.");
    if (!roadAddress) warnings.push("주소를 자동으로 확정하지 못했습니다.");
    if (!instagram) warnings.push("네이버 장소에서 공식 인스타그램 링크를 찾지 못했습니다.");
    if (!menus.length) warnings.push("텍스트형 메뉴를 찾지 못했습니다. 메뉴판을 직접 입력해주세요.");

    return {
      sourceId: `naver:${placeId}`,
      naverPlaceId: placeId,
      naverPlaceUrl: canonicalUrl,
      name,
      roadAddress,
      address: roadAddress,
      phone,
      category: "",
      introduction,
      instagramUrl: instagram?.url ?? "",
      instagramUsername: instagram?.username ?? "",
      officialWebsiteUrl,
      menus,
      warnings,
    };
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
}

async function saveCuratedPlace(body: SaveBody) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 환경변수가 연결되지 않았습니다.");

  const sourceId = body.sourceId?.trim() || (body.naverPlaceId ? `naver:${body.naverPlaceId}` : "");
  const name = normalizeSpace(body.name || "");
  const roadAddress = normalizeSpace(body.roadAddress || body.address || "");
  const menus = (body.menus ?? [])
    .map((menu) => ({ nameKo: normalizeSpace(menu.nameKo || ""), price: Number(menu.price || 0) }))
    .filter((menu) => menu.nameKo && menu.price > 0)
    .slice(0, 40);
  const instagram = normalizeInstagramProfile(body.instagramUrl || body.instagramUsername || "");
  const publish = Boolean(body.publish);

  if (!sourceId || !body.naverPlaceId) throw new Error("네이버 장소 ID가 없습니다.");
  if (!name) throw new Error("가게명을 입력해주세요.");
  if (!roadAddress) throw new Error("주소를 입력해주세요.");
  if (publish && !instagram) throw new Error("공개하려면 공식 인스타그램을 확인해주세요.");
  if (publish && !menus.length) throw new Error("공개하려면 메뉴를 한 개 이상 입력해주세요.");

  const now = new Date().toISOString();
  const introduction = normalizeSpace(body.introduction || "") || `${name}의 메뉴와 공식 정보를 관리자가 직접 확인했습니다.`;
  const { error: restaurantError } = await supabase.from("public_data_restaurants").upsert({
    source_id: sourceId,
    name,
    road_address: roadAddress,
    address: normalizeSpace(body.address || roadAddress),
    latitude: numberOrNull(body.latitude),
    longitude: numberOrNull(body.longitude),
    phone: normalizeSpace(body.phone || "") || null,
    category: normalizeSpace(body.category || "") || null,
    introduction,
    region_key: body.regionKey === "hongdae" ? "hongdae" : "seongsu",
    search_keyword: "popular_curated",
    instagram_url: instagram?.url ?? null,
    instagram_username: instagram?.username ?? null,
    instagram_status: instagram ? "verified" : "not_found",
    instagram_source: instagram ? "curated_place" : "curated_missing",
    instagram_confidence: instagram ? 100 : 0,
    instagram_checked_at: now,
    naver_place_id: body.naverPlaceId,
    naver_place_url: body.naverPlaceUrl || `https://map.naver.com/p/entry/place/${body.naverPlaceId}`,
    official_website_url: body.officialWebsiteUrl || null,
    naver_place_checked_at: now,
    publish_status: publish ? "published" : "draft",
    source_checked_at: now,
    updated_at: now,
  }, { onConflict: "source_id" });
  if (restaurantError) throw restaurantError;

  const { error: deleteError } = await supabase.from("public_data_menus").delete().eq("restaurant_id", sourceId);
  if (deleteError) throw deleteError;

  const menuRows = menus.map((menu, index) => ({
    menu_id: `${sourceId}:curated:${index + 1}`,
    restaurant_id: sourceId,
    sort_order: index,
    name_ko: menu.nameKo,
    name_en: null,
    name_ja: null,
    price: menu.price,
    is_specialty: index < 3,
    updated_at: now,
  }));
  if (menuRows.length) {
    const { error: menuError } = await supabase.from("public_data_menus").upsert(menuRows, { onConflict: "menu_id" });
    if (menuError) throw menuError;
  }

  const [{ data: savedRestaurant, error: readRestaurantError }, { data: savedMenus, error: readMenusError }] = await Promise.all([
    supabase
      .from("public_data_restaurants")
      .select("source_id,name,road_address,instagram_url,publish_status,naver_place_id,updated_at")
      .eq("source_id", sourceId)
      .maybeSingle(),
    supabase
      .from("public_data_menus")
      .select("menu_id,name_ko,price")
      .eq("restaurant_id", sourceId)
      .order("sort_order", { ascending: true }),
  ]);
  if (readRestaurantError) throw readRestaurantError;
  if (readMenusError) throw readMenusError;

  const menuCount = savedMenus?.length ?? 0;
  return {
    saved: true,
    sourceId,
    restaurant: savedRestaurant,
    menus: savedMenus ?? [],
    test: {
      restaurantSaved: Boolean(savedRestaurant?.source_id),
      addressSaved: Boolean(savedRestaurant?.road_address),
      instagramSaved: Boolean(savedRestaurant?.instagram_url),
      menuCount,
      publishStatus: savedRestaurant?.publish_status ?? "draft",
      readyForPublic: Boolean(savedRestaurant?.source_id && savedRestaurant?.road_address && savedRestaurant?.instagram_url && menuCount > 0),
    },
  };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const body = (await request.json()) as { action?: "preview" | "save"; url?: string } | SaveBody;
    if (body.action === "save") return NextResponse.json(await saveCuratedPlace(body as SaveBody));
    const url = "url" in body ? body.url ?? "" : "";
    return NextResponse.json({ preview: await previewNaverPlace(url) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "가게 확인에 실패했습니다." },
      { status: 500 },
    );
  }
}
