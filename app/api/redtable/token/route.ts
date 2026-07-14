import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_SETTING_KEY = "seoul_tourism_api_token";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ configured: false, error: "Supabase 연결 없음" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", TOKEN_SETTING_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ configured: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    configured: Boolean(data?.value),
    updatedAt: data?.updated_at ?? null,
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });
  }

  const body = (await request.json()) as { token?: string };
  const token = body.token?.trim() ?? "";

  if (token.length < 20) {
    return NextResponse.json({ error: "API KEY를 정확히 입력해주세요." }, { status: 400 });
  }

  const { error } = await supabase.from("app_settings").upsert({
    key: TOKEN_SETTING_KEY,
    value: token,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: `API KEY 저장 실패: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
