import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase";

const ACTIVE_REGIONS = ["seongsu", "hongdae"] as const;
const DEFAULT_PER_REGION = 20;
const MAX_PER_REGION = 50;

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
  imageGalleryUrls: string[];
  imageSource: string;
  imageAttribution: string;
  imageSourceUrl: string;
  instagramUrl: string;
  instagramUsername: string;
  updatedAt: string;
  menus: DiscoveryMenu[];
};

export type DiscoveryRestaurantPage = {
  stores: DiscoveryRestaurant[];
  nextOffset: number | null;
};

type RestaurantRow = {
  source_id: string;
  name: string | null;
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
  image_gallery_urls: string[] | null;
  image_source: string | null;
  image_attribution: string | null;
  image_source_url: string | null;
  instagram_url: string | null;
  instagram_username: string | null;
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

const RESTAURANT_COLUMNS = "source_id,name,name_en,name_ja,road_address,road_address_en,road_address_ja,address,latitude,longitude,phone,category,license_type,introduction,introduction_en,introduction_ja,region_key,search_keyword,image_url,image_gallery_urls,image_source,image_attribution,image_source_url,instagram_url,instagram_username,updated_at";
const MENU_COLUMNS = "menu_id,restaurant_id,name_ko,name_en,name_ja,price,is_specialty,sort_order";

function optionalNumber(value: number | string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedGallery(primary: string, gallery: string[] | null) {
  const values = [primary, ...(gallery ?? [])]
    .map((value) => String(value || "").trim())
    .filter((value) => /^https?:\/\//i.test(value));
  return [...new Set(values)];
}

function hasUsableText(...values: Array<string | null | undefined>) {
  return values.some((value) => Boolean(value?.trim()));
}

function hasUsableCoreData(row: RestaurantRow) {
  const hasName = hasUsableText(row.name, row.name_en, row.name_ja);
  const hasIntroduction = hasUsableText(row.introduction, row.introduction_en, row.introduction_ja);
  return hasName && hasIntroduction;
}

function mapRestaurant(row: RestaurantRow, menus: DiscoveryMenu[]): DiscoveryRestaurant {
  const imageUrl = row.image_url ?? "";
  return {
    id: String(row.source_id),
    name: row.name ?? "",
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
    imageUrl,
    imageGalleryUrls: normalizedGallery(imageUrl, row.image_gallery_urls),
    imageSource: row.image_source ?? "",
    imageAttribution: row.image_attribution ?? "",
    imageSourceUrl: row.image_source_url ?? "",
    instagramUrl: row.instagram_url ?? "",
    instagramUsername: row.instagram_username ?? "",
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

async function loadMenusByRestaurant(ids: string[]) {
  const menusByRestaurant = new Map<string, DiscoveryMenu[]>();
  if (!ids.length) return menusByRestaurant;

  const supabase = getSupabaseServerClient();
  if (!supabase) return menusByRestaurant;

  const { data: menuData, error: menuError } = await supabase
    .from("public_data_menus")
    .select(MENU_COLUMNS)
    .in("restaurant_id", ids)
    .order("sort_order", { ascending: true });

  if (menuError) throw new Error(`공개 메뉴 조회 실패: ${menuError.message}`);

  for (const row of (menuData ?? []) as MenuRow[]) {
    const restaurantId = String(row.restaurant_id);
    const current = menusByRestaurant.get(restaurantId) ?? [];
    current.push(mapMenu(row));
    menusByRestaurant.set(restaurantId, current);
  }

  return menusByRestaurant;
}

function attachMenus(restaurants: RestaurantRow[], menusByRestaurant: Map<string, DiscoveryMenu[]>) {
  return restaurants
    .map((row) => mapRestaurant(row, menusByRestaurant.get(String(row.source_id)) ?? []))
    .filter((restaurant) => restaurant.menus.length > 0);
}

export async function loadDiscoveryRestaurantPage({
  offset = 0,
  perRegion = DEFAULT_PER_REGION,
}: {
  offset?: number;
  perRegion?: number;
} = {}): Promise<DiscoveryRestaurantPage> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { stores: [], nextOffset: null };

  const safeOffset = Math.max(0, Math.floor(offset));
  const safePerRegion = Math.min(MAX_PER_REGION, Math.max(1, Math.floor(perRegion)));

  const regionPages = await Promise.all(ACTIVE_REGIONS.map(async (regionKey) => {
    const { data, error } = await supabase
      .from("public_data_restaurants")
      .select(RESTAURANT_COLUMNS)
      .eq("region_key", regionKey)
      .eq("publish_status", "published")
      .order("updated_at", { ascending: false })
      .range(safeOffset, safeOffset + safePerRegion);

    if (error) throw new Error(`공개 식당 조회 실패 (${regionKey}): ${error.message}`);

    const rows = (data ?? []) as unknown as RestaurantRow[];
    return {
      rows: rows.slice(0, safePerRegion),
      hasMore: rows.length > safePerRegion,
    };
  }));

  const restaurants = regionPages
    .flatMap((page) => page.rows)
    .filter(hasUsableCoreData)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  const ids = restaurants.map((row) => String(row.source_id));
  const menusByRestaurant = await loadMenusByRestaurant(ids);
  const stores = attachMenus(restaurants, menusByRestaurant);
  const nextOffset = regionPages.some((page) => page.hasMore) ? safeOffset + safePerRegion : null;

  return { stores, nextOffset };
}

export async function loadDiscoveryRestaurants(limit = 1000): Promise<DiscoveryRestaurant[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
  const { data: restaurantData, error: restaurantError } = await supabase
    .from("public_data_restaurants")
    .select(RESTAURANT_COLUMNS)
    .in("region_key", [...ACTIVE_REGIONS])
    .eq("publish_status", "published")
    .order("updated_at", { ascending: false })
    .limit(safeLimit);

  if (restaurantError) throw new Error(`공개 식당 조회 실패: ${restaurantError.message}`);

  const restaurants = ((restaurantData ?? []) as unknown as RestaurantRow[]).filter(hasUsableCoreData);
  const ids = restaurants.map((row) => String(row.source_id));
  const menusByRestaurant = await loadMenusByRestaurant(ids);
  return attachMenus(restaurants, menusByRestaurant);
}

export async function loadDiscoveryRestaurant(id: string): Promise<DiscoveryRestaurant | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data: restaurantData, error: restaurantError } = await supabase
    .from("public_data_restaurants")
    .select(RESTAURANT_COLUMNS)
    .eq("source_id", id)
    .eq("publish_status", "published")
    .in("region_key", [...ACTIVE_REGIONS])
    .maybeSingle();

  if (restaurantError) throw new Error(`식당 조회 실패: ${restaurantError.message}`);
  if (!restaurantData) return null;

  const restaurantRow = restaurantData as unknown as RestaurantRow;
  if (!hasUsableCoreData(restaurantRow)) return null;

  const { data: menuData, error: menuError } = await supabase
    .from("public_data_menus")
    .select(MENU_COLUMNS)
    .eq("restaurant_id", id)
    .order("sort_order", { ascending: true });

  if (menuError) throw new Error(`메뉴 조회 실패: ${menuError.message}`);

  const menus = ((menuData ?? []) as MenuRow[]).map(mapMenu);
  if (!menus.length) return null;
  return mapRestaurant(restaurantRow, menus);
}
