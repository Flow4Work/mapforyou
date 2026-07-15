"use client";

import type { DiscoveryRestaurant } from "@/lib/discovery";
import type { PublicLanguage } from "@/lib/discovery-ui";

function instagramContentUrl(value: string) {
  return /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/i.test(value);
}

function instagramEmbedUrl(value: string) {
  const clean = value.split("?")[0].replace(/\/+$/, "");
  return `${clean}/embed/captioned/`;
}

function instagramHandle(store: DiscoveryRestaurant) {
  if (store.instagramUsername) return store.instagramUsername.replace(/^@/, "");
  const match = store.instagramUrl.match(/instagram\.com\/([^/?#]+)/i);
  return match?.[1] ?? "Instagram";
}

export default function RestaurantMedia({
  store,
  language,
  compact = false,
}: {
  store: DiscoveryRestaurant;
  language: PublicLanguage;
  compact?: boolean;
}) {
  const instagramUrl = String(store.instagramUrl || "").trim();
  const additionalImages = (store.imageGalleryUrls || [])
    .filter((url) => url && url !== store.imageUrl)
    .slice(0, compact ? 3 : 5);
  const hasInstagramPost = instagramContentUrl(instagramUrl);
  const hasInstagramProfile = Boolean(instagramUrl) && !hasInstagramPost;

  if (!hasInstagramPost && !hasInstagramProfile && additionalImages.length === 0) return null;

  const copy = language === "ja"
    ? {
        social: "公式Instagram",
        socialBody: "最新の写真や営業情報はInstagramで確認できます。",
        open: "Instagramを開く",
        gallery: "写真",
      }
    : {
        social: "Official Instagram",
        socialBody: "See recent photos and updates on Instagram.",
        open: "Open Instagram",
        gallery: "More photos",
      };

  return (
    <section className={`restaurant-media ${compact ? "restaurant-media-compact" : ""}`}>
      {hasInstagramPost && (
        <div className="instagram-embed-shell">
          <iframe
            src={instagramEmbedUrl(instagramUrl)}
            title={`${store.name} Instagram`}
            loading="lazy"
            allow="encrypted-media"
            allowFullScreen
            scrolling="no"
          />
          <a href={instagramUrl} target="_blank" rel="noreferrer">{copy.open} ↗</a>
        </div>
      )}

      {hasInstagramProfile && (
        <a className="instagram-profile-card" href={instagramUrl} target="_blank" rel="noreferrer">
          <span className="instagram-profile-icon">◎</span>
          <span>
            <small>{copy.social}</small>
            <strong>@{instagramHandle(store)}</strong>
            <em>{copy.socialBody}</em>
          </span>
          <b>↗</b>
        </a>
      )}

      {!instagramUrl && additionalImages.length > 0 && (
        <div className="restaurant-gallery-block">
          <div className="restaurant-gallery-heading">
            <span>{copy.gallery}</span>
            <strong>{additionalImages.length + 1}</strong>
          </div>
          <div className={`restaurant-gallery ${additionalImages.length === 1 ? "single" : ""}`}>
            {additionalImages.map((url, index) => (
              <img key={`${url}-${index}`} src={url} alt={`${store.name} ${copy.gallery} ${index + 2}`} loading="lazy" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
