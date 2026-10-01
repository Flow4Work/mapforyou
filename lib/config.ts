import type { Bounds } from "./types";

export const REGION_PRESETS: Record<string, { name: string; bounds: Bounds }> = {
  seongsu: {
    name: "성수",
    bounds: { west: 127.037, south: 37.535, east: 127.0685, north: 37.558 },
  },
  hongdae: {
    name: "홍대",
    bounds: { west: 126.907, south: 37.5445, east: 126.94, north: 37.5665 },
  },
  itaewon: {
    name: "이태원",
    bounds: { west: 126.975, south: 37.525, east: 127.011, north: 37.546 },
  },
  seoulstation: {
    name: "서울역",
    bounds: { west: 126.958, south: 37.545, east: 126.9845, north: 37.5625 },
  },
  gongdeok: {
    name: "공덕",
    bounds: { west: 126.9405, south: 37.538, east: 126.9635, north: 37.5565 },
  },
  chungmuro: {
    name: "충무로",
    bounds: { west: 126.984, south: 37.553, east: 127.0045, north: 37.5665 },
  },
  euljiro: {
    name: "을지로",
    bounds: { west: 126.9815, south: 37.5625, east: 127.0065, north: 37.5685 },
  },
  jongno: {
    name: "종로",
    bounds: { west: 126.979, south: 37.568, east: 127.014, north: 37.5845 },
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
  itaewon: {
    center: { latitude: 37.5353, longitude: 126.9935 },
    maxBounds: { west: 126.967, south: 37.517, east: 127.018, north: 37.552 },
    minZoom: 14,
    initialZoom: 15,
  },
  seoulstation: {
    center: { latitude: 37.5546, longitude: 126.9707 },
    maxBounds: REGION_PRESETS.seoulstation.bounds,
    minZoom: 14,
    initialZoom: 15,
  },
  gongdeok: {
    center: { latitude: 37.5445, longitude: 126.9519 },
    maxBounds: REGION_PRESETS.gongdeok.bounds,
    minZoom: 14,
    initialZoom: 15,
  },
  chungmuro: {
    center: { latitude: 37.5612, longitude: 126.9941 },
    maxBounds: REGION_PRESETS.chungmuro.bounds,
    minZoom: 14,
    initialZoom: 15,
  },
  euljiro: {
    center: { latitude: 37.5668, longitude: 126.9928 },
    maxBounds: REGION_PRESETS.euljiro.bounds,
    minZoom: 14,
    initialZoom: 15,
  },
  jongno: {
    center: { latitude: 37.574, longitude: 126.9945 },
    maxBounds: REGION_PRESETS.jongno.bounds,
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
