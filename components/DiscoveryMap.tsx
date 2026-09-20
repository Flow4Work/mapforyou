"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  broadCategory,
  localizedMenuName,
  localizedRestaurantName,
  priceLabel,
  regionLabel,
  type PublicLanguage,
} from "@/lib/discovery-ui";

const HAS_CONFIGURED_NAVER_MAP_CLIENT_ID = Boolean(process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID);
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
  getCenter: () => NaverLatLng;
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
  LatLngBounds: new (southWest?: NaverLatLng, northEast?: NaverLatLng) => NaverLatLngBounds;
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

type MarkerEntry = {
  marker: NaverMarker;
  listener: NaverListener;
  selected: boolean;
};

type MarkerCategory = "cafe" | "korean" | "grill" | "global";

const SEOUL_CENTER = { latitude: 37.5666103, longitude: 126.9783882 };
const SEOUL_BOUNDS = {
  south: 37.42829747263545,
  west: 126.76620435615891,
  north: 37.7010174173061,
  east: 127.18379493229875,
};
const SEOUL_MIN_ZOOM = 11;

function mapLanguage(language: PublicLanguage): NaverLanguage {
  return language === "ja" ? "ja" : "en";
}

let loadedNaverLanguage: NaverLanguage | null = null;
let naverMapsPromise: { language: NaverLanguage; promise: Promise<NaverMapsNamespace> } | null = null;

function loadNaverMaps(language: NaverLanguage): Promise<NaverMapsNamespace> {
  const existingScript = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null;
  const existingLanguage = existingScript?.dataset.language as NaverLanguage | undefined;
  if (window.naver?.maps && (loadedNaverLanguage === language || existingLanguage === language)) {
    loadedNaverLanguage = language;
    return Promise.resolve(window.naver.maps);
  }
  if (naverMapsPromise) {
    if (naverMapsPromise.language === language) return naverMapsPromise.promise;
    return naverMapsPromise.promise
      .catch(() => undefined)
      .then(() => loadNaverMaps(language));
  }

  existingScript?.remove();
  window.naver = undefined;
  loadedNaverLanguage = null;

  const promise = new Promise<NaverMapsNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = NAVER_SCRIPT_ID;
    script.dataset.language = language;
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(NAVER_MAP_CLIENT_ID)}&language=${language}`;
    script.onload = () => {
      if (window.naver?.maps) {
        loadedNaverLanguage = language;
        naverMapsPromise = null;
        resolve(window.naver.maps);
      } else {
        naverMapsPromise = null;
        reject(new Error("NAVER Maps SDK was loaded without a map namespace."));
      }
    };
    script.onerror = () => {
      naverMapsPromise = null;
      reject(new Error("NAVER Maps SDK failed to load."));
    };
    document.head.appendChild(script);
  });
  naverMapsPromise = { language, promise };
  return promise;
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

function markerCategory(store: DiscoveryRestaurant): MarkerCategory {
  const category = broadCategory(store);
  if (category === "cafe" || category === "dessert") return "cafe";
  if (category === "meat") return "grill";
  if (category === "korean") return "korean";
  return "global";
}

function markerSvg(category: MarkerCategory) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true"';

  switch (category) {
    case "cafe":
      return `<svg ${common}><path fill="currentColor" d="M5 6.5h10v6a5 5 0 0 1-5 5 5 5 0 0 1-5-5v-6Zm10 2h1.5a3 3 0 1 1 0 6H15v-2h1.5a1 1 0 1 0 0-2H15v-2ZM6 19h12v2H6z"/></svg>`;
    case "korean":
      return `<svg ${common}><path fill="currentColor" d="M4.5 10h15a7.5 7.5 0 0 1-15 0Zm2.2 7.2h10.6V19H6.7z"/><path d="M8 8V5.8M12 8V4.8M16 8V5.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    case "grill":
      return `<svg ${common}><path fill="currentColor" fill-rule="evenodd" d="M5.3 7.1c2.2-2.7 7-3.2 10.3-.9 3.6 2.5 4.8 6.3 2.6 9.2-2.1 2.8-7 3.6-10.5 1.7-3.8-2.1-4.8-7-2.4-10Zm8.2 2.1a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"/></svg>`;
    default:
      return `<svg ${common}><path fill="currentColor" d="M5 3h2v7h1V3h2v7a4 4 0 0 1-2 3.5V21H6v-7.5A4 4 0 0 1 4 10V3h1Zm10 0h2v8h2V3h2v18h-2v-8h-4V3Z"/></svg>`;
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
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const zoomListenerRef = useRef<NaverListener | null>(null);
  const lastStoreKeyRef = useRef("");
  const preservedViewRef = useRef<{ center: { lat: number; lng: number }; zoom: number } | null>(null);
  const drawMarkersRef = useRef<() => void>(() => undefined);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedId) ?? null,
    [stores, selectedId],
  );

  const clearMarkers = useCallback(() => {
    const maps = mapsRef.current;
    for (const { marker, listener } of markersRef.current.values()) {
      if (maps) maps.Event.removeListener(listener);
      marker.setMap(null);
    }
    markersRef.current.clear();
  }, []);

  const drawMarkers = useCallback(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;

    const zoom = map.getZoom();
    const groups = groupStores(stores, zoom, selectedId);
    const desiredKeys = new Set<string>();

    for (const group of groups) {
      const coordinate = new maps.LatLng(group.latitude, group.longitude);
      const isCluster = group.stores.length > 1;
      const store = group.stores[0];
      const selected = !isCluster && store.id === selectedId;
      const key = isCluster
        ? `cluster:${zoom}:${group.stores.map((item) => item.id).sort().join("|")}`
        : `store:${store.id}`;
      desiredKeys.add(key);

      const existing = markersRef.current.get(key);
      if (existing) {
        if (!isCluster && existing.selected !== selected) {
          existing.marker.setIcon(markerIcon(maps, store, selected));
          existing.marker.setZIndex(selected ? 500 : 100);
          existing.selected = selected;
        }
        continue;
      }

      const marker = new maps.Marker({
        map,
        position: coordinate,
        icon: isCluster ? clusterIcon(maps, group.stores.length) : markerIcon(maps, store, selected),
        title: isCluster
          ? `${group.stores.length} places`
          : store.nameEn || store.name || store.nameJa,
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
      markersRef.current.set(key, { marker, listener, selected });
    }

    for (const [key, entry] of markersRef.current) {
      if (desiredKeys.has(key)) continue;
      maps.Event.removeListener(entry.listener);
      entry.marker.setMap(null);
      markersRef.current.delete(key);
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
  }, [clearMarkers, onSelect, selectedId, stores]);

  drawMarkersRef.current = drawMarkers;

  useEffect(() => {
    let active = true;
    let observer: ResizeObserver | null = null;
    setMapState("loading");

    const host = window.location.hostname;
    if (!HAS_CONFIGURED_NAVER_MAP_CLIENT_ID && (host === "localhost" || host === "127.0.0.1")) {
      setMapState("error");
      return;
    }

    loadNaverMaps(mapLanguage(language))
      .then((maps) => {
        if (!active || !containerRef.current) return;
        mapsRef.current = maps;
        const seoulBounds = new maps.LatLngBounds(
          new maps.LatLng(SEOUL_BOUNDS.south, SEOUL_BOUNDS.west),
          new maps.LatLng(SEOUL_BOUNDS.north, SEOUL_BOUNDS.east),
        );
        const preservedView = preservedViewRef.current;
        const map = new maps.Map(containerRef.current, {
          center: preservedView
            ? new maps.LatLng(preservedView.center.lat, preservedView.center.lng)
            : new maps.LatLng(SEOUL_CENTER.latitude, SEOUL_CENTER.longitude),
          zoom: preservedView?.zoom ?? 12,
          minZoom: SEOUL_MIN_ZOOM,
          maxZoom: 19,
          maxBounds: seoulBounds,
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
      if (mapRef.current) {
        const center = mapRef.current.getCenter();
        preservedViewRef.current = {
          center: { lat: center.lat(), lng: center.lng() },
          zoom: mapRef.current.getZoom(),
        };
      }
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
