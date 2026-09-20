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
  images,
  selectedImage,
  onSelectImage,
  onImageError,
}: {
  store: DiscoveryRestaurant;
  language: PublicLanguage;
  images: string[];
  selectedImage: string;
  onSelectImage: (url: string) => void;
  onImageError: (url: string) => void;
}) {
  const instagramUrl = String(store.instagramUrl || "").trim();
  const hasInstagramPost = instagramContentUrl(instagramUrl);
  const hasInstagramProfile = Boolean(instagramUrl) && !hasInstagramPost;

  if (!hasInstagramPost && !hasInstagramProfile && images.length === 0) return null;

  const copy = language === "ja"
    ? { social: "Official Instagram", open: "Instagram", gallery: "\u5199\u771f" }
    : { social: "Official Instagram", open: "Instagram", gallery: "Photos" };

  return (
    <section className="restaurant-media">
      {images.length > 0 && (
        <div className="restaurant-gallery-block">
          <div className="restaurant-gallery-heading">
            <span>{copy.gallery}</span>
            <strong>{images.length}</strong>
          </div>
          <div className={`restaurant-gallery ${images.length === 1 ? "single" : ""}`}>
            {images.map((url, index) => (
              <button
                className={`restaurant-gallery-thumb ${selectedImage === url ? "active" : ""}`}
                type="button"
                key={`${url}-${index}`}
                aria-label={`${store.name} ${copy.gallery} ${index + 1}`}
                aria-pressed={selectedImage === url}
                onClick={() => onSelectImage(url)}
              >
                <img
                  src={url}
                  alt={`${store.name} ${copy.gallery} ${index + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => onImageError(url)}
                />
              </button>
            ))}
          </div>
        </div>
      )}

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
        <a className="instagram-profile-link" href={instagramUrl} target="_blank" rel="noreferrer">
          <span className="instagram-profile-link-icon">IG</span>
          <span><small>{copy.social}</small><strong>@{instagramHandle(store)}</strong></span>
          <b aria-hidden="true">↗</b>
        </a>
      )}
    </section>
  );
}
