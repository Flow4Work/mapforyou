import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

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

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const body = (await request.json()) as { name?: string; address?: string };
    const name = normalize(body.name ?? "");
    const address = normalize(body.address ?? "");
    if (!name) return NextResponse.json({ error: "가게명이 없습니다." }, { status: 400 });

    const credentials = await loadCredentials();
    if (!credentials) {
      return NextResponse.json({ error: "네이버 검색 API 키가 등록되지 않았습니다." }, { status: 503 });
    }

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
    const payload = (await response.json().catch(() => null)) as { items?: NaverItem[]; errorMessage?: string } | null;
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.errorMessage || `네이버 지역검색 실패 HTTP ${response.status}` },
        { status: response.status },
      );
    }

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
    if (!selected || selected.score < 50) {
      return NextResponse.json(
        { error: "가게명과 주소가 일치하는 네이버 지역검색 결과를 찾지 못했습니다." },
        { status: 404 },
      );
    }

    const longitude = coordinate(selected.item.mapx, "longitude");
    const latitude = coordinate(selected.item.mapy, "latitude");
    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "지역검색 결과의 좌표 형식을 확인하지 못했습니다." }, { status: 422 });
    }

    return NextResponse.json({
      place: {
        name: selected.itemName || name,
        roadAddress: selected.roadAddress || address,
        address: selected.oldAddress || selected.roadAddress || address,
        category: normalize(String(selected.item.category ?? "")),
        latitude,
        longitude,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "좌표 확인에 실패했습니다." },
      { status: 500 },
    );
  }
}
