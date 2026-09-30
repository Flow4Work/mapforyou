"use client";

import { useEffect, useState } from "react";
import DiscoveryApp from "@/components/DiscoveryApp";
import type { DiscoveryRestaurant } from "@/lib/discovery";

const BACKGROUND_PER_REGION = 20;
const BACKGROUND_START_DELAY_MS = 2500;
const BACKGROUND_PAGE_GAP_MS = 500;

function mergeStores(current: DiscoveryRestaurant[], incoming: DiscoveryRestaurant[]) {
  const merged = new Map(current.map((store) => [store.id, store]));
  for (const store of incoming) merged.set(store.id, store);
  return [...merged.values()];
}

export default function PaginatedDiscoveryApp({
  initialStores,
  initialNextOffset,
}: {
  initialStores: DiscoveryRestaurant[];
  initialNextOffset: number | null;
}) {
  const [stores, setStores] = useState(initialStores);

  useEffect(() => {
    setStores(initialStores);
  }, [initialStores]);

  useEffect(() => {
    if (initialNextOffset === null) return;

    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;

    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    async function loadRemaining() {
      let offset: number | null = initialNextOffset;

      try {
        while (active && offset !== null) {
          const response = await fetch(
            `/api/discovery?offset=${offset}&perRegion=${BACKGROUND_PER_REGION}`,
            { signal: controller.signal },
          );
          if (!response.ok) return;

          const data = (await response.json()) as {
            stores?: DiscoveryRestaurant[];
            nextOffset?: number | null;
          };

          if (!active) return;
          if (Array.isArray(data.stores) && data.stores.length) {
            setStores((current) => mergeStores(current, data.stores!));
          }
          offset =
            typeof data.nextOffset === "number" ? data.nextOffset : null;

          if (offset !== null) await pause(BACKGROUND_PAGE_GAP_MS);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Background discovery loading failed", error);
        }
      }
    }

    timer = window.setTimeout(() => {
      void loadRemaining();
    }, BACKGROUND_START_DELAY_MS);

    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [initialNextOffset]);

  return <DiscoveryApp initialStores={stores} />;
}
