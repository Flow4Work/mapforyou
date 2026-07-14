"use client";

import { useEffect } from "react";

type AnalyticsPayload = {
  eventName: "page_view" | "search" | "store_select";
  pagePath?: string;
  language?: "en" | "ja";
  searchQuery?: string;
  region?: string;
  category?: string;
  resultCount?: number;
  storeId?: string;
  storeName?: string;
};

function createAnonymousId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getStoredId(storage: Storage, key: string) {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = createAnonymousId();
    storage.setItem(key, created);
    return created;
  } catch {
    return createAnonymousId();
  }
}

function currentLanguage(): "en" | "ja" {
  const active = document.querySelector<HTMLElement>(".public-language-toggle button.active");
  return active?.textContent?.includes("日本") ? "ja" : "en";
}

export default function AnalyticsTracker() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".discovery-page");
    if (!root) return;

    const visitorId = getStoredId(window.localStorage, "mapforyou_visitor_id");
    const sessionId = getStoredId(window.sessionStorage, "mapforyou_session_id");
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSearchSignature = "";

    const send = (payload: AnalyticsPayload) => {
      void fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          visitorId,
          sessionId,
          pagePath: payload.pagePath ?? window.location.pathname,
          language: payload.language ?? currentLanguage(),
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    send({ eventName: "page_view" });

    const recordSearch = () => {
      const input = root.querySelector<HTMLInputElement>(".discovery-search input");
      const blocks = Array.from(root.querySelectorAll<HTMLElement>(".filter-block"));
      const regionButtons = Array.from(blocks[0]?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const categoryButtons = Array.from(blocks[1]?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const activeRegion = regionButtons.find((button) => button.classList.contains("active"));
      const activeCategory = categoryButtons.find((button) => button.classList.contains("active"));
      const query = input?.value.trim() ?? "";
      const regionIsDefault = !activeRegion || activeRegion === regionButtons[0];
      const categoryIsDefault = !activeCategory || activeCategory === categoryButtons[0];

      if (!query && regionIsDefault && categoryIsDefault) {
        lastSearchSignature = "";
        return;
      }

      const region = regionIsDefault ? "all" : activeRegion?.textContent?.trim() ?? "all";
      const category = categoryIsDefault ? "all" : activeCategory?.textContent?.trim() ?? "all";
      const resultCount = root.querySelectorAll(".discovery-list .discovery-card").length;
      const signature = JSON.stringify([query.toLowerCase(), region, category, resultCount, currentLanguage()]);

      if (signature === lastSearchSignature) return;
      lastSearchSignature = signature;
      send({
        eventName: "search",
        searchQuery: query,
        region,
        category,
        resultCount,
      });
    };

    const scheduleSearch = () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(recordSearch, 650);
    };

    const handleInput = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.matches(".discovery-search input")) scheduleSearch();
    };

    const handleClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest(".filter-block button") || target.closest(".discovery-empty button")) {
        scheduleSearch();
      }

      if (target.closest(".discovery-card") || target.closest(".naver-map-marker")) {
        window.setTimeout(() => {
          const storeName = root.querySelector<HTMLElement>(".detail-panel-header h1")?.textContent?.trim();
          if (storeName) send({ eventName: "store_select", storeName });
        }, 80);
      }
    };

    root.addEventListener("input", handleInput);
    root.addEventListener("click", handleClick);

    return () => {
      if (searchTimer) clearTimeout(searchTimer);
      root.removeEventListener("input", handleInput);
      root.removeEventListener("click", handleClick);
    };
  }, []);

  return null;
}
