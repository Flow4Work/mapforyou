import { notFound } from "next/navigation";
import PublicMenu from "@/components/PublicMenu";
import { DEMO_STORE } from "@/lib/demo-store";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { StoreRecord } from "@/lib/types";

async function loadStore(slug: string): Promise<StoreRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return slug === DEMO_STORE.slug ? DEMO_STORE : { ...DEMO_STORE, slug };

  const { data: store } = await supabase.from("stores").select("*").eq("slug", slug).eq("publish_status", "published").maybeSingle();
  if (!store) return slug === DEMO_STORE.slug ? DEMO_STORE : null;
  const { data: menus } = await supabase.from("menus").select("*").eq("kakao_place_id", store.kakao_place_id).order("sort_order");

  return {
    kakaoPlaceId: store.kakao_place_id,
    slug: store.slug,
    name: store.name,
    category: store.category,
    phone: store.phone ?? "",
    address: store.address ?? "",
    roadAddress: store.road_address ?? "",
    latitude: store.latitude ?? "",
    longitude: store.longitude ?? "",
    kakaoUrl: store.kakao_url,
    instagramUrl: store.instagram_url ?? undefined,
    region: store.region,
    searchKeyword: store.search_keyword,
    menuCheckStatus: store.menu_check_status,
    menuEvidence: store.menu_evidence ?? undefined,
    translationStatus: store.translation_status,
    publishStatus: store.publish_status,
    checkedAt: store.checked_at ?? undefined,
    updatedAt: store.updated_at,
    menus: (menus ?? []).map((menu) => ({
      id: menu.menu_id,
      category: menu.category ?? "Menu",
      nameKo: menu.name_ko,
      descriptionKo: menu.description_ko ?? "",
      price: menu.price ?? "",
      isRepresentative: Boolean(menu.is_representative),
      nameEn: menu.name_en ?? "",
      descriptionEn: menu.description_en ?? "",
      nameJa: menu.name_ja ?? "",
      descriptionJa: menu.description_ja ?? "",
    })),
  } as StoreRecord;
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await loadStore(slug);
  if (!store) notFound();
  return <PublicMenu initialStore={store} />;
}
