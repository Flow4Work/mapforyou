import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

const BASE_URL = "https://seoul.openapi.redtable.global";
const TOKEN_SETTING_KEY = "seoul_tourism_api_token";

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ connected: false, error: "Supabase 환경변수 없음" }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", TOKEN_SETTING_KEY)
      .maybeSingle();

    if (error || !data?.value) {
      return NextResponse.json({ connected: false, error: error?.message || "저장된 API 토큰 없음" }, { status: 503 });
    }

    const url = new URL("/api/rstr", BASE_URL);
    url.searchParams.set("serviceKey", String(data.value));
    url.searchParams.set("pageNo", "1");

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return NextResponse.json({ connected: false, upstreamStatus: response.status }, { status: 502 });
    }

    const payload = await response.json() as {
      header?: { resultCode?: string; resultMsg?: string; totalCount?: number; numOfRows?: number };
      body?: Array<{ RSTR_ID?: string | number }>;
    };

    const ok = !payload.header?.resultCode || payload.header.resultCode === "00";
    return NextResponse.json({
      connected: ok,
      resultCode: payload.header?.resultCode ?? "00",
      resultMessage: payload.header?.resultMsg ?? "정상",
      totalCount: Number(payload.header?.totalCount ?? 0),
      sampleCount: payload.body?.length ?? 0,
    }, { status: ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : "연결 확인 실패",
    }, { status: 500 });
  }
}
