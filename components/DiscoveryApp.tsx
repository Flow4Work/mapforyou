"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import RestaurantCover from "@/components/RestaurantCover";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  broadCategory,
  categoryLabel,
  localizedMenuName,
  priceLabel,
  regionLabel,
  type BroadCategory,
  type PublicLanguage,
} from "@/lib/discovery-ui";

const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), {
  ssr: false,
  loading: () => <div className="discovery-map-loading">Loading map…</div>,
});

const CATEGORY_ORDER: BroadCategory[] = ["cafe", "korean", "meat", "japanese", "chinese", "dessert", "other"];

export default function DiscoveryApp({ initialStores }: { initialStores: DiscoveryRestaurant[] }) {
  const [language, setLanguage] = useState<PublicLanguage>("en");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [category, setCategory] = useState<"all" | BroadCategory>("all");
  const [selectedId, setSelectedId] = useState(initialStores[0]?.id ?? "");

  const copy = language === "ja"
    ? {
        eyebrow: "SEOUL FOOD MAP",
        title: "読めるメニューから、\n行きたいお店を探す。",
        description: "聖水・弘大の飲食店を地図で探し、翻訳済みのメニューと価格を来店前に確認できます。",
        search: "店名・メニューを検索",
        allAreas: "すべてのエリア",
        allFood: "すべて",
        results: "店舗",
        menuCount: "メニュー",
        viewMenu: "メニューを見る",
        noResults: "条件に合うお店がありません。",
        reset: "条件をリセット",
        dataNote: "メニューと価格は公開データを整理して表示しています。店舗で変更される場合があります。",
      }
    : {
        eyebrow: "SEOUL FOOD MAP",
        title: "Find the place.\nRead the menu first.",
        description: "Explore restaurants in Seongsu and Hongdae on a map, then check translated menus and prices before you visit.",
        search: "Search restaurants or menus",
        allAreas: "All areas",
        allFood: "All food",
        results: "places",
        menuCount: "menus",
        viewMenu: "View menu",
        noResults: "No restaurants match these filters.",
        reset: "Reset filters",
        dataNote: "Menus and prices are organized from public data and may change at the restaurant.",
      };

  const regions = useMemo(() => [...new Set(initialStores.map((store) => store.regionKey).filter(Boolean))], [initialStores]);
  const categories = useMemo(() => {
    const available = new Set(initialStores.map(broadCategory));
    return CATEGORY_ORDER.filter((item) => available.has(item));
  }, [initialStores]);

  const filteredStores = useMemo(() => {
    const query = search.trim().toLowerCase();
    return initialStores.filter((store) => {
      if (region !== "all" && store.regionKey !== region) return false;
      if (category !== "all" && broadCategory(store) !== category) return false;
      if (!query) return true;

      const menuText = store.menus
        .flatMap((menu) => [menu.nameKo, menu.nameEn, menu.nameJa])
        .join(" ");
      return `${store.name} ${store.category} ${store.roadAddress} ${menuText}`.toLowerCase().includes(query);
    });
  }, [initialStores, region, category, search]);

  useEffect(() => {
    if (!filteredStores.some((store) => store.id === selectedId)) {
      setSelectedId(filteredStores[0]?.id ?? "");
    }
  }, [filteredStores, selectedId]);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  function resetFilters() {
    setSearch("");
    setRegion("all");
    setCategory("all");
  }

  return (
    <main className="discovery-page">
      <header className="discovery-header">
        <Link className="discovery-brand" href="/">
          <span className="brand-mark">M</span>
          <span>MapForYou<small>Translated Seoul Menus</small></span>
        </Link>
        <div className="public-language-toggle" aria-label="Language">
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
          <button className={language === "ja" ? "active" : ""} onClick={() => setLanguage("ja")}>日本語</button>
        </div>
      </header>

      <section className="discovery-intro">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title.split("\n").map((line) => <span key={line}>{line}</span>)}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="discovery-stat">
          <strong>{initialStores.length}</strong>
          <span>{language === "ja" ? "翻訳メニュー掲載店" : "restaurants with translated menus"}</span>
        </div>
      </section>

      <section className="discovery-filters" aria-label="Restaurant filters">
        <label className="discovery-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} />
        </label>
        <div className="filter-scroll">
          <button className={region === "all" ? "active" : ""} onClick={() => setRegion("all")}>{copy.allAreas}</button>
          {regions.map((item) => (
            <button className={region === item ? "active" : ""} key={item} onClick={() => setRegion(item)}>
              {regionLabel(item, language)}
            </button>
          ))}
        </div>
        <div className="filter-scroll category-filter">
          <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>{copy.allFood}</button>
          {categories.map((item) => (
            <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>
              {categoryLabel(item, language)}
            </button>
          ))}
        </div>
      </section>

      <section className="discovery-layout">
        <div className="discovery-list-panel">
          <div className="discovery-list-heading">
            <strong>{filteredStores.length} {copy.results}</strong>
            <span>{language === "ja" ? "ピンを選ぶと地図が移動します" : "Select a card to focus the map"}</span>
          </div>

          {!filteredStores.length ? (
            <div className="discovery-empty">
              <strong>{copy.noResults}</strong>
              <button onClick={resetFilters}>{copy.reset}</button>
            </div>
          ) : (
            <div className="discovery-list">
              {filteredStores.map((store) => {
                const selected = selectedId === store.id;
                const sampleMenus = store.menus.slice(0, 2);
                const storeCategory = broadCategory(store);
                return (
                  <article className={`discovery-card ${selected ? "selected" : ""}`} key={store.id} onClick={() => handleSelect(store.id)}>
                    <RestaurantCover store={store} language={language} compact />
                    <div className="discovery-card-body">
                      <div className="discovery-card-topline">
                        <span>{regionLabel(store.regionKey, language)} · {categoryLabel(storeCategory, language)}</span>
                        <small>{store.menus.length} {copy.menuCount}</small>
                      </div>
                      <h2>{store.name}</h2>
                      <p className="discovery-address">{store.roadAddress || store.address}</p>
                      <div className="menu-preview-list">
                        {sampleMenus.map((menu) => (
                          <div key={menu.id}>
                            <span>{localizedMenuName(menu, language)}</span>
                            <strong>{priceLabel(menu.price, language)}</strong>
                          </div>
                        ))}
                      </div>
                      <Link className="view-menu-link" href={`/place/${store.id}`} onClick={(event) => event.stopPropagation()}>
                        {copy.viewMenu} <span>→</span>
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="discovery-map-panel">
          <DiscoveryMap stores={filteredStores} selectedId={selectedId} language={language} onSelect={handleSelect} />
        </div>
      </section>

      <footer className="discovery-footer">
        <strong>MapForYou</strong>
        <span>{copy.dataNote}</span>
      </footer>
    </main>
  );
}
