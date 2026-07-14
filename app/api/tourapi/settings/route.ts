import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";

const KEY_SETTING = "tourapi_korservice_key";

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ configured: false, error: "Supabase 연결 없음" }, { status: 503 });

  const { data, error } = await supabase
    .from("app_settings")
    .select("key,updated_at")
    .eq("key", KEY_SETTING)
    .maybeSingle();

  if (error) return NextResponse.json({ configured: false, error: error.message }, { status: 500 });
  return NextResponse.json({ configured: Boolean(data?.key), updatedAt: data?.updated_at ?? null });
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

    const body = (await request.json()) as { key?: string };
    const key = String(body.key ?? "").trim();
    if (key.length < 20) return NextResponse.json({ error: "한국관광공사 API 키를 확인해주세요." }, { status: 400 });

    const now = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert({
      key: KEY_SETTING,
      value: key,
      updated_at: now,
    }, { onConflict: "key" });

    if (error) throw error;
    return NextResponse.json({ configured: true, updatedAt: now });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TourAPI 키 저장 실패" },
      { status: 500 },
    );
  }
}
