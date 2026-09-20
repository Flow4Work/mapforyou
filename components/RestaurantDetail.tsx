"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import ImageViewer from "@/components/ImageViewer";
import DetailActionIcon from "@/components/DetailActionIcon";
import RestaurantCover from "@/components/RestaurantCover";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  bookingPlaceUrl,
  broadCategory,
  categoryLabel,
  googleMapUrl,
  localizedAddress,
  localizedIntroduction,
  localizedMenuName,
  localizedRestaurantName,
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
  const [menuViewMode, setMenuViewMode] = useState<"photo" | "compact">("photo");
  const [menuImageViewer, setMenuImageViewer] = useState<{ src: string; alt: string } | null>(null);
  const category = broadCategory(store);
  const menus = useMemo(
    () => [...store.menus].sort((a, b) => Number(b.isSpecialty) - Number(a.isSpecialty)),
    [store.menus],
  );
  const updatedDate = new Date(store.updatedAt).toLocaleDateString(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
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
        call: "電話",
        booking: "予約する",
        photoView: "写真",
        compactView: "一覧",
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
        call: "Call",
        booking: "Book a table",
        photoView: "Photos",
        compactView: "List",
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
          <h1>{localizedRestaurantName(store, language)}</h1>
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
            <h2>{localizedIntroduction(store, language) || copy.noIntro}</h2>
          </div>

          <div className="detail-section-heading menu-heading">
            <span>{copy.menu}</span>
            <h2>{language === "ja" ? "価格まで読めるメニュー" : "Translated names with prices"}</h2>
          </div>

          <div className="standalone-menu-controls">
            <div className="menu-view-toggle" role="group" aria-label={copy.menu}>
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
          </div>

          <div className={`detail-menu-list ${menuViewMode === "compact" ? "compact" : ""}`}>
            {menus.map((menu) => {
              const revealed = revealedMenuId === menu.id;
              const localizedName = localizedMenuName(menu, language);
              const description = language === "ja"
                ? menu.descriptionJa || menu.descriptionKo
                : menu.descriptionEn || menu.descriptionKo;
              const hasVerifiedImage = menu.imageStatus === "verified" && /^https?:\/\//i.test(menu.imageUrl);
              if (menuViewMode === "compact") {
                return (
                  <article className="detail-menu-card compact" key={menu.id}>
                    <div className="detail-menu-main">
                      <div>
                        {menu.isSpecialty && (
                          <span className="featured-chip">{language === "ja" ? "おすすめ" : "Featured"}</span>
                        )}
                        <h3>{localizedName}</h3>
                      </div>
                      <strong>{priceLabel(menu.price, language)}</strong>
                    </div>
                  </article>
                );
              }
              return (
                <article className={`detail-menu-card${hasVerifiedImage ? " has-image" : ""}`} key={menu.id}>
                  {hasVerifiedImage && (
                    <button
                      className="detail-menu-image-link"
                      type="button"
                      aria-label={`${localizedName} image`}
                      onClick={() => setMenuImageViewer({ src: menu.imageUrl, alt: localizedName })}
                    >
                      <img className="detail-menu-image" src={menu.imageUrl} alt={localizedName} loading="lazy" />
                    </button>
                  )}
                  <div className="detail-menu-body">
                    <div className="detail-menu-main">
                      <div>
                        {menu.isSpecialty && <span className="featured-chip">{language === "ja" ? "おすすめ" : "Featured"}</span>}
                        <h3>{localizedName}</h3>
                        {description && <p className="detail-menu-description">{description}</p>}
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
                  </div>
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
            <h2>{localizedAddress(store, language)}</h2>
            <div className="detail-panel-actions standalone-detail-actions">
              <a
                className="booking-place-cta"
                href={bookingPlaceUrl(store, language)}
                target="_blank"
                rel="noreferrer"
              >
                <span className="booking-place-spacer" aria-hidden="true" />
                <span className="booking-place-label">{copy.booking}</span>
                <span className="booking-place-arrow" aria-hidden="true">↗</span>
              </a>
              <div className="detail-secondary-actions">
                <a href={googleMapUrl(store)} target="_blank" rel="noreferrer" aria-label={copy.google} title={copy.google}>
                  <DetailActionIcon kind="google" />
                  <span>Google</span>
                </a>
                <a href={naverMapUrl(store)} target="_blank" rel="noreferrer" aria-label={copy.naver} title={copy.naver}>
                  <DetailActionIcon kind="naver" />
                  <span>NAVER</span>
                </a>
                {store.instagramUrl && (
                  <a href={store.instagramUrl} target="_blank" rel="noreferrer" aria-label="Instagram" title="Instagram">
                    <DetailActionIcon kind="instagram" />
                    <span>Instagram</span>
                  </a>
                )}
                {store.phone && (
                  <a href={`tel:${store.phone}`} aria-label={copy.call} title={copy.call}>
                    <DetailActionIcon kind="call" />
                    <span>{copy.call}</span>
                  </a>
                )}
              </div>
            </div>
          </section>

          <section className="detail-mini-map">
            <DiscoveryMap stores={[store]} selectedId={store.id} language={language} onSelect={() => undefined} />
          </section>

          <div className="detail-data-note">✓ {copy.checked}</div>
        </aside>
      </div>
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
