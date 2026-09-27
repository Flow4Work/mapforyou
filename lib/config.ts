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

export type MapViewportConfig = {
  center: { latitude: number; longitude: number };
  maxBounds: Bounds;
  minZoom: number;
  initialZoom: number;
};

export const MAP_VIEWPORTS: Record<string, MapViewportConfig> = {
  seoul: {
    center: { latitude: 37.552, longitude: 126.989 },
    maxBounds: {
      west: 126.86,
      south: 37.49,
      east: 127.115,
      north: 37.635,
    },
    minZoom: 13,
    initialZoom: 13,
  },
  seongsu: {
    center: { latitude: 37.5439, longitude: 127.0525 },
    maxBounds: { west: 127.032, south: 37.529, east: 127.075, north: 37.559 },
    minZoom: 14,
    initialZoom: 15,
  },
  hongdae: {
    center: { latitude: 37.5573, longitude: 126.9235 },
    maxBounds: REGION_PRESETS.hongdae.bounds,
    minZoom: 14,
    initialZoom: 15,
  },
};

export const CATEGORY_PRESETS = ["치킨", "카페", "삼겹살", "베이커리", "한식", "일식"];

export const STORAGE_KEYS = {
  kakaoKey: "mapforyou:kakao-key",
  inspectedIds: "mapforyou:inspected-ids",
  stores: "mapforyou:stores",
  published: "mapforyou:published",
} as const;
