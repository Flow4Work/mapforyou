"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import { MAP_VIEWPORTS } from "@/lib/config";
import { markerCategory, MAP_MARKER_LABELS, type MapMarkerCategory } from "@/lib/marker-category";
import {
  broadCategory,
  localizedMenuName,
  localizedRestaurantName,
  naverMapUrl,
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

type MarkerCategory = MapMarkerCategory;


function mapLanguage(language: PublicLanguage): NaverLanguage {
  return language === "ja" ? "ja" : "en";
}

// NAVER Maps registers global async callbacks. Reloading the SDK while a
// language toggle is in flight invalidates those callbacks and crashes maps.
let naverMapsPromise: Promise<NaverMapsNamespace> | null = null;

function loadNaverMaps(language: NaverLanguage): Promise<NaverMapsNamespace> {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  if (naverMapsPromise) return naverMapsPromise;

  document.getElementById(NAVER_SCRIPT_ID)?.remove();
  naverMapsPromise = new Promise<NaverMapsNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = NAVER_SCRIPT_ID;
    script.dataset.language = language;
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(NAVER_MAP_CLIENT_ID)}&language=${language}`;
    script.onload = () => {
      if (window.naver?.maps) resolve(window.naver.maps);
      else {
        naverMapsPromise = null;
        reject(new Error("NAVER Maps SDK was loaded without a map namespace."));
      }
    };
    script.onerror = () => {
      naverMapsPromise = null;
      script.remove();
      reject(new Error("NAVER Maps SDK failed to load."));
    };
    document.head.appendChild(script);
  });
  return naverMapsPromise;
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

function markerSvg(category: MarkerCategory) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true"';

  switch (category) {
    // Material Design Icons pig/cow: Pictogrammers (Apache 2.0).
    case "pork":
      return `<svg ${common}><path fill="currentColor" d="M9.5 9A1.5 1.5 0 0 0 8 10.5A1.5 1.5 0 0 0 9.5 12a1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 9.5 9m5 0a1.5 1.5 0 0 0-1.5 1.5a1.5 1.5 0 0 0 1.5 1.5a1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 14.5 9M12 4l.68.03c.94-.79 2.14-1.44 3.04-1.68c1.87-.5 5.16-.12 5.59 1.48c.31 1.17-.71 2.62-2.28 3.55A8.97 8.97 0 0 1 21 13a9 9 0 0 1-9 9a9 9 0 0 1-9-9c0-2.13.74-4.08 1.97-5.62C3.4 6.45 2.38 5 2.69 3.83c.43-1.6 3.72-1.98 5.59-1.48c.9.24 2.1.89 3.04 1.68zm-2 12a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m4 0a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m-2-3c-2.76 0-5 2.34-5 4s2.24 3 5 3s5-1.34 5-3s-2.24-4-5-4M7.76 4.28c-.45-.12-3.17.07-3.17.07S6.8 6.1 7.24 6.22c.45.12 2.53.21 2.67-.32c.15-.54-1.71-1.5-2.15-1.62m8.48 0c-.44.12-2.3 1.08-2.15 1.62c.14.53 2.22.44 2.67.32c.44-.12 2.65-1.87 2.65-1.87s-2.72-.19-3.17-.07"/></svg>`;
    case "beef":
      return `<svg ${common}><path fill="currentColor" d="M10.5 18a.5.5 0 0 1 .5.5a.5.5 0 0 1-.5.5a.5.5 0 0 1-.5-.5a.5.5 0 0 1 .5-.5m3 0a.5.5 0 0 1 .5.5a.5.5 0 0 1-.5.5a.5.5 0 0 1-.5-.5a.5.5 0 0 1 .5-.5M10 11a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m4 0a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m4 7c0 2.21-2.69 4-6 4s-6-1.79-6-4c0-.9.45-1.73 1.2-2.4c-.75-1-1.2-2.25-1.2-3.6l.12-1.22c-.54.15-1.19.15-1.72 0c-1.02-.28-2.56-1.43-2.33-2.23s2.14-.95 3.16-.65c.59.17 1.22.6 1.59 1.06l.57-.81C6.79 7.05 7 4 10 3l-.09.14c-.28.44-1 1.83-.24 3.33a6.02 6.02 0 0 1 4.66 0c.76-1.5.04-2.89-.24-3.33L14 3c3 1 3.21 4.05 2.61 5.15l.57.81c.37-.46 1-.89 1.59-1.06c1.02-.3 2.93-.15 3.16.65s-1.31 1.95-2.33 2.23c-.53.15-1.18.15-1.72 0L18 12c0 1.35-.45 2.6-1.2 3.6c.75.67 1.2 1.5 1.2 2.4m-6-2c-2.21 0-4 .9-4 2s1.79 2 4 2s4-.9 4-2s-1.79-2-4-2m0-2c1.12 0 2.17.21 3.07.56c.58-.69.93-1.56.93-2.56a4 4 0 0 0-4-4a4 4 0 0 0-4 4c0 1 .35 1.87.93 2.56c.9-.35 1.95-.56 3.07-.56m2.09-10.86"/></svg>`;
    case "cafe":
      return `<svg ${common}><path fill="currentColor" d="M5 9h10v4.2a5 5 0 0 1-10 0V9Zm10 1h1.5a3 3 0 1 1 0 6H15v-2h1.5a1 1 0 1 0 0-2H15v-2ZM5 19h13v2H5z"/><path d="M8.2 6.7c0-1.1 1-1.2 1-2.4M12.2 6.7c0-1.1 1-1.2 1-2.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
    case "korean":
      return `<svg ${common}><path fill="currentColor" d="M5 11h14c-.5 4.2-3.2 7-7 7s-6.5-2.8-7-7Zm2.2-1.5C8 7.4 9.6 6.3 12 6.3s4 1.1 4.8 3.2H7.2ZM7 19h10v2H7z"/><path d="M16.3 4 14.4 10M19 4.8 16.8 10.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "grill":
      return `<svg ${common}><path d="M4.7 19.3 19.3 4.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><rect x="5.7" y="12.2" width="5.3" height="4.8" rx="1.3" fill="currentColor" transform="rotate(-45 8.35 14.6)"/><rect x="9.5" y="8.4" width="5.3" height="4.8" rx="1.3" fill="currentColor" transform="rotate(-45 12.15 10.8)"/><rect x="13.3" y="4.6" width="5.3" height="4.8" rx="1.3" fill="currentColor" transform="rotate(-45 15.95 7)"/></svg>`;
    default:
      return `<svg ${common}><path fill="currentColor" d="M5 3h2v7h1V3h2v7a4 4 0 0 1-2 3.5V21H6v-7.5A4 4 0 0 1 4 10V3h1Zm10 0h2v8h2V3h2v18h-2v-8h-4V3Z"/></svg>`;
  }
}

function markerIcon(maps: NaverMapsNamespace, store: DiscoveryRestaurant, selected: boolean): MarkerIcon {
  const category = markerCategory(store, broadCategory(store));
  const width = category === "mixed" ? (selected ? 50 : 44) : (selected ? 42 : 34);
  const height = selected ? 46 : 38;
  const symbol = category === "mixed" ? `${markerSvg("pork")}${markerSvg("beef")}` : markerSvg(category);
  return {
    content: `<div class="naver-map-marker category-${category}${selected ? " selected" : ""}" data-marker-kind="${category}" role="img" aria-label="${MAP_MARKER_LABELS[category].en}"><span class="naver-map-marker-icon">${symbol}</span></div>`,
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
  viewportRegion,
  onSelect,
}: {
  stores: DiscoveryRestaurant[];
  selectedId: string;
  language: PublicLanguage;
  viewportRegion: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<NaverMap | null>(null);
  const mapsRef = useRef<NaverMapsNamespace | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const zoomListenerRef = useRef<NaverListener | null>(null);
  const tilesListenerRef = useRef<NaverListener | null>(null);
  const lastStoreKeyRef = useRef("");
  const preservedViewRef = useRef<{ center: { lat: number; lng: number }; zoom: number; viewportKey: string } | null>(null);
  const drawMarkersRef = useRef<() => void>(() => undefined);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const viewportKey = MAP_VIEWPORTS[viewportRegion] ? viewportRegion : "seoul";
  const viewport = MAP_VIEWPORTS[viewportKey];

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
          : `${localizedRestaurantName(store, language)} · ${MAP_MARKER_LABELS[markerCategory(store, broadCategory(store))][language]}`,
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
        if (map.getZoom() < viewport.minZoom) map.setZoom(viewport.minZoom);
      }
      lastStoreKeyRef.current = storeKey;
    }
  }, [clearMarkers, language, onSelect, selectedId, stores, viewport.minZoom]);

  drawMarkersRef.current = drawMarkers;

  useEffect(() => {
    let active = true;
    let observer: ResizeObserver | null = null;
    let readyTimeout: number | null = null;
    let hasDrawn = false;
    let tilesReady = false;
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
        const maxBounds = new maps.LatLngBounds(
          new maps.LatLng(viewport.maxBounds.south, viewport.maxBounds.west),
          new maps.LatLng(viewport.maxBounds.north, viewport.maxBounds.east),
        );
        const preservedView = preservedViewRef.current?.viewportKey === viewportKey
          ? preservedViewRef.current
          : null;
        const map = new maps.Map(containerRef.current, {
          center: preservedView
            ? new maps.LatLng(preservedView.center.lat, preservedView.center.lng)
            : new maps.LatLng(viewport.center.latitude, viewport.center.longitude),
          zoom: preservedView ? Math.max(preservedView.zoom, viewport.minZoom) : viewport.initialZoom,
          minZoom: viewport.minZoom,
          maxZoom: 19,
          maxBounds,
          mapTypeId: maps.MapTypeId.NORMAL,
          zoomControl: true,
          zoomControlOptions: { position: maps.Position.RIGHT_BOTTOM },
          scaleControl: true,
          logoControl: true,
          mapDataControl: true,
        });
        mapRef.current = map;
        const revealLoadedMap = () => {
          if (!active || tilesReady || !hasDrawn) return;
          tilesReady = true;
          if (readyTimeout !== null) window.clearTimeout(readyTimeout);
          setMapState("ready");
        };
        tilesListenerRef.current = maps.Event.addListener(map, "tilesloaded", revealLoadedMap);
        zoomListenerRef.current = maps.Event.addListener(map, "zoom_changed", () => drawMarkersRef.current());
        observer = new ResizeObserver(() => {
          if (!containerRef.current || !mapRef.current || !mapsRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          mapRef.current.setSize(new mapsRef.current.Size(rect.width, rect.height));
        });
        observer.observe(containerRef.current);
        readyTimeout = window.setTimeout(() => {
          if (!active || tilesReady) return;
          const loaded = [...(containerRef.current?.querySelectorAll("img") ?? [])]
            .filter((image) => image.complete && image.naturalWidth >= 128).length;
          if (loaded >= 2) revealLoadedMap();
          else setMapState("error");
        }, 10000);
        requestAnimationFrame(() => {
          if (!active) return;
          hasDrawn = true;
          drawMarkersRef.current();
        });
      })
      .catch(() => {
        if (active) setMapState("error");
      });

    return () => {
      active = false;
      observer?.disconnect();
      if (readyTimeout !== null) window.clearTimeout(readyTimeout);
      if (mapRef.current) {
        const center = mapRef.current.getCenter();
        preservedViewRef.current = {
          center: { lat: center.lat(), lng: center.lng() },
          zoom: mapRef.current.getZoom(),
          viewportKey,
        };
      }
      clearMarkers();
      if (zoomListenerRef.current && mapsRef.current) {
        mapsRef.current.Event.removeListener(zoomListenerRef.current);
      }
      zoomListenerRef.current = null;
      if (tilesListenerRef.current && mapsRef.current) {
        mapsRef.current.Event.removeListener(tilesListenerRef.current);
      }
      tilesListenerRef.current = null;
      mapRef.current?.destroy?.();
      mapRef.current = null;
      mapsRef.current = null;
    };
  }, [clearMarkers, language, reloadToken, viewportKey, viewport]);

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
      {mapState !== "ready" && (
        <div className={`naver-map-status ${mapState}`} role="status" aria-live="polite">
          <span>{statusText}</span>
          {mapState === "error" && (
            <div className="naver-map-error-actions">
              <button type="button" onClick={() => setReloadToken((count) => count + 1)}>
                {language === "ja" ? "再読み込み" : "Try again"}
              </button>
              {selectedStore && <a href={naverMapUrl(selectedStore)} target="_blank" rel="noreferrer">
                {language === "ja" ? "NAVERマップで開く" : "Open NAVER Map"}
              </a>}
            </div>
          )}
        </div>
      )}
      {mapState === "ready" && (
        <div className="map-meat-legend" aria-label={language === "ja" ? "肉料理の地図記号" : "Meat map marker legend"}>
          {(["pork", "beef", "mixed"] as const).map((kind) => (
            <span className="map-meat-legend-item" key={kind}>
              <span
                className={`map-meat-legend-symbol category-${kind}`}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: kind === "mixed" ? markerSvg("pork") + markerSvg("beef") : markerSvg(kind) }}
              />
              <span>{MAP_MARKER_LABELS[kind][language]}</span>
            </span>
          ))}
        </div>
      )}
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
