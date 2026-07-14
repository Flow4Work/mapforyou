"use client";

import { useEffect, useState } from "react";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import { broadCategory, categoryIcon, categoryLabel, type PublicLanguage } from "@/lib/discovery-ui";

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

  useEffect(() => setFailed(false), [store.imageUrl]);

  return (
    <div
      className={`restaurant-cover cover-${category} ${compact ? "restaurant-cover-compact" : ""}`}
      style={{ position: "relative", overflow: "hidden" }}
    >
      {hasImage && (
        <img
          src={store.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {hasImage && (
        <span
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(17,25,20,.02), rgba(17,25,20,.58))" }}
        />
      )}
      {!hasImage && <span className="restaurant-cover-icon">{categoryIcon(category)}</span>}
      <div className="restaurant-cover-label" style={{ position: "relative", zIndex: 1 }}>
        <span>{categoryLabel(category, language)}</span>
        {!compact && <strong>{store.name}</strong>}
      </div>
    </div>
  );
}
