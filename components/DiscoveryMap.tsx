"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import { MAP_VIEWPORTS } from "@/lib/config";
import { markerCategory, MAP_MARKER_LABELS, type MapMarkerCategory } from "@/lib/marker-category";
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
    case "pork":
      return `<svg ${common} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"><path d="M6.2 8 4.3 3.8c2.5.3 4.3 1.5 5 3M17.8 8l1.9-4.2c-2.5.3-4.3 1.5-5 3"/><path d="M4.7 12.6C4.7 8.4 7.6 6 12 6s7.3 2.4 7.3 6.6-3 7.7-7.3 7.7-7.3-3.5-7.3-7.7Z"/><path d="M9 12h.1m5.8 0h.1" stroke-width="2.5"/><ellipse cx="12" cy="15.8" rx="3.7" ry="2.6"/><path d="M10.8 15.3v1m2.4-1v1"/></svg>`;
    case "beef":
      return `<svg ${common} fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round" stroke-linecap="round"><path d="M8 6.4c-2.1-.5-3.4-1.7-3.8-4 2.4.2 4.1 1.5 4.9 3.1m6.9.9c2.1-.5 3.4-1.7 3.8-4-2.4.2-4.1 1.5-4.9 3.1"/><path d="m6.6 8.5-3-1.6-.6 3 2.8 1.5m11.6-2.9 3-1.6.6 3-2.8 1.5"/><path d="M6.5 7.7a6.5 6.5 0 0 1 11 0l1.2 6.3a6.5 6.5 0 0 1-13.4 0l1.2-6.3Z"/><path d="M8.9 11.6h.1m6 0h.1" stroke-width="2.5"/><path d="M8.2 15.5c.6-1.2 1.9-1.8 3.8-1.8s3.2.6 3.8 1.8v2.2c-.8 1.3-2.1 2-3.8 2s-3-.7-3.8-2v-2.2Z"/><path d="M10.5 16.7v.8m3-.8v.8"/></svg>`;
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
  const lastStoreKeyRef = useRef("");
  const preservedViewRef = useRef<{ center: { lat: number; lng: number }; zoom: number; viewportKey: string } | null>(null);
  const drawMarkersRef = useRef<() => void>(() => undefined);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");
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
          viewportKey,
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
  }, [clearMarkers, language, viewportKey, viewport]);

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
