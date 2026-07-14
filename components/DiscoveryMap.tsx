"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  localizedMenuName,
  localizedRestaurantName,
  priceLabel,
  regionLabel,
  type PublicLanguage,
} from "@/lib/discovery-ui";

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
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const selectedStore = useMemo(() => stores.find((store) => store.id === selectedId) ?? null, [stores, selectedId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    }).setView([37.55, 127.04], 13);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const points: L.LatLngExpression[] = [];

    for (const store of stores) {
      if (store.latitude == null || store.longitude == null) continue;
      const point: L.LatLngExpression = [store.latitude, store.longitude];
      points.push(point);

      const selected = store.id === selectedId;
      const marker = L.circleMarker(point, {
        radius: selected ? 10 : 7,
        color: selected ? "#8f271c" : "#ffffff",
        weight: selected ? 4 : 3,
        fillColor: selected ? "#ffcf45" : "#e64b35",
        fillOpacity: 1,
      });

      marker.bindTooltip(localizedRestaurantName(store, language), {
        direction: "top",
        offset: [0, -8],
        opacity: 0.96,
      });
      marker.on("click", () => onSelect(store.id));
      marker.addTo(layer);
    }

    if (points.length === 1) {
      map.setView(points[0], 15, { animate: false });
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [38, 38], maxZoom: 15, animate: false });
    }
  }, [stores, selectedId, language, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStore || selectedStore.latitude == null || selectedStore.longitude == null) return;
    map.flyTo([selectedStore.latitude, selectedStore.longitude], Math.max(map.getZoom(), 15), { duration: 0.38 });
  }, [selectedStore]);

  const firstMenu = selectedStore?.menus[0];

  return (
    <div className="discovery-map-wrap">
      <div className="discovery-map" ref={containerRef} />
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
