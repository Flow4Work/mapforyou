import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase";

export type DiscoveryMenu = {
  id: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  price: number;
  isSpecialty: boolean;
};

export type DiscoveryRestaurant = {
  id: string;
  name: string;
  roadAddress: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  category: string;
  licenseType: string;
  introduction: string;
  regionKey: string;
  searchKeyword: string;
  imageUrl: string;
  updatedAt: string;
  menus: DiscoveryMenu[];
};

type RestaurantRow = {
  source_id: string;
  name: string;
  road_address: string | null;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  phone: string | null;
  category: string | null;
  license_type: string | null;
  introduction: string | null;
  region_key: string | null;
  search_keyword: string | null;
  image_url: string | null;
  updated_at: string;
};

type MenuRow = {
  menu_id: string;
  restaurant_id: string;
  name_ko: string | null;
  name_en: string | null;
  name_ja: string | null;
  price: number | string | null;
  is_specialty: boolean | null;
};

function optionalNumber(value: number | string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRestaurant(row: RestaurantRow, menus: DiscoveryMenu[]): DiscoveryRestaurant {
  return {
    id: String(row.source_id),
    name: row.name,
    roadAddress: row.road_address ?? "",
    address: row.address ?? "",
    latitude: optionalNumber(row.latitude),
    longitude: optionalNumber(row.longitude),
    phone: row.phone ?? "",
    category: row.category ?? "",
    licenseType: row.license_type ?? "",
    introduction: row.introduction ?? "",
    regionKey: row.region_key ?? "",
    searchKeyword: row.search_keyword ?? "",
    imageUrl: row.image_url ?? "",
    updatedAt: row.updated_at,
    menus,
  };
}

function mapMenu(row: MenuRow): DiscoveryMenu {
  return {
    id: String(row.menu_id),
    nameKo: row.name_ko ?? "",
    nameEn: row.name_en ?? "",
    nameJa: row.name_ja ?? "",
    price: Number(row.price ?? 0) || 0,
    isSpecialty: Boolean(row.is_specialty),
  };
}

export async function loadDiscoveryRestaurants(limit = 500): Promise<DiscoveryRestaurant[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data: restaurantData, error: restaurantError } = await supabase
    .from("public_data_restaurants")
    .select("source_id,name,road_address,address,latitude,longitude,phone,category,license_type,introduction,region_key,search_keyword,image_url,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (restaurantError) throw new Error(`공개 식당 조회 실패: ${restaurantError.message}`);

  const restaurants = (restaurantData ?? []) as RestaurantRow[];
  const ids = restaurants.map((row) => String(row.source_id));
  if (!ids.length) return [];

  const { data: menuData, error: menuError } = await supabase
    .from("public_data_menus")
    .select("menu_id,restaurant_id,name_ko,name_en,name_ja,price,is_specialty,sort_order")
    .in("restaurant_id", ids)
    .order("sort_order", { ascending: true });

  if (menuError) throw new Error(`공개 메뉴 조회 실패: ${menuError.message}`);

  const menusByRestaurant = new Map<string, DiscoveryMenu[]>();
  for (const row of (menuData ?? []) as MenuRow[]) {
    const id = String(row.restaurant_id);
    const current = menusByRestaurant.get(id) ?? [];
    current.push(mapMenu(row));
    menusByRestaurant.set(id, current);
  }

  return restaurants
    .map((row) => mapRestaurant(row, menusByRestaurant.get(String(row.source_id)) ?? []))
    .filter((restaurant) => restaurant.menus.length > 0);
}

export async function loadDiscoveryRestaurant(id: string): Promise<DiscoveryRestaurant | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data: restaurantData, error: restaurantError } = await supabase
    .from("public_data_restaurants")
    .select("source_id,name,road_address,address,latitude,longitude,phone,category,license_type,introduction,region_key,search_keyword,image_url,updated_at")
    .eq("source_id", id)
    .maybeSingle();

  if (restaurantError) throw new Error(`식당 조회 실패: ${restaurantError.message}`);
  if (!restaurantData) return null;

  const { data: menuData, error: menuError } = await supabase
    .from("public_data_menus")
    .select("menu_id,restaurant_id,name_ko,name_en,name_ja,price,is_specialty,sort_order")
    .eq("restaurant_id", id)
    .order("sort_order", { ascending: true });

  if (menuError) throw new Error(`메뉴 조회 실패: ${menuError.message}`);

  const menus = ((menuData ?? []) as MenuRow[]).map(mapMenu);
  if (!menus.length) return null;
  return mapRestaurant(restaurantData as RestaurantRow, menus);
}
