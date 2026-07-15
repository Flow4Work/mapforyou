"use client";

import { useState } from "react";
import DiscoveryApp from "@/components/DiscoveryApp";
import type { DiscoveryRestaurant, DiscoveryRestaurantPage } from "@/lib/discovery";

const PAGE_SIZE_PER_REGION = 20;

export default function PaginatedDiscoveryApp({
  initialStores,
  initialNextOffset,
}: {
  initialStores: DiscoveryRestaurant[];
  initialNextOffset: number | null;
}) {
  const [stores, setStores] = useState(initialStores);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  async function loadMore() {
    if (nextOffset === null || isLoading) return;

    setIsLoading(true);
    setLoadFailed(false);

    try {
      const response = await fetch(`/api/discovery?offset=${nextOffset}&perRegion=${PAGE_SIZE_PER_REGION}`);
      if (!response.ok) throw new Error(`Discovery request failed: ${response.status}`);

      const page = await response.json() as DiscoveryRestaurantPage;
      setStores((current) => {
        const byId = new Map(current.map((store) => [store.id, store]));
        page.stores.forEach((store) => byId.set(store.id, store));
        return [...byId.values()];
      });
      setNextOffset(page.nextOffset);
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <DiscoveryApp initialStores={stores} />
      {nextOffset !== null && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isLoading}
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 18,
            zIndex: 1200,
            transform: "translateX(-50%)",
            minWidth: 170,
            padding: "12px 18px",
            border: "1px solid rgba(23, 25, 22, 0.12)",
            borderRadius: 999,
            background: "#171916",
            color: "#fff",
            fontWeight: 800,
            boxShadow: "0 12px 32px rgba(23, 25, 22, 0.24)",
          }}
        >
          {isLoading ? "Loading…" : loadFailed ? "Retry · 再試行" : "More places · もっと見る"}
        </button>
      )}
    </>
  );
}
