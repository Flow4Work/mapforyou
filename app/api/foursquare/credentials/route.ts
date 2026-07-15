import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_SETTING_KEY = "foursquare_places_api_key";
const FOURSQUARE_API_VERSION = process.env.FOURSQUARE_API_VERSION?.trim() || "1970-01-01";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function loadStoredKey() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { apiKey: "", updatedAt: null as string | null };

  const { data, error } = await supabase
    .from("app_settings")
    .select("value,updated_at")
    .eq("key", API_KEY_SETTING_KEY)
    .maybeSingle();

  if (error) throw error;
  return {
    apiKey: String(data?.value ?? ""),
    updatedAt: data?.updated_at ?? null,
  };
}

function foursquareHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    Authorization: apiKey,
    "X-Places-Api-Version": FOURSQUARE_API_VERSION,
  };
}

export async function GET() {
  try {
    const stored = await loadStoredKey();
    const environmentKey = process.env.FOURSQUARE_API_KEY?.trim() ?? "";

    return NextResponse.json({
      configured: Boolean(environmentKey || stored.apiKey),
      source: environmentKey ? "environment" : "admin",
      updatedAt: stored.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { configured: false, error: error instanceof Error ? error.message : "Foursquare 키 상태 조회 실패" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }

  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

    const body = (await request.json()) as { apiKey?: string };
    const apiKey = body.apiKey?.trim() ?? "";
    if (apiKey.length < 20) {
      return NextResponse.json({ error: "Foursquare Places API Key를 정확히 입력해주세요." }, { status: 400 });
    }

    const validationUrl = new URL("https://api.foursquare.com/v3/places/search");
    validationUrl.searchParams.set("query", "성수 카페");
    validationUrl.searchParams.set("ll", "37.5446,127.0557");
    validationUrl.searchParams.set("radius", "500");
    validationUrl.searchParams.set("limit", "1");
    validationUrl.searchParams.set("fields", "fsq_id,name");

    const validation = await fetch(validationUrl, {
      headers: foursquareHeaders(apiKey),
      cache: "no-store",
    });

    if (!validation.ok) {
      const payload = (await validation.json().catch(() => null)) as
        | { message?: string; error?: string; details?: string }
        | null;
      const detail = payload?.message || payload?.error || payload?.details || `HTTP ${validation.status}`;
      const message =
        validation.status === 401
          ? "Foursquare API Key 인증에 실패했습니다. Developer Console의 Places API Key인지 확인해주세요."
          : validation.status === 403
            ? "이 Foursquare 키에 Places API 사용 권한이 없습니다."
            : validation.status === 429
              ? "Foursquare API 호출 한도에 도달했습니다."
              : `Foursquare API 확인 실패: ${detail}`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert(
      { key: API_KEY_SETTING_KEY, value: apiKey, updated_at: now },
      { onConflict: "key" },
    );

    if (error) throw error;
    return NextResponse.json({ saved: true, configured: true, updatedAt: now });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Foursquare 키 저장 실패" },
      { status: 500 },
    );
  }
}
