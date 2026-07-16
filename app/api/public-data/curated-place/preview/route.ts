import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about", "accounts", "challenge", "developer", "direct", "directory", "emails", "explore",
  "legal", "p", "press", "privacy", "reel", "reels", "stories", "terms", "tv", "web",
]);

type MenuDraft = {
  nameKo: string;
  price: number;
  sourceText?: string;
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

function normalizeSpace(value: string) {
  return value.replace(/\\n|\\r|\\t/g, " ").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
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

function decodeHtmlState(html: string) {
  return html
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003C/gi, "<")
    .replace(/\\u003E/gi, ">");
}

function stringField(blob: string, key: string) {
  const match = blob.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
  if (!match?.[1]) return "";
  return normalizeSpace(match[1].replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
}

function numericField(blob: string, key: string) {
  const value = stringField(blob, key) || blob.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"))?.[1] || "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function restaurantBlob(html: string, placeId: string) {
  const marker = `"Restaurant:${placeId}"`;
  const start = html.indexOf(marker);
  if (start < 0) return html;
  const nextEntity = html.indexOf(`,"`, start + marker.length);
  return html.slice(start, nextEntity > start ? Math.min(nextEntity + 1, start + 80_000) : start + 80_000);
}

function normalizeInstagram(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`;
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

function findInstagram(html: string) {
  const matches = html.match(/https?:\/\/(?:www\.|m\.)?instagram\.com\/[a-z0-9._]+/gi) ?? [];
  for (const match of matches) {
    const profile = normalizeInstagram(match);
    if (profile) return profile;
  }
  return null;
}

function findOfficialWebsite(html: string) {
  const matches = html.match(/"(?:url|landingUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/gi) ?? [];
  for (const raw of matches) {
    const value = raw.match(/"(https?:\/\/[^"\\]+)"\s*$/i)?.[1];
    if (!value) continue;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (["naver.com", "naver.me", "instagram.com", "facebook.com", "youtube.com", "youtu.be", "x.com", "twitter.com"].some(
        (excluded) => host === excluded || host.endsWith(`.${excluded}`),
      )) continue;
      return url.toString();
    } catch {
      // Ignore malformed links.
    }
  }
  return "";
}

function parseMenus(html: string, placeId: string): MenuDraft[] {
  const results = new Map<string, MenuDraft>();
  const marker = new RegExp(`"Menu:${placeId}_[^"]+"\\s*:\\s*\\{`, "g");
  for (const match of html.matchAll(marker)) {
    const start = match.index ?? 0;
    const blob = html.slice(start, start + 2_500);
    const nameKo = stringField(blob, "name");
    const price = numericField(blob, "price") ?? 0;
    if (!nameKo || price <= 0 || price > 1_000_000) continue;
    const key = `${nameKo.toLowerCase()}:${price}`;
    if (!results.has(key)) results.set(key, { nameKo, price, sourceText: blob.slice(0, 300) });
    if (results.size >= 40) break;
  }
  return [...results.values()];
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const body = (await request.json()) as { url?: string };
    const placeId = extractPlaceId(body.url ?? "");
    if (!placeId) return NextResponse.json({ error: "네이버 장소 상세 URL 또는 장소 ID를 입력해주세요." }, { status: 400 });

    const detailUrl = `https://pcmap.place.naver.com/place/${placeId}/home`;
    const response = await fetch(detailUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: `네이버 장소 상세 조회 실패 HTTP ${response.status}` }, { status: 502 });
    }

    const html = decodeHtmlState((await response.text()).slice(0, 2_000_000));
    const store = restaurantBlob(html, placeId);
    const name = stringField(store, "name");
    const roadAddress = stringField(store, "roadAddress");
    const address = stringField(store, "address") || roadAddress;
    const phone = stringField(store, "phone");
    const category = stringField(store, "category") || stringField(store, "categoryName");
    const introduction = stringField(store, "description") || stringField(store, "microReview");
    const latitude = numericField(store, "y");
    const longitude = numericField(store, "x");
    const instagram = findInstagram(html);
    const officialWebsiteUrl = findOfficialWebsite(html);
    const menus = parseMenus(html, placeId);
    const warnings: string[] = [];
    if (!name) warnings.push("가게명을 자동으로 확정하지 못했습니다.");
    if (!roadAddress) warnings.push("주소를 자동으로 확정하지 못했습니다.");
    if (!instagram) warnings.push("공식 인스타그램 링크를 찾지 못했습니다.");
    if (!menus.length) warnings.push("텍스트형 메뉴를 찾지 못했습니다. 메뉴판을 직접 입력해주세요.");
    if (latitude == null || longitude == null) warnings.push("지도 좌표를 자동으로 확인하지 못했습니다.");

    return NextResponse.json({
      preview: {
        sourceId: `naver:${placeId}`,
        naverPlaceId: placeId,
        naverPlaceUrl: `https://map.naver.com/p/entry/place/${placeId}`,
        name,
        roadAddress,
        address,
        phone,
        category,
        introduction,
        instagramUrl: instagram?.url ?? "",
        instagramUsername: instagram?.username ?? "",
        officialWebsiteUrl,
        latitude,
        longitude,
        menus,
        warnings,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "네이버 장소 미리보기에 실패했습니다." },
      { status: 500 },
    );
  }
}
