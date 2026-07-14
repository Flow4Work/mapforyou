import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { StoreRecord } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const store = (await request.json()) as StoreRecord;
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ mode: "demo", saved: false, message: "Supabase 연결 전이라 브라우저 임시 저장을 사용합니다." });
    }

    const { error: storeError } = await supabase.from("stores").upsert({
      kakao_place_id: store.kakaoPlaceId,
      slug: store.slug,
      name: store.name,
      category: store.category,
      phone: store.phone,
      address: store.address,
      road_address: store.roadAddress,
      latitude: store.latitude,
      longitude: store.longitude,
      kakao_url: store.kakaoUrl,
      instagram_url: store.instagramUrl ?? null,
      region: store.region,
      search_keyword: store.searchKeyword,
      menu_check_status: store.menuCheckStatus,
      menu_evidence: store.menuEvidence ?? null,
      translation_status: store.translationStatus,
      publish_status: store.publishStatus,
      checked_at: store.checkedAt ?? null,
      updated_at: store.updatedAt,
    }, { onConflict: "kakao_place_id" });
    if (storeError) throw storeError;

    const { error: deleteError } = await supabase.from("menus").delete().eq("kakao_place_id", store.kakaoPlaceId);
    if (deleteError) throw deleteError;

    if (store.menus.length) {
      const { error: menuError } = await supabase.from("menus").insert(
        store.menus.map((menu, index) => ({
          kakao_place_id: store.kakaoPlaceId,
          menu_id: menu.id,
          sort_order: index,
          category: menu.category,
          name_ko: menu.nameKo,
          description_ko: menu.descriptionKo,
          price: menu.price,
          is_representative: menu.isRepresentative,
          name_en: menu.nameEn,
          description_en: menu.descriptionEn,
          name_ja: menu.nameJa,
          description_ja: menu.descriptionJa,
        })),
      );
      if (menuError) throw menuError;
    }

    return NextResponse.json({ mode: "supabase", saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "저장에 실패했습니다." }, { status: 500 });
  }
}
