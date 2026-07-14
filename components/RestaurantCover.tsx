"use client";

import { useEffect, useState } from "react";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  broadCategory,
  categoryIcon,
  categoryLabel,
  localizedRestaurantName,
  type PublicLanguage,
} from "@/lib/discovery-ui";

export default function RestaurantCover({
  store,
  language,
  compact = false,
}: {
  store: DiscoveryRestaurant;
  language: PublicLanguage;
  compact?: boolean;
}) {
  const category = broadCategory(store);
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(store.imageUrl) && !failed;
  const isTourApiImage = store.imageSource.startsWith("tourapi_");
  const isEditableTourApiImage = store.imageSource.includes("type1");
  const preserveOriginal = isTourApiImage && !isEditableTourApiImage;

  useEffect(() => setFailed(false), [store.imageUrl]);

  return (
    <div
      className={`restaurant-cover cover-${category} ${compact ? "restaurant-cover-compact" : ""}`}
      style={{ position: "relative", overflow: "hidden", background: preserveOriginal ? "#f1eee7" : undefined }}
    >
      {hasImage && (
        <img
          src={store.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: preserveOriginal ? "0 0 42px" : 0,
            width: "100%",
            height: preserveOriginal ? "calc(100% - 42px)" : "100%",
            objectFit: preserveOriginal ? "contain" : "cover",
            background: preserveOriginal ? "#f1eee7" : undefined,
          }}
        />
      )}
      {hasImage && !preserveOriginal && (
        <span
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(43,20,13,.02), rgba(43,20,13,.62))" }}
        />
      )}
      {!hasImage && <span className="restaurant-cover-icon">{categoryIcon(category)}</span>}
      <div
        className="restaurant-cover-label"
        style={preserveOriginal
          ? {
              position: "absolute",
              zIndex: 1,
              left: 0,
              right: 0,
              bottom: 0,
              minHeight: 42,
              padding: "7px 10px",
              color: "#4b453d",
              background: "#fff",
              borderTop: "1px solid rgba(80,70,58,.12)",
            }
          : { position: "relative", zIndex: 1 }}
      >
        <span>{categoryLabel(category, language)}</span>
        {!compact && <strong>{localizedRestaurantName(store, language)}</strong>}
        {preserveOriginal && store.imageAttribution && (
          <small style={{ display: "block", marginTop: 2, fontSize: 8, opacity: .72 }}>
            {store.imageAttribution}
          </small>
        )}
      </div>
    </div>
  );
}
