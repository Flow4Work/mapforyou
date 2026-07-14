"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  localizedMenuName,
  localizedRestaurantName,
  priceLabel,
  regionLabel,
  type PublicLanguage,
} from "@/lib/discovery-ui";

const NAVER_MAP_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID || "qlsdjge63h";
const NAVER_SCRIPT_ID = "naver-map-sdk";

type NaverLanguage = "en" | "ja";
type NaverListener = unknown;

type NaverLatLng = {
  lat: () => number;
  lng: () => number;
};

type NaverLatLngBounds = {
  extend: (coordinate: NaverLatLng) => void;
};

type NaverSize = object;
type NaverPoint = object;

type NaverMap = {
  destroy?: () => void;
  fitBounds: (bounds: NaverLatLngBounds) => void;
  getZoom: () => number;
  panTo: (coordinate: NaverLatLng) => void;
  setCenter: (coordinate: NaverLatLng) => void;
  setSize: (size: NaverSize) => void;
  setZoom: (zoom: number, effect?: boolean) => void;
};

type MarkerIcon = {
  content: string;
  size: NaverSize;
  anchor: NaverPoint;
};

type NaverMarker = {
  setIcon: (icon: MarkerIcon) => void;
  setMap: (map: NaverMap | null) => void;
  setZIndex: (zIndex: number) => void;
};

type NaverMapsNamespace = {
  Event: {
    addListener: (target: object, eventName: string, handler: () => void) => NaverListener;
    removeListener: (listener: NaverListener) => void;
  };
  LatLng: new (latitude: number, longitude: number) => NaverLatLng;
  LatLngBounds: new () => NaverLatLngBounds;
  Map: new (element: HTMLElement, options: Record<string, unknown>) => NaverMap;
  MapTypeId: { NORMAL: unknown };
  Marker: new (options: Record<string, unknown>) => NaverMarker;
  Point: new (x: number, y: number) => NaverPoint;
  Position: { RIGHT_BOTTOM: unknown };
  Size: new (width: number, height: number) => NaverSize;
};

declare global {
  interface Window {
    naver?: { maps: NaverMapsNamespace };
  }
}

type MarkerGroup = {
  latitude: number;
  longitude: number;
  stores: DiscoveryRestaurant[];
};

type MarkerCategory =
  | "cafe"
  | "chicken"
  | "bbq"
  | "korean"
  | "japanese"
  | "western"
  | "bar"
  | "seafood"
  | "restaurant";

function mapLanguage(language: PublicLanguage): NaverLanguage {
  return language === "ja" ? "ja" : "en";
}

function removeExistingNaverScript() {
  document.getElementById(NAVER_SCRIPT_ID)?.remove();
  if (window.naver) delete window.naver;
}

function loadNaverMaps(language: NaverLanguage): Promise<NaverMapsNamespace> {
  const existingScript = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null;
  if (existingScript?.dataset.language === language && window.naver?.maps) {
    return Promise.resolve(window.naver.maps);
  }

  removeExistingNaverScript();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = NAVER_SCRIPT_ID;
    script.dataset.language = language;
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(NAVER_MAP_CLIENT_ID)}&language=${language}`;
    script.onload = () => {
      if (window.naver?.maps) resolve(window.naver.maps);
      else reject(new Error("NAVER Maps SDK was loaded without a map namespace."));
    };
    script.onerror = () => reject(new Error("NAVER Maps SDK failed to load."));
    document.head.appendChild(script);
  });
}

function clusterBucketSize(zoom: number) {
  if (zoom <= 11) return 0.04;
  if (zoom === 12) return 0.025;
  if (zoom === 13) return 0.013;
  if (zoom === 14) return 0.006;
  return 0;
}

function groupStores(stores: DiscoveryRestaurant[], zoom: number, selectedId: string): MarkerGroup[] {
  const validStores = stores.filter((store) => store.latitude != null && store.longitude != null);
  const selectedStore = validStores.find((store) => store.id === selectedId);
  const remaining = selectedStore ? validStores.filter((store) => store.id !== selectedId) : validStores;
  const bucketSize = clusterBucketSize(zoom);

  const groups: MarkerGroup[] = [];
  if (!bucketSize) {
    for (const store of remaining) {
      groups.push({ latitude: store.latitude!, longitude: store.longitude!, stores: [store] });
    }
  } else {
    const grouped = new Map<string, DiscoveryRestaurant[]>();
    for (const store of remaining) {
      const key = `${Math.floor(store.latitude! / bucketSize)}:${Math.floor(store.longitude! / bucketSize)}`;
      const current = grouped.get(key) ?? [];
      current.push(store);
      grouped.set(key, current);
    }

    for (const clusterStores of grouped.values()) {
      const latitude = clusterStores.reduce((sum, store) => sum + store.latitude!, 0) / clusterStores.length;
      const longitude = clusterStores.reduce((sum, store) => sum + store.longitude!, 0) / clusterStores.length;
      groups.push({ latitude, longitude, stores: clusterStores });
    }
  }

  if (selectedStore) {
    groups.push({ latitude: selectedStore.latitude!, longitude: selectedStore.longitude!, stores: [selectedStore] });
  }

  return groups;
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function markerCategory(store: DiscoveryRestaurant): MarkerCategory {
  const text = [
    store.category,
    store.licenseType,
    store.name,
    store.nameEn,
    store.nameJa,
    store.searchKeyword,
    ...store.menus.flatMap((menu) => [menu.nameKo, menu.nameEn, menu.nameJa]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();

  if (includesAny(text, ["치킨", "통닭", "닭강정", "닭갈비", "chicken", "チキン", "鶏肉", "唐揚げ"])) {
    return "chicken";
  }
  if (includesAny(text, ["카페", "커피", "디저트", "베이커리", "제과", "빵", "coffee", "cafe", "café", "dessert", "bakery", "喫茶", "カフェ", "コーヒー", "パン"])) {
    return "cafe";
  }
  if (includesAny(text, ["고기", "구이", "갈비", "삼겹", "곱창", "막창", "바비큐", "barbecue", "bbq", "grill", "焼肉", "焼き肉"])) {
    return "bbq";
  }
  if (includesAny(text, ["일식", "스시", "초밥", "라멘", "우동", "소바", "돈카츠", "사시미", "izakaya", "sushi", "ramen", "udon", "soba", "tonkatsu", "japanese", "寿司", "ラーメン", "うどん", "そば", "とんかつ", "居酒屋", "日本料理"])) {
    return "japanese";
  }
  if (includesAny(text, ["해산물", "횟집", "생선회", "조개", "생선", "seafood", "fish", "刺身", "海鮮", "魚"])) {
    return "seafood";
  }
  if (includesAny(text, ["주점", "술집", "포차", "펍", "와인", "맥주", "칵테일", "pub", "bar", "beer", "wine", "cocktail", "バー", "ビール", "ワイン"])) {
    return "bar";
  }
  if (includesAny(text, ["양식", "파스타", "피자", "버거", "스테이크", "브런치", "pasta", "pizza", "burger", "steak", "brunch", "western", "洋食"])) {
    return "western";
  }
  if (includesAny(text, ["한식", "국밥", "찌개", "전골", "냉면", "비빔밥", "떡볶이", "분식", "korean", "韓国料理"])) {
    return "korean";
  }
  return "restaurant";
}

function markerSvg(category: MarkerCategory) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

  switch (category) {
    case "cafe":
      return `<svg ${common}><path d="M4 6h10v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6Z"/><path d="M14 8h1.5a2.5 2.5 0 0 1 0 5H14"/><path d="M5 19h12"/></svg>`;
    case "chicken":
      return `<svg ${common}><path d="M12.4 13.2c-2.5 2.5-6 3-7.8 1.2s-1.3-5.3 1.2-7.8 5.6-3.2 7.5-1.3 1.6 5.4-.9 7.9Z"/><path d="m12.2 13.1 2.5 2.5"/><path d="M15.5 14.6a2 2 0 0 1 2.8 0c.4.4.6.9.6 1.4.5 0 1 .2 1.4.6a2 2 0 0 1-2.8 2.8l-3.1-3.1"/></svg>`;
    case "bbq":
      return `<svg ${common}><path d="M12.2 3.5c.7 2.7-.4 4.2-1.8 5.5-1.1 1-1.9 2.2-1.9 4a3.5 3.5 0 0 0 7 0c0-1.4-.7-2.7-2-4 .1 1.8-.8 2.9-1.9 3.4.5-2.4-1.1-4.6-2.6-6.4-2.2 2.1-4 4.5-4 7.4a7 7 0 0 0 14 0c0-4.3-3.1-7.7-6.8-9.9Z"/></svg>`;
    case "korean":
      return `<svg ${common}><path d="M4 10h16c0 5-3.2 8-8 8s-8-3-8-8V10Z"/><path d="M6 7c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0"/><path d="M9 21h6"/></svg>`;
    case "japanese":
      return `<svg ${common}><path d="M5 8c0-2.2 3.1-4 7-4s7 1.8 7 4-3.1 4-7 4-7-1.8-7-4Z"/><path d="M5 8v7c0 2.2 3.1 4 7 4s7-1.8 7-4V8"/><path d="M9 12v6M15 12v6"/></svg>`;
    case "western":
      return `<svg ${common}><path d="M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 10v11"/><path d="M17 3v18M17 3c3 2 3 6 0 8"/></svg>`;
    case "bar":
      return `<svg ${common}><path d="M5 4h14l-5 7v7"/><path d="M10 21h8M8 8h8"/></svg>`;
    case "seafood":
      return `<svg ${common}><path d="M4 12s4-5 9-5c3 0 5 2 7 5-2 3-4 5-7 5-5 0-9-5-9-5Z"/><path d="m4 12-2-3v6l2-3Z"/><circle cx="15.5" cy="10.5" r=".8" fill="currentColor" stroke="none"/></svg>`;
    default:
      return `<svg ${common}><circle cx="12" cy="12" r="6"/><path d="M3 12h3M18 12h3M12 3v3M12 18v3"/></svg>`;
  }
}

function markerIcon(maps: NaverMapsNamespace, store: DiscoveryRestaurant, selected: boolean): MarkerIcon {
  const category = markerCategory(store);
  const width = selected ? 42 : 34;
  const height = selected ? 46 : 38;
  return {
    content: `<div class="naver-map-marker category-${category}${selected ? " selected" : ""}" aria-hidden="true"><span class="naver-map-marker-icon">${markerSvg(category)}</span></div>`,
    size: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, height),
  };
}

function clusterIcon(maps: NaverMapsNamespace, count: number): MarkerIcon {
  const size = count >= 100 ? 58 : count >= 10 ? 52 : 46;
  return {
    content: `<div class="naver-map-cluster" aria-label="${count} places"><strong>${count}</strong></div>`,
    size: new maps.Size(size, size),
    anchor: new maps.Point(size / 2, size / 2),
  };
}

export default function DiscoveryMap({
  stores,
  selectedId,
  language,
  onSelect,
}: {
  stores: DiscoveryRestaurant[];
  selectedId: string;
  language: PublicLanguage;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<NaverMap | null>(null);
  const mapsRef = useRef<NaverMapsNamespace | null>(null);
  const markersRef = useRef<NaverMarker[]>([]);
  const listenersRef = useRef<NaverListener[]>([]);
  const zoomListenerRef = useRef<NaverListener | null>(null);
  const lastStoreKeyRef = useRef("");
  const drawMarkersRef = useRef<() => void>(() => undefined);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedId) ?? null,
    [stores, selectedId],
  );

  const clearMarkers = useCallback(() => {
    const maps = mapsRef.current;
    if (maps) {
      for (const listener of listenersRef.current) maps.Event.removeListener(listener);
    }
    listenersRef.current = [];
    for (const marker of markersRef.current) marker.setMap(null);
    markersRef.current = [];
  }, []);

  const drawMarkers = useCallback(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;

    clearMarkers();
    const zoom = map.getZoom();
    const groups = groupStores(stores, zoom, selectedId);

    for (const group of groups) {
      const coordinate = new maps.LatLng(group.latitude, group.longitude);
      const isCluster = group.stores.length > 1;
      const store = group.stores[0];
      const selected = !isCluster && store.id === selectedId;
      const marker = new maps.Marker({
        map,
        position: coordinate,
        icon: isCluster ? clusterIcon(maps, group.stores.length) : markerIcon(maps, store, selected),
        title: isCluster
          ? `${group.stores.length} places`
          : localizedRestaurantName(store, language),
        zIndex: selected ? 500 : isCluster ? 200 : 100,
      });

      marker.setZIndex(selected ? 500 : isCluster ? 200 : 100);
      const listener = maps.Event.addListener(marker, "click", () => {
        if (isCluster) {
          map.setCenter(coordinate);
          map.setZoom(Math.min(17, zoom + 2), true);
        } else {
          onSelect(store.id);
        }
      });

      markersRef.current.push(marker);
      listenersRef.current.push(listener);
    }

    const storeKey = stores
      .filter((store) => store.latitude != null && store.longitude != null)
      .map((store) => store.id)
      .sort()
      .join("|");

    if (storeKey && storeKey !== lastStoreKeyRef.current) {
      const validStores = stores.filter((store) => store.latitude != null && store.longitude != null);
      if (validStores.length === 1) {
        map.setCenter(new maps.LatLng(validStores[0].latitude!, validStores[0].longitude!));
        map.setZoom(16);
      } else if (validStores.length > 1) {
        const bounds = new maps.LatLngBounds();
        for (const store of validStores) bounds.extend(new maps.LatLng(store.latitude!, store.longitude!));
        map.fitBounds(bounds);
      }
      lastStoreKeyRef.current = storeKey;
    }
  }, [clearMarkers, language, onSelect, selectedId, stores]);

  drawMarkersRef.current = drawMarkers;

  useEffect(() => {
    let active = true;
    let observer: ResizeObserver | null = null;
    setMapState("loading");
    lastStoreKeyRef.current = "";

    loadNaverMaps(mapLanguage(language))
      .then((maps) => {
        if (!active || !containerRef.current) return;
        mapsRef.current = maps;
        const map = new maps.Map(containerRef.current, {
          center: new maps.LatLng(37.55, 127.04),
          zoom: 13,
          minZoom: 10,
          maxZoom: 19,
          mapTypeId: maps.MapTypeId.NORMAL,
          zoomControl: true,
          zoomControlOptions: { position: maps.Position.RIGHT_BOTTOM },
          scaleControl: true,
          logoControl: true,
          mapDataControl: true,
        });
        mapRef.current = map;
        zoomListenerRef.current = maps.Event.addListener(map, "zoom_changed", () => drawMarkersRef.current());
        observer = new ResizeObserver(() => {
          if (!containerRef.current || !mapRef.current || !mapsRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          mapRef.current.setSize(new mapsRef.current.Size(rect.width, rect.height));
        });
        observer.observe(containerRef.current);
        setMapState("ready");
        requestAnimationFrame(() => drawMarkersRef.current());
      })
      .catch(() => {
        if (active) setMapState("error");
      });

    return () => {
      active = false;
      observer?.disconnect();
      clearMarkers();
      if (zoomListenerRef.current && mapsRef.current) {
        mapsRef.current.Event.removeListener(zoomListenerRef.current);
      }
      zoomListenerRef.current = null;
      mapRef.current?.destroy?.();
      mapRef.current = null;
      mapsRef.current = null;
    };
  }, [clearMarkers, language]);

  useEffect(() => {
    if (mapState === "ready") drawMarkers();
  }, [drawMarkers, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !selectedStore || selectedStore.latitude == null || selectedStore.longitude == null) return;
    map.panTo(new maps.LatLng(selectedStore.latitude, selectedStore.longitude));
    if (map.getZoom() < 15) map.setZoom(15, true);
  }, [selectedStore]);

  const firstMenu = selectedStore?.menus[0];
  const statusText = language === "ja"
    ? mapState === "error" ? "地図を読み込めませんでした" : "NAVER地図を読み込み中…"
    : mapState === "error" ? "The map could not be loaded" : "Loading NAVER Map…";

  return (
    <div className="discovery-map-wrap">
      <div className="discovery-map" ref={containerRef} />
      {mapState !== "ready" && <div className={`naver-map-status ${mapState}`}>{statusText}</div>}
      {selectedStore && (
        <button className="map-selected-card" type="button" onClick={() => onSelect(selectedStore.id)}>
          <span>{regionLabel(selectedStore.regionKey, language)}</span>
          <strong>{localizedRestaurantName(selectedStore, language)}</strong>
          {firstMenu && <small>{localizedMenuName(firstMenu, language)} · {priceLabel(firstMenu.price, language)}</small>}
        </button>
      )}
    </div>
  );
}
