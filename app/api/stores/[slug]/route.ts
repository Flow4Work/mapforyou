import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ store: null, mode: "demo" });

  const { data: store, error } = await supabase.from("stores").select("*").eq("slug", slug).eq("publish_status", "published").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!store) return NextResponse.json({ store: null, mode: "supabase" }, { status: 404 });

  const { data: menus, error: menuError } = await supabase.from("menus").select("*").eq("kakao_place_id", store.kakao_place_id).order("sort_order");
  if (menuError) return NextResponse.json({ error: menuError.message }, { status: 500 });

  return NextResponse.json({ store, menus, mode: "supabase" });
}
