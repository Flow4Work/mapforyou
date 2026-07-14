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

function markerIcon(maps: NaverMapsNamespace, selected: boolean): MarkerIcon {
  const size = selected ? 38 : 28;
  return {
    content: `<div class="naver-map-marker${selected ? " selected" : ""}" aria-hidden="true"><span></span></div>`,
    size: new maps.Size(size, size),
    anchor: new maps.Point(size / 2, size / 2),
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
        icon: isCluster ? clusterIcon(maps, group.stores.length) : markerIcon(maps, selected),
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
