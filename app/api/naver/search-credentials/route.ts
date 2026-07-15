import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_ID_SETTING_KEY = "naver_search_client_id";
const CLIENT_SECRET_SETTING_KEY = "naver_search_client_secret";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function loadStoredCredentials() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { clientId: "", clientSecret: "", updatedAt: null as string | null };

  const { data, error } = await supabase
    .from("app_settings")
    .select("key,value,updated_at")
    .in("key", [CLIENT_ID_SETTING_KEY, CLIENT_SECRET_SETTING_KEY]);

  if (error) throw error;

  const rows = new Map((data ?? []).map((row) => [String(row.key), row]));
  const idRow = rows.get(CLIENT_ID_SETTING_KEY);
  const secretRow = rows.get(CLIENT_SECRET_SETTING_KEY);
  const updatedAt = [idRow?.updated_at, secretRow?.updated_at]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    clientId: String(idRow?.value ?? ""),
    clientSecret: String(secretRow?.value ?? ""),
    updatedAt,
  };
}

export async function GET() {
  try {
    const stored = await loadStoredCredentials();
    const configured = Boolean(
      (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) ||
        (stored.clientId && stored.clientSecret),
    );

    return NextResponse.json({
      configured,
      source: process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET ? "environment" : "admin",
      updatedAt: stored.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { configured: false, error: error instanceof Error ? error.message : "네이버 검색 키 상태 조회 실패" },
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

    const body = (await request.json()) as { clientId?: string; clientSecret?: string };
    const clientId = body.clientId?.trim() ?? "";
    const clientSecret = body.clientSecret?.trim() ?? "";

    if (clientId.length < 5 || clientSecret.length < 5) {
      return NextResponse.json({ error: "Client ID와 Client Secret을 정확히 입력해주세요." }, { status: 400 });
    }

    const validationUrl = new URL("https://openapi.naver.com/v1/search/webkr.json");
    validationUrl.searchParams.set("query", "인스타그램");
    validationUrl.searchParams.set("display", "1");
    validationUrl.searchParams.set("start", "1");

    const validation = await fetch(validationUrl, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      cache: "no-store",
    });

    if (!validation.ok) {
      const payload = (await validation.json().catch(() => null)) as
        | { errorMessage?: string; errorCode?: string }
        | null;
      const detail = payload?.errorMessage || payload?.errorCode || `HTTP ${validation.status}`;
      return NextResponse.json(
        {
          error:
            validation.status === 403
              ? "이 네이버 애플리케이션에 검색 API 권한이 없습니다. 개발자센터 API 설정에서 ‘검색’을 추가해주세요."
              : `네이버 검색 API 확인 실패: ${detail}`,
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert(
      [
        { key: CLIENT_ID_SETTING_KEY, value: clientId, updated_at: now },
        { key: CLIENT_SECRET_SETTING_KEY, value: clientSecret, updated_at: now },
      ],
      { onConflict: "key" },
    );

    if (error) throw error;
    return NextResponse.json({ saved: true, configured: true, updatedAt: now });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "네이버 검색 키 저장 실패" },
      { status: 500 },
    );
  }
}
