import { REGION_PRESETS } from "./config";
import type { Bounds, KakaoPlace, SearchRequest, SearchResponse, StoreRecord } from "./types";

const KEYWORD_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const PAGE_SIZE = 15;
const MAX_PAGES = 3;

function slugify(name: string, id: string) {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${normalized || "store"}-${id}`;
}

function grid(bounds: Bounds, columns = 5, rows = 5): Bounds[] {
  const width = (bounds.east - bounds.west) / columns;
  const height = (bounds.north - bounds.south) / rows;
  const cells: Bounds[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        west: bounds.west + width * column,
        east: bounds.west + width * (column + 1),
        south: bounds.south + height * row,
        north: bounds.south + height * (row + 1),
      });
    }
  }
  return cells;
}

function toRect(bounds: Bounds) {
  return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
}

async function fetchKakao(url: string, apiKey: string) {
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`카카오 API 오류 ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as {
    meta: { is_end: boolean; pageable_count: number; total_count: number };
    documents: KakaoPlace[];
  };
}

export async function searchKakaoPlaces(input: SearchRequest): Promise<SearchResponse> {
  const preset = REGION_PRESETS[input.regionKey] ?? REGION_PRESETS.seongsu;
  const regionName = input.customRegion?.trim() || preset.name;
  const cells = grid(preset.bounds, 5, 5);
  const exclude = new Set(input.excludeIds ?? []);
  const found = new Map<string, KakaoPlace>();
  let requests = 0;
  let rawResults = 0;

  for (const cell of cells) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (found.size >= Math.max(input.targetCount * 3, 60)) break;
      const params = new URLSearchParams({
        query: `${regionName} ${input.keyword}`,
        rect: toRect(cell),
        page: String(page),
        size: String(PAGE_SIZE),
        sort: "accuracy",
      });
      const payload = await fetchKakao(`${KEYWORD_ENDPOINT}?${params.toString()}`, input.apiKey);
      requests += 1;
      rawResults += payload.documents.length;
      for (const place of payload.documents) {
        if (!exclude.has(place.id)) found.set(place.id, place);
      }
      if (payload.meta.is_end) break;
    }
    if (found.size >= Math.max(input.targetCount * 3, 60)) break;
  }

  const now = new Date().toISOString();
  const candidates: StoreRecord[] = [...found.values()]
    .slice(0, Math.max(input.targetCount * 3, input.targetCount))
    .map((place) => ({
      kakaoPlaceId: place.id,
      slug: slugify(place.place_name, place.id),
      name: place.place_name,
      category: place.category_name,
      phone: place.phone,
      address: place.address_name,
      roadAddress: place.road_address_name,
      latitude: place.y,
      longitude: place.x,
      kakaoUrl: place.place_url,
      region: regionName,
      searchKeyword: input.keyword,
      menuCheckStatus: "unchecked",
      translationStatus: "not-started",
      publishStatus: "draft",
      updatedAt: now,
      menus: [],
    }));

  return {
    regionName,
    keyword: input.keyword,
    candidates,
    stats: {
      requests,
      cells: cells.length,
      rawResults,
      excluded: exclude.size,
    },
  };
}
