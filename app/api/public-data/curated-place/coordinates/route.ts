import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const CLIENT_ID_SETTING_KEY = "naver_search_client_id";
const CLIENT_SECRET_SETTING_KEY = "naver_search_client_secret";

type NaverItem = {
  title?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string | number;
  mapy?: string | number;
};

type PlaceResult = {
  name?: string;
  roadAddress?: string;
  address?: string;
  category?: string;
  latitude: number;
  longitude: number;
  coordinateSource: "existing_db" | "naver_local_api" | "naver_place_page";
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

function normalize(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string) {
  return normalize(value).toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

function coordinate(value: string | number | undefined, type: "longitude" | "latitude") {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const scaled = Math.abs(raw) > 10_000_000 ? raw / 10_000_000 : raw;
  if (type === "longitude" && scaled >= 120 && scaled <= 135) return scaled;
  if (type === "latitude" && scaled >= 30 && scaled <= 40) return scaled;
  return null;
}

async function loadCredentials() {
  const envClientId = process.env.NAVER_CLIENT_ID?.trim() ?? "";
  const envClientSecret = process.env.NAVER_CLIENT_SECRET?.trim() ?? "";
  if (envClientId && envClientSecret) return { clientId: envClientId, clientSecret: envClientSecret };

  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", [CLIENT_ID_SETTING_KEY, CLIENT_SECRET_SETTING_KEY]);
  if (error) return null;

  const values = new Map<string, string>(
    (data ?? []).map((row: { key: unknown; value: unknown }) => [String(row.key), String(row.value ?? "")]),
  );
  const clientId = values.get(CLIENT_ID_SETTING_KEY)?.trim() ?? "";
  const clientSecret = values.get(CLIENT_SECRET_SETTING_KEY)?.trim() ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function findExistingPlace(placeId: string, name: string, address: string): Promise<PlaceResult | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  if (placeId) {
    const { data } = await supabase
      .from("public_data_restaurants")
      .select("name,road_address,address,category,latitude,longitude")
      .eq("naver_place_id", placeId)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(1)
      .maybeSingle();
    const latitude = coordinate(data?.latitude, "latitude");
    const longitude = coordinate(data?.longitude, "longitude");
    if (data && latitude != null && longitude != null) {
      return {
        name: data.name ?? name,
        roadAddress: data.road_address ?? address,
        address: data.address ?? data.road_address ?? address,
        category: data.category ?? "",
        latitude,
        longitude,
        coordinateSource: "existing_db",
      };
    }
  }

  if (!name) return null;
  const { data } = await supabase
    .from("public_data_restaurants")
    .select("name,road_address,address,category,latitude,longitude")
    .eq("name", name)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(10);
  const addressKey = compact(address);
  const match = (data ?? []).find((row) => {
    if (!addressKey) return true;
    const rowAddress = compact(`${row.road_address ?? ""} ${row.address ?? ""}`);
    return rowAddress.includes(addressKey.slice(0, Math.min(addressKey.length, 12)));
  });
  const latitude = coordinate(match?.latitude, "latitude");
  const longitude = coordinate(match?.longitude, "longitude");
  if (!match || latitude == null || longitude == null) return null;
  return {
    name: match.name ?? name,
    roadAddress: match.road_address ?? address,
    address: match.address ?? match.road_address ?? address,
    category: match.category ?? "",
    latitude,
    longitude,
    coordinateSource: "existing_db",
  };
}

async function searchNaverLocal(name: string, address: string): Promise<PlaceResult | null> {
  const credentials = await loadCredentials();
  if (!credentials || !name) return null;

  const url = new URL("https://openapi.naver.com/v1/search/local.json");
  url.searchParams.set("query", `${name} ${address}`.trim());
  url.searchParams.set("display", "5");
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "random");
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "X-Naver-Client-Id": credentials.clientId,
      "X-Naver-Client-Secret": credentials.clientSecret,
    },
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { items?: NaverItem[] } | null;
  const nameKey = compact(name);
  const addressKey = compact(address);
  const ranked = (payload?.items ?? [])
    .map((item) => {
      const itemName = normalize(String(item.title ?? ""));
      const roadAddress = normalize(String(item.roadAddress ?? ""));
      const oldAddress = normalize(String(item.address ?? ""));
      const addressBlob = compact(`${roadAddress} ${oldAddress}`);
      let score = 0;
      if (nameKey && compact(itemName).includes(nameKey)) score += 70;
      if (addressKey && addressBlob.includes(addressKey.slice(0, Math.min(addressKey.length, 12)))) score += 30;
      return { item, itemName, roadAddress, oldAddress, score };
    })
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  if (!selected || selected.score < 50) return null;

  const longitude = coordinate(selected.item.mapx, "longitude");
  const latitude = coordinate(selected.item.mapy, "latitude");
  if (latitude == null || longitude == null) return null;
  return {
    name: selected.itemName || name,
    roadAddress: selected.roadAddress || address,
    address: selected.oldAddress || selected.roadAddress || address,
    category: normalize(String(selected.item.category ?? "")),
    latitude,
    longitude,
    coordinateSource: "naver_local_api",
  };
}

function valuesForKeys(html: string, keys: string[]) {
  const values: number[] = [];
  for (const key of keys) {
    const patterns = [
      new RegExp(`"${key}"\\s*:\\s*"?(-?\\d{2,3}\\.\\d+)`, "gi"),
      new RegExp(`\\\\"${key}\\\\"\\s*:\\s*\\\\"?(-?\\d{2,3}\\.\\d+)`, "gi"),
    ];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) values.push(value);
      }
    }
  }
  return values;
}

async function launchBrowser() {
  chromium.setGraphicsMode = false;
  return await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1100, height: 850, deviceScaleFactor: 1 },
  });
}

async function preparePage(browser: Browser) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(14_000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  );
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (["image", "media", "font"].includes(request.resourceType())) request.abort();
    else request.continue();
  });
  return page;
}

async function inspectNaverPage(placeId: string): Promise<PlaceResult | null> {
  if (!placeId) return null;
  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    browser = await launchBrowser();
    page = await preparePage(browser);
    await page.goto(`https://map.naver.com/p/entry/place/${placeId}`, { waitUntil: "domcontentloaded", timeout: 14_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_400));

    const htmlChunks: string[] = [];
    const textChunks: string[] = [];
    for (const frame of page.frames()) {
      try {
        htmlChunks.push((await frame.content()).slice(0, 900_000));
        textChunks.push(await frame.evaluate(() => (document.body?.innerText || "").slice(0, 30_000)));
      } catch {
        // Ignore detached frames.
      }
    }
    const html = htmlChunks.join("\n").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    const latitudes = valuesForKeys(html, ["latitude", "lat", "y"]).filter((value) => value >= 30 && value <= 40);
    const longitudes = valuesForKeys(html, ["longitude", "lng", "lon", "x"]).filter((value) => value >= 120 && value <= 135);
    const latitude = latitudes[0];
    const longitude = longitudes[0];
    if (!latitude || !longitude) return null;

    const lines = textChunks.join("\n").split(/\n+/).map(normalize).filter(Boolean);
    const roadAddress = lines.find((line) => /서울(?:특별시)?\s+[^\s]+구\s+/.test(line) && /(?:로|길)\b/.test(line)) ?? "";
    return {
      roadAddress,
      address: roadAddress,
      latitude,
      longitude,
      coordinateSource: "naver_place_page",
    };
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const body = (await request.json()) as { name?: string; address?: string; placeId?: string };
    const name = normalize(body.name ?? "");
    const address = normalize(body.address ?? "");
    const placeId = String(body.placeId ?? "").replace(/\D/g, "");
    if (!name && !placeId) return NextResponse.json({ error: "가게명 또는 네이버 장소 ID가 필요합니다." }, { status: 400 });

    const existing = await findExistingPlace(placeId, name, address);
    if (existing) return NextResponse.json({ place: existing });

    const local = await searchNaverLocal(name, address);
    if (local) return NextResponse.json({ place: local });

    const pagePlace = await inspectNaverPage(placeId);
    if (pagePlace) {
      return NextResponse.json({
        place: { ...pagePlace, name, roadAddress: pagePlace.roadAddress || address },
      });
    }

    return NextResponse.json(
      { error: "기존 DB·네이버 지역검색·네이버 장소 페이지에서 지도 좌표를 확인하지 못했습니다." },
      { status: 404 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "좌표 확인에 실패했습니다." },
      { status: 500 },
    );
  }
}
