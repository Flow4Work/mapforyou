"use client";

import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "@/lib/config";
import type { StoreRecord } from "@/lib/types";

export default function PublicMenu({ initialStore }: { initialStore: StoreRecord }) {
  const [store, setStore] = useState(initialStore);
  const [language, setLanguage] = useState<"en" | "ja">("en");
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.published);
      if (!raw) return;
      const published = JSON.parse(raw) as Record<string, StoreRecord>;
      if (published[initialStore.slug]) setStore(published[initialStore.slug]);
    } catch {
      // Demo fallback stays visible.
    }
  }, [initialStore.slug]);

  const categories = useMemo(() => ["All", ...new Set(store.menus.map((menu) => menu.category || "Menu"))], [store.menus]);
  const menus = store.menus.filter((menu) => activeCategory === "All" || (menu.category || "Menu") === activeCategory);
  const updatedDate = new Date(store.updatedAt).toLocaleDateString(language === "en" ? "en-US" : "ja-JP", { year: "numeric", month: "short", day: "numeric" });

  return (
    <main className="public-page">
      <div className="public-topbar"><a href="/">MapForYou</a><span>Verified multilingual menu</span></div>
      <section className="store-hero">
        <div className="store-hero-overlay" />
        <div className="store-hero-content">
          <span className="store-chip">{store.region} · {store.searchKeyword}</span>
          <h1>{store.name}</h1>
          <p>{language === "en" ? "Menu translated for international visitors" : "海外からのお客様向けに翻訳されたメニュー"}</p>
        </div>
      </section>

      <section className="public-content">
        <div className="language-switch" role="tablist">
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button>
          <button className={language === "ja" ? "active" : ""} onClick={() => setLanguage("ja")}>日本語</button>
        </div>

        <div className="store-info-card">
          <div><span>{language === "en" ? "Address" : "住所"}</span><strong>{store.roadAddress || store.address}</strong></div>
          <div className="store-actions"><a href={store.kakaoUrl} target="_blank" rel="noreferrer">{language === "en" ? "Open map" : "地図を開く"}</a>{store.phone && <a href={`tel:${store.phone}`}>{language === "en" ? "Call" : "電話"}</a>}{store.instagramUrl && <a href={store.instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}</div>
        </div>

        <div className="category-tabs">{categories.map((category) => <button className={activeCategory === category ? "active" : ""} key={category} onClick={() => setActiveCategory(category)}>{category}</button>)}</div>

        <div className="public-menu-list">{menus.map((menu) => {
          const title = language === "en" ? menu.nameEn || menu.nameKo : menu.nameJa || menu.nameKo;
          const description = language === "en" ? menu.descriptionEn || menu.descriptionKo : menu.descriptionJa || menu.descriptionKo;
          return <article className="public-menu-card" key={menu.id}><div><div className="menu-title-row"><h2>{title}</h2>{menu.isRepresentative && <span>{language === "en" ? "Popular" : "おすすめ"}</span>}</div><p>{description}</p><small>{menu.nameKo}</small></div><strong>{menu.price}</strong></article>;
        })}</div>

        <div className="verification-box"><span>✓</span><div><strong>{language === "en" ? "Menu information reviewed" : "メニュー情報を確認済み"}</strong><p>{language === "en" ? `Last checked ${updatedDate}. Prices may change at the store.` : `最終確認日 ${updatedDate}。価格は店舗で変更される場合があります。`}</p></div></div>
      </section>
    </main>
  );
}
