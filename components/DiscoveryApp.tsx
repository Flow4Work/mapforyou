"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ImageViewer from "@/components/ImageViewer";
import DetailActionIcon from "@/components/DetailActionIcon";
import RestaurantCover from "@/components/RestaurantCover";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  bookingHomeUrl,
  bookingPlaceUrl,
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
import { representativeMenu } from "@/lib/restaurant-images";

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

const FALLBACK_RATES: ExchangeRates = {
  usdPerKrw: 0.00072,
  jpyPerKrw: 0.108,
  date: "reference estimate",
  source: "fallback",
  isFallback: true,
};

function recommendationScore(store: DiscoveryRestaurant) {
  const category = broadCategory(store);
  const mealPlaceBonus = category === "cafe" || category === "dessert" ? 0 : 10000;
  const featuredMenus = store.menus.filter((menu) => menu.isSpecialty).length;
  const pricedMenus = store.menus.filter((menu) => menu.price > 0).length;
  const verifiedImages = store.menus.filter(
    (menu) => menu.imageStatus === "verified" && /^https?:\/\//i.test(menu.imageUrl),
  ).length;
  const galleryCount = Math.min(store.imageGalleryUrls.length, 8);
  const dataCompleteness = [
    store.nameEn,
    store.nameJa,
    store.roadAddressEn,
    store.roadAddressJa,
    store.imageUrl,
  ].filter((value) => Boolean(value?.trim())).length;

  return (
    mealPlaceBonus +
    featuredMenus * 450 +
    Math.min(pricedMenus, 30) * 45 +
    Math.min(verifiedImages, 24) * 30 +
    galleryCount * 75 +
    dataCompleteness * 80
  );
}

function defaultRecommendationCompare(a: DiscoveryRestaurant, b: DiscoveryRestaurant) {
  return recommendationScore(b) - recommendationScore(a) || a.id.localeCompare(b.id);
}

function compactThumbnailUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "search.pstatic.net") {
      url.searchParams.set("type", "f200_200");
      url.searchParams.set("quality", "85");
      return url.toString();
    }
  } catch {
    return value;
  }
  return value;
}

function DiscoveryListThumb({
  store,
  language,
}: {
  store: DiscoveryRestaurant;
  language: PublicLanguage;
}) {
  const category = broadCategory(store);
  const primaryImage = store.imageUrl || store.imageGalleryUrls[0] || "";
  const fallbackImage = store.imageGalleryUrls.find((url) => url && url !== primaryImage) || "";
  const thumbnailImage = compactThumbnailUrl(primaryImage);

  return (
    <span className={`discovery-card-thumb cover-${category}`} aria-hidden="true">
      {primaryImage ? (
        <img
          src={thumbnailImage}
          alt=""
          width={92}
          height={103}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onError={(event) => {
            const image = event.currentTarget;
            if (fallbackImage && image.dataset.fallback !== "used") {
              image.dataset.fallback = "used";
              image.src = fallbackImage;
            } else {
              image.style.display = "none";
            }
          }}
        />
      ) : (
        <span className="discovery-card-thumb-fallback">{categoryIcon(category)}</span>
      )}
      <span className="discovery-card-thumb-label">{categoryLabel(category, language)}</span>
    </span>
  );
}

const DiscoveryListCard = memo(function DiscoveryListCard({
  store,
  selected,
  language,
  menusLabel,
  showConvertedPrice,
  rates,
  onSelect,
}: {
  store: DiscoveryRestaurant;
  selected: boolean;
  language: PublicLanguage;
  menusLabel: string;
  showConvertedPrice: boolean;
  rates: ExchangeRates;
  onSelect: (id: string) => void;
}) {
  const sampleMenu = representativeMenu(store);
  const storeCategory = broadCategory(store);
  let samplePrice = "";
  if (sampleMenu?.price) {
    if (!showConvertedPrice) samplePrice = `₩${sampleMenu.price.toLocaleString("en-US")}`;
    else if (language === "ja") {
      samplePrice = `約 ¥${Math.round(sampleMenu.price * rates.jpyPerKrw).toLocaleString("ja-JP")}`;
    } else {
      const value = sampleMenu.price * rates.usdPerKrw;
      samplePrice = `≈ $${value.toLocaleString("en-US", {
        minimumFractionDigits: value < 10 ? 2 : 0,
        maximumFractionDigits: 2,
      })}`;
    }
  }

  return (
    <button
      className={`discovery-card ${selected ? "selected" : ""}`}
      type="button"
      onClick={() => onSelect(store.id)}
    >
      <DiscoveryListThumb store={store} language={language} />
      <span className="discovery-card-body">
        <span className="discovery-card-topline">
          <span>
            {regionLabel(store.regionKey, language)} ·{" "}
            {categoryLabel(storeCategory, language)}
          </span>
          <small>{store.menus.length} {menusLabel}</small>
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
            {samplePrice && <strong>{samplePrice}</strong>}
          </span>
        )}
      </span>
    </button>
  );
});

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
  const [selectedId, setSelectedId] = useState(
    () => [...initialStores].sort(defaultRecommendationCompare)[0]?.id ?? "",
  );
  const [showConvertedPrice, setShowConvertedPrice] = useState(false);
  const [rates, setRates] = useState<ExchangeRates>(FALLBACK_RATES);
  const [revealedMenuId, setRevealedMenuId] = useState("");
  const [menuViewMode, setMenuViewMode] = useState<"photo" | "compact">("photo");
  const [menuImageViewer, setMenuImageViewer] = useState<{ src: string; alt: string } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"places" | "map" | "menu">("places");
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsNarrowScreen(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const foodScrollRef = useRef<HTMLDivElement | null>(null);
  const [foodScrollState, setFoodScrollState] = useState({ overflow: false, canLeft: false, canRight: false });

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
          menuTitle: "メニュー",
          currencyLabel: "JPY",
          featured: "おすすめ",
          showStaff: "スタッフに見せる",
          closeStaff: "閉じる",
          staffHelp: "この画面をスタッフに見せてください",
          orderPhrase: "これを一つお願いします",
          convertOn: "円の目安で見る",
          convertOff: "ウォンで見る",
          photoView: "写真",
          compactView: "一覧",
          bookingTicker: "韓国のお店予約をもっと簡単に",
          bookingHeader: "予約サポート",
          bookingPlace: "予約する",
          noPrice: "価格未確認",
          dataNotice:
            "公開データを整理した参考情報です。価格・営業情報は店舗で変更される場合があります。",
          exchangeNotice: "参考為替",
          listTab: "お店",
          mapTab: "地図",
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
          menuTitle: "Menu",
          currencyLabel: "USD",
          featured: "Featured",
          showStaff: "Show to staff",
          closeStaff: "Close Korean",
          staffHelp: "Show this screen to the staff",
          orderPhrase: "One of this, please",
          convertOn: "Estimate in USD",
          convertOff: "Show in won",
          photoView: "Photos",
          compactView: "List",
          bookingTicker: "Need help booking a place in Korea?",
          bookingHeader: "Booking Help",
          bookingPlace: "Book a table",
          noPrice: "Price unavailable",
          dataNotice:
            "This is reference information organized from public data. Prices and operating details may change at the restaurant.",
          exchangeNotice: "Reference rate",
          listTab: "Places",
          mapTab: "Map",
          menuTab: "Menu",
        };

  useEffect(() => {
    setStores(initialStores);
  }, [initialStores]);

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

  const updateFoodScrollState = useCallback(() => {
    const element = foodScrollRef.current;
    if (!element) return;
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    const overflow = maxScroll > 2;
    const next = {
      overflow,
      canLeft: overflow && element.scrollLeft > 2,
      canRight: overflow && element.scrollLeft < maxScroll - 2,
    };
    setFoodScrollState((current) =>
      current.overflow === next.overflow &&
      current.canLeft === next.canLeft &&
      current.canRight === next.canRight
        ? current
        : next,
    );
  }, []);

  const scrollFoodFilters = useCallback((direction: -1 | 1) => {
    const element = foodScrollRef.current;
    if (!element) return;
    const distance = Math.max(180, Math.round(element.clientWidth * 0.78));
    element.scrollBy({ left: direction * distance, behavior: "smooth" });
    window.setTimeout(updateFoodScrollState, 250);
  }, [updateFoodScrollState]);

  useEffect(() => {
    const element = foodScrollRef.current;
    if (!element) return;
    updateFoodScrollState();
    const frame = requestAnimationFrame(updateFoodScrollState);
    const timeout = window.setTimeout(updateFoodScrollState, 120);
    const observer = new ResizeObserver(updateFoodScrollState);
    observer.observe(element);
    window.addEventListener("resize", updateFoodScrollState);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener("resize", updateFoodScrollState);
    };
  }, [categories.length, language, updateFoodScrollState]);

  const filteredStores = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = stores.filter((store) => {
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

    if (!query && category === "all") {
      return [...filtered].sort(defaultRecommendationCompare);
    }
    return filtered;
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

  useEffect(() => {
    setRevealedMenuId("");
    setMenuImageViewer(null);
  }, [selectedStore?.id]);

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
    if (!price) return "";
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
        <a
          className="booking-header-cta"
          href={bookingHomeUrl(language)}
          target="_blank"
          rel="noreferrer"
          aria-label={copy.bookingHeader}
        >
          <span className="booking-ticker-window">
            <span className="booking-ticker-track">
              <span>{copy.bookingTicker}</span>
              <span aria-hidden="true">{copy.bookingTicker}</span>
            </span>
          </span>
          <strong>{copy.bookingHeader}<span aria-hidden="true"> ↗</span></strong>
        </a>
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
          className={mobilePanel === "map" ? "active" : ""}
          aria-pressed={mobilePanel === "map"}
          onClick={() => setMobilePanel("map")}
        >
          {copy.mapTab}
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
              <div className={`food-filter-shell ${foodScrollState.overflow ? "has-overflow" : ""}`}>
                <button
                  className={`food-filter-nav food-filter-nav-left ${foodScrollState.canLeft ? "" : "hidden-direction"}`}
                  type="button"
                  aria-label={language === "ja" ? "料理フィルターを左へ" : "Scroll food filters left"}
                  tabIndex={foodScrollState.canLeft ? 0 : -1}
                  onClick={() => scrollFoodFilters(-1)}
                >
                  ‹
                </button>
                <div
                  ref={foodScrollRef}
                  className="filter-scroll category-filter"
                  onScroll={updateFoodScrollState}
                >
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
                <button
                  className={`food-filter-nav food-filter-nav-right ${foodScrollState.canRight ? "" : "hidden-direction"}`}
                  type="button"
                  aria-label={language === "ja" ? "料理フィルターを右へ" : "Scroll food filters right"}
                  tabIndex={foodScrollState.canRight ? 0 : -1}
                  onClick={() => scrollFoodFilters(1)}
                >
                  ›
                </button>
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
              {filteredStores.map((store) => (
                <DiscoveryListCard
                  key={store.id}
                  store={store}
                  selected={selectedStore?.id === store.id}
                  language={language}
                  menusLabel={copy.menus}
                  showConvertedPrice={showConvertedPrice}
                  rates={showConvertedPrice ? rates : FALLBACK_RATES}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </aside>

        <section className={`discovery-map-panel ${mobilePanel !== "map" ? "mobile-panel-hidden" : ""}`} aria-label={language === "ja" ? "お店の地図" : "Restaurant map"}>
          {(!isNarrowScreen || mobilePanel === "map") && <DiscoveryMap
            stores={filteredStores}
            selectedId={selectedStore?.id ?? ""}
            language={language}
            viewportRegion={region === "all" && regions.length === 1 ? regions[0] : region}
            onSelect={handleSelect}
          />}
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
                    className="booking-place-cta"
                    href={bookingPlaceUrl(selectedStore, language)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="booking-place-spacer" aria-hidden="true" />
                    <span className="booking-place-label">{copy.bookingPlace}</span>
                    <span className="booking-place-arrow" aria-hidden="true">↗</span>
                  </a>
                  <div className="detail-secondary-actions">
                    <a
                      href={`${googleMapUrl(selectedStore)}&hl=${language}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Google Maps"
                      title="Google Maps"
                    >
                      <DetailActionIcon kind="google" />
                      <span>Google</span>
                    </a>
                    <a
                      href={naverMapUrl(selectedStore)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Naver Map"
                      title="Naver Map"
                    >
                      <DetailActionIcon kind="naver" />
                      <span>NAVER</span>
                    </a>
                    {selectedStore.instagramUrl && (
                      <a
                        href={selectedStore.instagramUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Instagram"
                        title="Instagram"
                      >
                        <DetailActionIcon kind="instagram" />
                        <span>Instagram</span>
                      </a>
                    )}
                    {selectedStore.phone && (
                      <a
                        href={`tel:${selectedStore.phone}`}
                        aria-label={copy.call}
                        title={copy.call}
                      >
                        <DetailActionIcon kind="call" />
                        <span>{copy.call}</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <section className="detail-overview-card">
                <span>{copy.about}</span>
                <p>{localizedIntroduction(selectedStore, language)}</p>
              </section>

              <div className="menu-panel-heading">
                <div className="menu-toolbar-meta">
                  <span>{copy.menuTitle}</span>
                  <span aria-hidden="true">·</span>
                  <strong>{selectedStore.menus.length}</strong>
                </div>
                <div className="menu-panel-actions">
                  <div className="menu-view-toggle" role="group" aria-label={copy.menuTitle}>
                    <button
                      className={menuViewMode === "photo" ? "active" : ""}
                      type="button"
                      onClick={() => setMenuViewMode("photo")}
                    >
                      {copy.photoView}
                    </button>
                    <button
                      className={menuViewMode === "compact" ? "active" : ""}
                      type="button"
                      onClick={() => setMenuViewMode("compact")}
                    >
                      {copy.compactView}
                    </button>
                  </div>
                  <button
                    className={`menu-currency-button ${showConvertedPrice ? "active" : ""}`}
                    type="button"
                    title={rateTooltip}
                    aria-pressed={showConvertedPrice}
                    onClick={() => setShowConvertedPrice((current) => !current)}
                  >
                    {copy.currencyLabel} <span aria-hidden="true">ⓘ</span>
                  </button>
                </div>
              </div>

              <div className={`inline-menu-list ${menuViewMode === "compact" ? "compact" : ""}`}>
                {selectedStore.menus.map((menu, index) => {
                  const menuKey = `${selectedStore.id}:${menu.id}:${index}`;
                  const revealed = revealedMenuId === menuKey;
                  const localizedName = localizedMenuName(menu, language);
                  // Empty source descriptions are imported as synthetic placeholders.
                  // Do not show their awkward machine translations as editorial copy.
                  const syntheticDescription = menu.descriptionKo.trim() === `${menu.nameKo.trim()} 메뉴입니다.`;
                  const description = syntheticDescription ? "" : language === "ja"
                    ? menu.descriptionJa || menu.descriptionKo
                    : menu.descriptionEn || menu.descriptionKo;
                  const hasVerifiedImage = menu.imageStatus === "verified" && /^https?:\/\//i.test(menu.imageUrl);
                  if (menuViewMode === "compact") {
                    return (
                      <article className="inline-menu-card compact" key={menuKey}>
                        <div className="inline-menu-row">
                          <h2>{localizedName}</h2>
                          {menu.price > 0 && (
                            <div className="inline-price">
                              <strong>{formatPrice(menu.price)}</strong>
                              {showConvertedPrice && (
                                <small>₩{menu.price.toLocaleString("en-US")}</small>
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  }
                  return (
                    <article className={`inline-menu-card${hasVerifiedImage ? " has-image" : ""}`} key={menuKey}>
                      {hasVerifiedImage && (
                        <button
                          className="inline-menu-image-link"
                          type="button"
                          aria-label={`${localizedName} image`}
                          onClick={() => setMenuImageViewer({ src: menu.imageUrl, alt: localizedName })}
                        >
                          <img className="inline-menu-image" src={menu.imageUrl} alt={localizedName} loading="lazy" />
                        </button>
                      )}
                      <div className="inline-menu-row">
                        <div>
                          {menu.isSpecialty && (
                            <span className="featured-chip">
                              {copy.featured}
                            </span>
                          )}
                          <h2>{localizedName}</h2>
                          {description && <p className="inline-menu-description">{description}</p>}
                        </div>
                        {menu.price > 0 && (
                          <div className="inline-price">
                            <strong>{formatPrice(menu.price)}</strong>
                            {showConvertedPrice && (
                              <small>₩{menu.price.toLocaleString("en-US")}</small>
                            )}
                          </div>
                        )}
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
      {menuImageViewer && (
        <ImageViewer
          src={menuImageViewer.src}
          alt={menuImageViewer.alt}
          onClose={() => setMenuImageViewer(null)}
        />
      )}
    </main>
  );
}
