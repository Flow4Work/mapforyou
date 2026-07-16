"use client";

import { useEffect } from "react";

type StoreRef = {
  id?: string;
  name?: string;
  nameEn?: string;
  nameJa?: string;
};

function normalized(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export default function PublicQualityGuard() {
  useEffect(() => {
    let cancelled = false;
    let stores: StoreRef[] = [];
    let scheduled = false;

    const applyExactNaverLink = () => {
      scheduled = false;
      const title = normalized(document.querySelector<HTMLElement>(".detail-panel-header h1")?.textContent);
      if (!title || stores.length === 0) return;

      const store = stores.find((item) => [item.name, item.nameEn, item.nameJa].some((value) => normalized(value) === title));
      const placeId = String(store?.id || "").match(/^naver:(\d{5,})$/)?.[1];
      if (!placeId) return;

      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(".detail-panel-actions a"))
        .find((anchor) => /naver\s*map/i.test(anchor.textContent || ""));
      if (!link) return;

      link.href = `https://map.naver.com/p/entry/place/${placeId}?placePath=/home`;
      link.dataset.exactPlaceId = placeId;
    };

    const scheduleApply = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(applyExactNaverLink);
    };

    fetch("/api/discovery?offset=0&perRegion=1000", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Discovery lookup failed")))
      .then((data: { stores?: StoreRef[] }) => {
        if (cancelled) return;
        stores = Array.isArray(data.stores) ? data.stores : [];
        scheduleApply();
      })
      .catch(() => undefined);

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", scheduleApply, true);

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("click", scheduleApply, true);
    };
  }, []);

  return null;
}
