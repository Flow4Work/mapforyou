"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RestaurantCover from "@/components/RestaurantCover";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  broadCategory,
  categoryIcon,
  categoryLabel,
  googleMapUrl,
  localizedAddress,
  localizedIntroduction,
  localizedMenuName,
  localizedRestaurantName,
  naverMapUrl,
  regionLabel,
  type BroadCategory,
  type PublicLanguage,
} from "@/lib/discovery-ui";

const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), {
  ssr: false,
  loading: () => <div className="discovery-map-loading">Loading map…</div>,
});

const CATEGORY_ORDER: BroadCategory[] = [
  "cafe",
  "korean",
  "meat",
  "japanese",
  "chinese",
  "dessert",
  "other",
];

type ExchangeRates = {
  usdPerKrw: number;
  jpyPerKrw: number;
  date: string;
  source: string;
  isFallback: boolean;
};

type DiscoveryResponse = {
  stores?: DiscoveryRestaurant[];
};

const FALLBACK_RATES: ExchangeRates = {
  usdPerKrw: 0.00072,
  jpyPerKrw: 0.108,
  date: "reference estimate",
  source: "fallback",
  isFallback: true,
};

export default function DiscoveryApp({
  initialStores,
}: {
  initialStores: DiscoveryRestaurant[];
}) {
  const [stores, setStores] = useState(initialStores);
  const [language, setLanguage] = useState<PublicLanguage>("en");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [category, setCategory] = useState<"all" | BroadCategory>("all");
  const [selectedId, setSelectedId] = useState(initialStores[0]?.id ?? "");
  const [showConvertedPrice, setShowConvertedPrice] = useState(false);
  const [rates, setRates] = useState<ExchangeRates>(FALLBACK_RATES);
  const [revealedMenuId, setRevealedMenuId] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"places" | "menu">("places");
  const refreshAbortRef = useRef<AbortController | null>(null);

  const copy =
    language === "ja"
      ? {
          tagline: "読めるメニューから探す、ソウルのフードマップ",
          search: "店名・メニューを検索",
          areas: "エリア",
          allAreas: "すべて",
          food: "料理",
          allFood: "すべて",
          recommendations: "おすすめ店舗",
          places: "店舗",
          menus: "メニュー",
          noResults: "条件に合うお店がありません。",
          reset: "条件をリセット",
          details: "店舗情報",
          directions: "地図を開く",
          call: "電話",
          about: "このお店について",
          menuTitle: "翻訳メニュー",
          featured: "おすすめ",
          showStaff: "スタッフに見せる",
          closeStaff: "閉じる",
          staffHelp: "この画面をスタッフに見せてください",
          orderPhrase: "これを一つお願いします",
          convertOn: "円の目安で見る",
          convertOff: "ウォンで見る",
          noPrice: "価格未確認",
          dataNotice:
            "公開データを整理した参考情報です。価格・営業情報は店舗で変更される場合があります。",
          exchangeNotice: "参考為替",
          listTab: "お店",
          menuTab: "メニュー",
        }
      : {
          tagline: "A Seoul food map built around menus you can read",
          search: "Search restaurants or menus",
          areas: "Area",
          allAreas: "All",
          food: "Food",
          allFood: "All",
          recommendations: "Recommended places",
          places: "places",
          menus: "menus",
          noResults: "No restaurants match these filters.",
          reset: "Reset filters",
          details: "Place details",
          directions: "Open maps",
          call: "Call",
          about: "About this place",
          menuTitle: "Translated menu",
          featured: "Featured",
          showStaff: "Show to staff",
          closeStaff: "Close Korean",
          staffHelp: "Show this screen to the staff",
          orderPhrase: "One of this, please",
          convertOn: "Estimate in USD",
          convertOff: "Show in won",
          noPrice: "Price unavailable",
          dataNotice:
            "This is reference information organized from public data. Prices and operating details may change at the restaurant.",
          exchangeNotice: "Reference rate",
          listTab: "Places",
          menuTab: "Menu",
        };

  useEffect(() => {
    setStores(initialStores);
  }, [initialStores]);

  const refreshStores = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      const response = await fetch(
        `/api/discovery?offset=0&perRegion=1000&_=${Date.now()}`,
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) return;

      const data = (await response.json()) as DiscoveryResponse;
      if (Array.isArray(data.stores)) setStores(data.stores);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        console.error("Failed to refresh discovery data", error);
      }
    } finally {
      if (refreshAbortRef.current === controller)
        refreshAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refreshStores();

    const handleFocus = () => void refreshStores();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshStores();
    };
    const timer = window.setInterval(() => void refreshStores(), 60_000);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      refreshAbortRef.current?.abort();
    };
  }, [refreshStores]);

  useEffect(() => {
    let active = true;
    fetch("/api/exchange-rates")
      .then((response) => response.json())
      .then((data: ExchangeRates) => {
        if (
          active &&
          Number.isFinite(data.usdPerKrw) &&
          Number.isFinite(data.jpyPerKrw)
        )
          setRates(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setShowConvertedPrice(false);
  }, [language]);

  const regions = useMemo(
    () => [...new Set(stores.map((store) => store.regionKey).filter(Boolean))],
    [stores],
  );
  const categories = useMemo(() => {
    const available = new Set(stores.map(broadCategory));
    return CATEGORY_ORDER.filter((item) => available.has(item));
  }, [stores]);

  const filteredStores = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stores.filter((store) => {
      if (region !== "all" && store.regionKey !== region) return false;
      if (category !== "all" && broadCategory(store) !== category) return false;
      if (!query) return true;

      const menuText = store.menus
        .flatMap((menu) => [menu.nameKo, menu.nameEn, menu.nameJa])
        .join(" ");
      const localizedText = `${localizedRestaurantName(store, language)} ${localizedAddress(store, language)}`;
      return `${store.name} ${store.category} ${store.roadAddress} ${localizedText} ${menuText}`
        .toLowerCase()
        .includes(query);
    });
  }, [stores, region, category, search, language]);

  useEffect(() => {
    if (!filteredStores.some((store) => store.id === selectedId))
      setSelectedId(filteredStores[0]?.id ?? "");
  }, [filteredStores, selectedId]);

  const selectedStore = useMemo(
    () =>
      filteredStores.find((store) => store.id === selectedId) ??
      filteredStores[0] ??
      null,
    [filteredStores, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setRevealedMenuId("");
    setMobilePanel("menu");
  }, []);

  function resetFilters() {
    setSearch("");
    setRegion("all");
    setCategory("all");
  }

  function formatPrice(price: number) {
    if (!price) return copy.noPrice;
    if (!showConvertedPrice) return `₩${price.toLocaleString("en-US")}`;
    if (language === "ja")
      return `約 ¥${Math.round(price * rates.jpyPerKrw).toLocaleString("ja-JP")}`;
    const value = price * rates.usdPerKrw;
    return `≈ $${value.toLocaleString("en-US", { minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }

  const rateTooltip =
    language === "ja"
      ? `${copy.exchangeNotice} (${rates.date}): 100円 ≈ ₩${Math.round(100 / rates.jpyPerKrw).toLocaleString("ja-JP")}。カード会社・両替所・更新時刻により実際の金額と異なる場合があります。`
      : `${copy.exchangeNotice} (${rates.date}): $1 ≈ ₩${Math.round(1 / rates.usdPerKrw).toLocaleString("en-US")}. The final card or cash rate may differ by provider and time.`;

  return (
    <main className="discovery-page">
      <header className="discovery-header">
        <div className="discovery-brand">
          <span className="brand-mark">M</span>
          <span>
            MapForYou<small>{copy.tagline}</small>
          </span>
        </div>
        <div className="header-actions">
          <button
            className={`currency-header-button ${showConvertedPrice ? "active" : ""}`}
            type="button"
            title={rateTooltip}
            onClick={() => setShowConvertedPrice((current) => !current)}
          >
            {showConvertedPrice ? copy.convertOff : copy.convertOn}
            <span aria-hidden="true">ⓘ</span>
          </button>
          <div className="public-language-toggle" aria-label="Language">
            <button
              className={language === "en" ? "active" : ""}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
            <button
              className={language === "ja" ? "active" : ""}
              onClick={() => setLanguage("ja")}
            >
              日本語
            </button>
          </div>
        </div>
      </header>

      <nav className="mobile-panel-tabs" aria-label="Mobile panels">
        <button
          className={mobilePanel === "places" ? "active" : ""}
          onClick={() => setMobilePanel("places")}
        >
          {copy.listTab}
        </button>
        <button
          className={mobilePanel === "menu" ? "active" : ""}
          onClick={() => setMobilePanel("menu")}
        >
          {copy.menuTab}
        </button>
      </nav>

      <section className="discovery-workspace">
        <aside
          className={`discovery-list-panel ${mobilePanel !== "places" ? "mobile-panel-hidden" : ""}`}
        >
          <div className="list-controls">
            <label className="discovery-search">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.search}
              />
            </label>

            <div className="filter-block">
              <span>{copy.areas}</span>
              <div className="filter-scroll">
                <button
                  className={region === "all" ? "active" : ""}
                  onClick={() => setRegion("all")}
                >
                  {copy.allAreas}
                </button>
                {regions.map((item) => (
                  <button
                    className={region === item ? "active" : ""}
                    key={item}
                    onClick={() => setRegion(item)}
                  >
                    {regionLabel(item, language)}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <span>{copy.food}</span>
              <div className="filter-scroll category-filter">
                <button
                  className={category === "all" ? "active" : ""}
                  onClick={() => setCategory("all")}
                >
                  {copy.allFood}
                </button>
                {categories.map((item) => (
                  <button
                    className={category === item ? "active" : ""}
                    key={item}
                    onClick={() => setCategory(item)}
                  >
                    {categoryIcon(item)} {categoryLabel(item, language)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="discovery-list-heading">
            <strong>{copy.recommendations}</strong>
            <span>
              {filteredStores.length} {copy.places}
            </span>
          </div>

          {!filteredStores.length ? (
            <div className="discovery-empty">
              <strong>{copy.noResults}</strong>
              <button onClick={resetFilters}>{copy.reset}</button>
            </div>
          ) : (
            <div className="discovery-list">
              {filteredStores.map((store) => {
                const selected = selectedStore?.id === store.id;
                const sampleMenu = store.menus[0];
                const storeCategory = broadCategory(store);
                return (
                  <button
                    className={`discovery-card ${selected ? "selected" : ""}`}
                    type="button"
                    key={store.id}
                    onClick={() => handleSelect(store.id)}
                  >
                    <RestaurantCover
                      store={store}
                      language={language}
                      compact
                    />
                    <span className="discovery-card-body">
                      <span className="discovery-card-topline">
                        <span>
                          {regionLabel(store.regionKey, language)} ·{" "}
                          {categoryLabel(storeCategory, language)}
                        </span>
                        <small>
                          {store.menus.length} {copy.menus}
                        </small>
                      </span>
                      <strong className="restaurant-card-name">
                        {localizedRestaurantName(store, language)}
                      </strong>
                      <span className="discovery-address">
                        {localizedAddress(store, language)}
                      </span>
                      {sampleMenu && (
                        <span className="menu-preview-row">
                          <span>{localizedMenuName(sampleMenu, language)}</span>
                          <strong>{formatPrice(sampleMenu.price)}</strong>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="discovery-map-panel">
          <DiscoveryMap
            stores={filteredStores}
            selectedId={selectedStore?.id ?? ""}
            language={language}
            onSelect={handleSelect}
          />
        </section>

        <aside
          className={`restaurant-detail-panel ${mobilePanel !== "menu" ? "mobile-panel-hidden" : ""}`}
        >
          {selectedStore ? (
            <div className="restaurant-detail-scroll">
              <RestaurantCover store={selectedStore} language={language} />

              <div className="detail-panel-header">
                <div className="detail-panel-kicker">
                  <span>{regionLabel(selectedStore.regionKey, language)}</span>
                  <span>
                    {categoryLabel(broadCategory(selectedStore), language)}
                  </span>
                </div>
                <h1>{localizedRestaurantName(selectedStore, language)}</h1>
                <p>{localizedAddress(selectedStore, language)}</p>
                <div className="detail-panel-actions">
                  <a
                    href={`${googleMapUrl(selectedStore)}&hl=${language}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Maps
                  </a>
                  <a
                    href={naverMapUrl(selectedStore)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Naver Map
                  </a>
                  {selectedStore.phone && (
                    <a href={`tel:${selectedStore.phone}`}>{copy.call}</a>
                  )}
                </div>
              </div>

              <section className="detail-overview-card">
                <span>{copy.about}</span>
                <p>{localizedIntroduction(selectedStore, language)}</p>
              </section>

              <div className="menu-panel-heading">
                <div>
                  <span>{copy.menuTitle}</span>
                  <strong>
                    {selectedStore.menus.length} {copy.menus}
                  </strong>
                </div>
                <button
                  className={showConvertedPrice ? "active" : ""}
                  type="button"
                  title={rateTooltip}
                  onClick={() => setShowConvertedPrice((current) => !current)}
                >
                  {showConvertedPrice ? copy.convertOff : copy.convertOn} ⓘ
                </button>
              </div>

              <div className="inline-menu-list">
                {selectedStore.menus.map((menu, index) => {
                  const menuKey = `${selectedStore.id}:${menu.id}:${index}`;
                  const revealed = revealedMenuId === menuKey;
                  return (
                    <article className="inline-menu-card" key={menuKey}>
                      <div className="inline-menu-row">
                        <div>
                          {menu.isSpecialty && (
                            <span className="featured-chip">
                              {copy.featured}
                            </span>
                          )}
                          <h2>{localizedMenuName(menu, language)}</h2>
                        </div>
                        <div className="inline-price">
                          <strong>{formatPrice(menu.price)}</strong>
                          {showConvertedPrice && menu.price > 0 && (
                            <small>₩{menu.price.toLocaleString("en-US")}</small>
                          )}
                        </div>
                      </div>
                      <button
                        className="show-staff-button"
                        type="button"
                        onClick={() =>
                          setRevealedMenuId(revealed ? "" : menuKey)
                        }
                      >
                        {revealed ? copy.closeStaff : copy.showStaff}
                      </button>
                      {revealed && (
                        <div className="staff-display-card">
                          <small>{copy.staffHelp}</small>
                          <strong>{menu.nameKo}</strong>
                          <span>이 메뉴 하나 주세요.</span>
                          <em>{copy.orderPhrase}</em>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <p className="detail-data-note">
                ⓘ {copy.dataNotice}
                <br />
                {rateTooltip}
              </p>
            </div>
          ) : (
            <div className="detail-panel-empty">{copy.noResults}</div>
          )}
        </aside>
      </section>
    </main>
  );
}
