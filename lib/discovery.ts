import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase";

const ACTIVE_REGIONS = ["seongsu", "hongdae"];

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
  nameEn: string;
  nameJa: string;
  roadAddress: string;
  roadAddressEn: string;
  roadAddressJa: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  category: string;
  licenseType: string;
  introduction: string;
  introductionEn: string;
  introductionJa: string;
  regionKey: string;
  searchKeyword: string;
  imageUrl: string;
  imageSource: string;
  imageAttribution: string;
  imageSourceUrl: string;
  updatedAt: string;
  menus: DiscoveryMenu[];
};

type RestaurantRow = {
  source_id: string;
  name: string;
  name_en: string | null;
  name_ja: string | null;
  road_address: string | null;
  road_address_en: string | null;
  road_address_ja: string | null;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  phone: string | null;
  category: string | null;
  license_type: string | null;
  introduction: string | null;
  introduction_en: string | null;
  introduction_ja: string | null;
  region_key: string | null;
  search_keyword: string | null;
  image_url: string | null;
  image_source: string | null;
  image_attribution: string | null;
  image_source_url: string | null;
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

const RESTAURANT_COLUMNS = "source_id,name,name_en,name_ja,road_address,road_address_en,road_address_ja,address,latitude,longitude,phone,category,license_type,introduction,introduction_en,introduction_ja,region_key,search_keyword,image_url,image_source,image_attribution,image_source_url,updated_at";

function optionalNumber(value: number | string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRestaurant(row: RestaurantRow, menus: DiscoveryMenu[]): DiscoveryRestaurant {
  return {
    id: String(row.source_id),
    name: row.name,
    nameEn: row.name_en ?? "",
    nameJa: row.name_ja ?? "",
    roadAddress: row.road_address ?? "",
    roadAddressEn: row.road_address_en ?? "",
    roadAddressJa: row.road_address_ja ?? "",
    address: row.address ?? "",
    latitude: optionalNumber(row.latitude),
    longitude: optionalNumber(row.longitude),
    phone: row.phone ?? "",
    category: row.category ?? "",
    licenseType: row.license_type ?? "",
    introduction: row.introduction ?? "",
    introductionEn: row.introduction_en ?? "",
    introductionJa: row.introduction_ja ?? "",
    regionKey: row.region_key ?? "",
    searchKeyword: row.search_keyword ?? "",
    imageUrl: row.image_url ?? "",
    imageSource: row.image_source ?? "",
    imageAttribution: row.image_attribution ?? "",
    imageSourceUrl: row.image_source_url ?? "",
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
    .select(RESTAURANT_COLUMNS)
    .in("region_key", ACTIVE_REGIONS)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (restaurantError) throw new Error(`공개 식당 조회 실패: ${restaurantError.message}`);

  const restaurants = (restaurantData ?? []) as unknown as RestaurantRow[];
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
    .select(RESTAURANT_COLUMNS)
    .eq("source_id", id)
    .in("region_key", ACTIVE_REGIONS)
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
  return mapRestaurant(restaurantData as unknown as RestaurantRow, menus);
}
