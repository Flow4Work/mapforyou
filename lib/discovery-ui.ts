import type { DiscoveryRestaurant } from "@/lib/discovery";

export type PublicLanguage = "en" | "ja";

export type BroadCategory = "cafe" | "korean" | "japanese" | "chinese" | "meat" | "dessert" | "other";

export function broadCategory(store: Pick<DiscoveryRestaurant, "category" | "licenseType" | "name">): BroadCategory {
  const value = `${store.category} ${store.licenseType} ${store.name}`.toLowerCase();
  if (/카페|커피|다방|휴게음식|베이커리|제과|빵|디저트/.test(value)) return "cafe";
  if (/일식|초밥|스시|라멘|우동|돈까스/.test(value)) return "japanese";
  if (/중식|중국|짜장|짬뽕|마라/.test(value)) return "chinese";
  if (/고기|구이|갈비|삼겹|식육|숯불/.test(value)) return "meat";
  if (/도넛|도너츠|아이스크림|과자|떡|강정/.test(value)) return "dessert";
  if (/한식|백반|국밥|찌개|분식/.test(value)) return "korean";
  return "other";
}

export function categoryLabel(category: BroadCategory, language: PublicLanguage) {
  const labels: Record<BroadCategory, { en: string; ja: string }> = {
    cafe: { en: "Cafe", ja: "カフェ" },
    korean: { en: "Korean", ja: "韓国料理" },
    japanese: { en: "Japanese", ja: "日本料理" },
    chinese: { en: "Chinese", ja: "中華料理" },
    meat: { en: "Korean BBQ", ja: "韓国焼肉" },
    dessert: { en: "Dessert", ja: "デザート" },
    other: { en: "Restaurant", ja: "レストラン" },
  };
  return labels[category][language];
}

export function categoryIcon(category: BroadCategory) {
  const icons: Record<BroadCategory, string> = {
    cafe: "☕",
    korean: "🍚",
    japanese: "🍜",
    chinese: "🥟",
    meat: "🥩",
    dessert: "🍩",
    other: "🍽",
  };
  return icons[category];
}

export function localizedMenuName(menu: { nameKo: string; nameEn: string; nameJa: string }, language: PublicLanguage) {
  return language === "ja" ? menu.nameJa || menu.nameEn || menu.nameKo : menu.nameEn || menu.nameJa || menu.nameKo;
}

export function priceLabel(price: number, language: PublicLanguage) {
  if (!price) return language === "ja" ? "価格未確認" : "Price unavailable";
  return `₩${price.toLocaleString("en-US")}`;
}

export function regionLabel(regionKey: string, language: PublicLanguage) {
  const labels: Record<string, { en: string; ja: string }> = {
    seongsu: { en: "Seongsu", ja: "聖水" },
    hongdae: { en: "Hongdae", ja: "弘大" },
    geondae: { en: "Konkuk Univ.", ja: "建大入口" },
  };
  return labels[regionKey]?.[language] ?? (regionKey || (language === "ja" ? "ソウル" : "Seoul"));
}

export function googleMapUrl(store: DiscoveryRestaurant) {
  const query = store.latitude != null && store.longitude != null
    ? `${store.latitude},${store.longitude}`
    : `${store.name} ${store.roadAddress || store.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function naverMapUrl(store: DiscoveryRestaurant) {
  const query = `${store.name} ${store.roadAddress || store.address}`.trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}
