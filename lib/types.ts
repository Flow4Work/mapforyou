export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type KakaoPlace = {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  category_group_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
  distance?: string;
};

export type MenuCheckStatus = "unchecked" | "checking" | "found" | "partial" | "image-only" | "missing" | "failed";
export type TranslationStatus = "not-started" | "draft" | "reviewed";
export type PublishStatus = "draft" | "published";

export type MenuItem = {
  id: string;
  category: string;
  nameKo: string;
  descriptionKo: string;
  price: string;
  isRepresentative: boolean;
  nameEn: string;
  descriptionEn: string;
  nameJa: string;
  descriptionJa: string;
};

export type StoreRecord = {
  kakaoPlaceId: string;
  slug: string;
  name: string;
  category: string;
  phone: string;
  address: string;
  roadAddress: string;
  latitude: string;
  longitude: string;
  kakaoUrl: string;
  instagramUrl?: string;
  region: string;
  searchKeyword: string;
  menuCheckStatus: MenuCheckStatus;
  menuEvidence?: string;
  translationStatus: TranslationStatus;
  publishStatus: PublishStatus;
  checkedAt?: string;
  updatedAt: string;
  menus: MenuItem[];
};

export type SearchRequest = {
  apiKey: string;
  regionKey: string;
  customRegion?: string;
  keyword: string;
  targetCount: number;
  excludeIds?: string[];
};

export type SearchResponse = {
  regionName: string;
  keyword: string;
  candidates: StoreRecord[];
  stats: {
    requests: number;
    cells: number;
    rawResults: number;
    excluded: number;
  };
};
