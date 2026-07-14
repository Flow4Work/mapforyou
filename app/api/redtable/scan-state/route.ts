import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";

const PREFIX = "redtable_menu_cursor:";

function normalizeScope(value: unknown) {
  const scope = String(value ?? "").trim().toLowerCase();
  if (!scope || scope.length > 120 || !/^[\p{L}\p{N}:_-]+$/u.test(scope)) return null;
  return scope;
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

    const url = new URL(request.url);
    const scope = normalizeScope(url.searchParams.get("scope"));
    if (!scope) return NextResponse.json({ error: "검색 범위가 올바르지 않습니다." }, { status: 400 });

    const { data, error } = await supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", `${PREFIX}${scope}`)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      page: Math.max(Number(data?.value) || 1, 1),
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "검색 위치 조회 실패" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

    const body = (await request.json()) as { scope?: string; page?: number };
    const scope = normalizeScope(body.scope);
    const page = Math.max(Math.floor(Number(body.page) || 1), 1);
    if (!scope) return NextResponse.json({ error: "검색 범위가 올바르지 않습니다." }, { status: 400 });

    const { error } = await supabase.from("app_settings").upsert({
      key: `${PREFIX}${scope}`,
      value: String(page),
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ saved: true, page });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "검색 위치 저장 실패" }, { status: 500 });
  }
}
