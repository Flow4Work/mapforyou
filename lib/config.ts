import type { Bounds } from "./types";

export const REGION_PRESETS: Record<string, { name: string; bounds: Bounds }> = {
  seongsu: {
    name: "성수",
    bounds: { west: 127.044, south: 37.535, east: 127.0685, north: 37.5555 },
  },
  hongdae: {
    name: "홍대",
    bounds: { west: 126.91, south: 37.548, east: 126.936, north: 37.5665 },
  },
  konkuk: {
    name: "건대·자양",
    bounds: { west: 127.061, south: 37.527, east: 127.091, north: 37.548 },
  },
};

export const CATEGORY_PRESETS = ["치킨", "카페", "삼겹살", "베이커리", "한식", "일식"];

export const STORAGE_KEYS = {
  kakaoKey: "mapforyou:kakao-key",
  inspectedIds: "mapforyou:inspected-ids",
  stores: "mapforyou:stores",
  published: "mapforyou:published",
} as const;
