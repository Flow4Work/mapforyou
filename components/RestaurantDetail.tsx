"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import RestaurantCover from "@/components/RestaurantCover";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  broadCategory,
  categoryLabel,
  googleMapUrl,
  localizedMenuName,
  naverMapUrl,
  priceLabel,
  regionLabel,
  type PublicLanguage,
} from "@/lib/discovery-ui";

const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), {
  ssr: false,
  loading: () => <div className="detail-map-loading">Loading map…</div>,
});

const ORDER_PHRASES = {
  en: [
    { label: "One of this, please", ko: "이 메뉴 하나 주세요." },
    { label: "Please make it less spicy", ko: "덜 맵게 해주세요." },
    { label: "Can I pay by card?", ko: "카드 결제 가능해요?" },
  ],
  ja: [
    { label: "これを一つお願いします", ko: "이 메뉴 하나 주세요." },
    { label: "辛さを控えめにしてください", ko: "덜 맵게 해주세요." },
    { label: "カードで払えますか？", ko: "카드 결제 가능해요?" },
  ],
};

export default function RestaurantDetail({ store }: { store: DiscoveryRestaurant }) {
  const [language, setLanguage] = useState<PublicLanguage>("en");
  const [revealedMenuId, setRevealedMenuId] = useState("");
  const [revealedPhrase, setRevealedPhrase] = useState("");
  const category = broadCategory(store);
  const menus = useMemo(
    () => [...store.menus].sort((a, b) => Number(b.isSpecialty) - Number(a.isSpecialty)),
    [store.menus],
  );
  const updatedDate = new Date(store.updatedAt).toLocaleDateString(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const copy = language === "ja"
    ? {
        back: "地図に戻る",
        translated: "海外旅行者向け翻訳メニュー",
        about: "お店について",
        menu: "メニュー",
        show: "スタッフに見せる",
        hide: "閉じる",
        directions: "地図・連絡先",
        google: "Google Maps",
        naver: "Naver Map",
        call: "電話する",
        phrases: "注文に使える韓国語",
        phraseHelp: "ボタンを押して、韓国語の画面をスタッフに見せてください。",
        checked: `最終データ確認 ${updatedDate}。価格は店舗で変更される場合があります。`,
        noIntro: "翻訳済みメニューと価格を来店前に確認できます。",
      }
    : {
        back: "Back to map",
        translated: "Translated menu for international visitors",
        about: "About this place",
        menu: "Menu",
        show: "Show to staff",
        hide: "Hide Korean",
        directions: "Maps & contact",
        google: "Google Maps",
        naver: "Naver Map",
        call: "Call restaurant",
        phrases: "Useful Korean for ordering",
        phraseHelp: "Tap a phrase and show the Korean screen to the staff.",
        checked: `Data last checked ${updatedDate}. Prices may change at the restaurant.`,
        noIntro: "Check translated menu names and prices before you visit.",
      };

  return (
    <main className="detail-page">
      <header className="detail-topbar">
        <Link href="/">← {copy.back}</Link>
        <div className="public-language-toggle" aria-label="Language">
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
          <button className={language === "ja" ? "active" : ""} onClick={() => setLanguage("ja")}>日本語</button>
        </div>
      </header>

      <section className="detail-hero-grid">
        <RestaurantCover store={store} language={language} />
        <div className="detail-hero-copy">
          <div className="detail-kicker">{regionLabel(store.regionKey, language)} · {categoryLabel(category, language)}</div>
          <h1>{store.name}</h1>
          <p>{copy.translated}</p>
          <div className="detail-quick-stats">
            <div><strong>{store.menus.length}</strong><span>{language === "ja" ? "翻訳メニュー" : "translated menus"}</span></div>
            <div><strong>{store.menus.filter((menu) => menu.isSpecialty).length}</strong><span>{language === "ja" ? "おすすめ" : "featured"}</span></div>
          </div>
        </div>
      </section>

      <div className="detail-content-grid">
        <section className="detail-main-column">
          <div className="detail-section-heading">
            <span>{copy.about}</span>
            <h2>{store.introduction || copy.noIntro}</h2>
          </div>

          <div className="detail-section-heading menu-heading">
            <span>{copy.menu}</span>
            <h2>{language === "ja" ? "価格まで読めるメニュー" : "Translated names with prices"}</h2>
          </div>

          <div className="detail-menu-list">
            {menus.map((menu) => {
              const revealed = revealedMenuId === menu.id;
              return (
                <article className="detail-menu-card" key={menu.id}>
                  <div className="detail-menu-main">
                    <div>
                      {menu.isSpecialty && <span className="featured-chip">{language === "ja" ? "おすすめ" : "Featured"}</span>}
                      <h3>{localizedMenuName(menu, language)}</h3>
                    </div>
                    <strong>{priceLabel(menu.price, language)}</strong>
                  </div>
                  <button
                    className="show-staff-button"
                    onClick={() => setRevealedMenuId(revealed ? "" : menu.id)}
                  >
                    {revealed ? copy.hide : copy.show}
                  </button>
                  {revealed && (
                    <div className="staff-display-card">
                      <small>{language === "ja" ? "スタッフにこの画面を見せてください" : "Show this screen to the staff"}</small>
                      <strong>{menu.nameKo}</strong>
                      <span>이 메뉴 하나 주세요.</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <section className="order-phrase-section">
            <div className="detail-section-heading">
              <span>{copy.phrases}</span>
              <h2>{copy.phraseHelp}</h2>
            </div>
            <div className="phrase-buttons">
              {ORDER_PHRASES[language].map((phrase) => (
                <button className={revealedPhrase === phrase.ko ? "active" : ""} key={phrase.ko} onClick={() => setRevealedPhrase(phrase.ko)}>
                  {phrase.label}
                </button>
              ))}
            </div>
            {revealedPhrase && (
              <div className="phrase-display">
                <small>{language === "ja" ? "この韓国語を見せてください" : "Show this Korean phrase"}</small>
                <strong>{revealedPhrase}</strong>
              </div>
            )}
          </section>
        </section>

        <aside className="detail-side-column">
          <section className="detail-info-card">
            <span>{copy.directions}</span>
            <h2>{store.roadAddress || store.address}</h2>
            <div className="detail-action-grid">
              <a href={googleMapUrl(store)} target="_blank" rel="noreferrer">{copy.google}</a>
              <a href={naverMapUrl(store)} target="_blank" rel="noreferrer">{copy.naver}</a>
              {store.phone && <a className="full" href={`tel:${store.phone}`}>{copy.call} · {store.phone}</a>}
            </div>
          </section>

          <section className="detail-mini-map">
            <DiscoveryMap stores={[store]} selectedId={store.id} language={language} onSelect={() => undefined} />
          </section>

          <div className="detail-data-note">✓ {copy.checked}</div>
        </aside>
      </div>
    </main>
  );
}
