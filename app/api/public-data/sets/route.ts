import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const TOKEN_SETTING_KEY = "seoul_tourism_api_token";

type Menu = {
  menuId: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  price: number;
  isSpecialty: boolean;
};

type RestaurantSet = {
  sourceId: string;
  name: string;
  roadAddress: string;
  address: string;
  latitude: string;
  longitude: string;
  phone: string;
  category: string;
  licenseType: string;
  introduction: string;
  imageUrl: string;
  menus: Menu[];
  savedAt: string;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ connected: false, tokenConfigured: false, totalCount: 0, restaurants: [] });
  }

  const [restaurantResult, countResult, tokenResult] = await Promise.all([
    supabase
      .from("public_data_restaurants")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("public_data_restaurants")
      .select("source_id", { count: "exact", head: true }),
    supabase
      .from("app_settings")
      .select("key")
      .eq("key", TOKEN_SETTING_KEY)
      .maybeSingle(),
  ]);

  if (restaurantResult.error) {
    return NextResponse.json({ error: restaurantResult.error.message }, { status: 500 });
  }
  if (countResult.error) {
    return NextResponse.json({ error: countResult.error.message }, { status: 500 });
  }
  if (tokenResult.error) {
    return NextResponse.json({ error: tokenResult.error.message }, { status: 500 });
  }

  const restaurants = restaurantResult.data ?? [];
  const ids = restaurants.map((row) => row.source_id);
  const { data: menus, error: menuError } = ids.length
    ? await supabase.from("public_data_menus").select("*").in("restaurant_id", ids).order("sort_order")
    : { data: [], error: null };

  if (menuError) return NextResponse.json({ error: menuError.message }, { status: 500 });

  const menusByRestaurant = new Map<string, typeof menus>();
  for (const menu of menus ?? []) {
    const current = menusByRestaurant.get(menu.restaurant_id) ?? [];
    current.push(menu);
    menusByRestaurant.set(menu.restaurant_id, current);
  }

  return NextResponse.json({
    connected: true,
    tokenConfigured: Boolean(tokenResult.data?.key),
    totalCount: countResult.count ?? restaurants.length,
    restaurants: restaurants.map((row) => ({
      sourceId: row.source_id,
      name: row.name,
      roadAddress: row.road_address ?? "",
      address: row.address ?? "",
      latitude: row.latitude == null ? "" : String(row.latitude),
      longitude: row.longitude == null ? "" : String(row.longitude),
      phone: row.phone ?? "",
      category: row.category ?? "",
      licenseType: row.license_type ?? "",
      introduction: row.introduction ?? "",
      imageUrl: row.image_url ?? "",
      savedAt: row.updated_at,
      menus: (menusByRestaurant.get(row.source_id) ?? []).map((menu) => ({
        menuId: menu.menu_id,
        nameKo: menu.name_ko ?? "",
        nameEn: menu.name_en ?? "",
        nameJa: menu.name_ja ?? "",
        price: Number(menu.price ?? 0),
        isSpecialty: Boolean(menu.is_specialty),
      })),
    })),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      restaurants?: RestaurantSet[];
      regionKey?: string;
      keyword?: string;
      targetCount?: number;
      status?: "running" | "completed" | "failed" | "cancelled";
      errorMessage?: string;
    };

    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 환경변수가 연결되지 않았습니다." }, { status: 503 });

    const restaurants = body.restaurants ?? [];
    if (!restaurants.length) return NextResponse.json({ saved: 0, connected: true });

    const now = new Date().toISOString();
    const { error: restaurantError } = await supabase.from("public_data_restaurants").upsert(
      restaurants.map((store) => ({
        source_id: store.sourceId,
        name: store.name,
        road_address: store.roadAddress || null,
        address: store.address || null,
        latitude: toNumber(store.latitude),
        longitude: toNumber(store.longitude),
        phone: store.phone || null,
        category: store.category || null,
        license_type: store.licenseType || null,
        introduction: store.introduction || null,
        image_url: store.imageUrl || null,
        region_key: body.regionKey || null,
        search_keyword: body.keyword || null,
        publish_status: "draft",
        source_checked_at: store.savedAt || now,
        updated_at: now,
      })),
      { onConflict: "source_id" },
    );
    if (restaurantError) throw restaurantError;

    const ids = restaurants.map((store) => store.sourceId);
    const { error: deleteError } = await supabase.from("public_data_menus").delete().in("restaurant_id", ids);
    if (deleteError) throw deleteError;

    const menuRows = restaurants.flatMap((store) => store.menus.map((menu, index) => ({
      menu_id: menu.menuId,
      restaurant_id: store.sourceId,
      sort_order: index,
      name_ko: menu.nameKo || null,
      name_en: menu.nameEn || null,
      name_ja: menu.nameJa || null,
      price: Number.isFinite(menu.price) ? menu.price : null,
      is_specialty: menu.isSpecialty,
      updated_at: now,
    })));

    if (menuRows.length) {
      const { error: menuError } = await supabase.from("public_data_menus").upsert(menuRows, { onConflict: "menu_id" });
      if (menuError) throw menuError;
    }

    const { error: runError } = await supabase.from("public_data_collection_runs").insert({
      region_key: body.regionKey || null,
      search_keyword: body.keyword || null,
      target_count: Number(body.targetCount) || restaurants.length,
      found_count: restaurants.length,
      status: body.status || "completed",
      error_message: body.errorMessage || null,
      completed_at: body.status === "running" ? null : now,
    });
    if (runError) throw runError;

    return NextResponse.json({ connected: true, saved: restaurants.length, menus: menuRows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Supabase 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}
