"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ImageViewer from "@/components/ImageViewer";
import RestaurantMedia from "@/components/RestaurantMedia";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import {
  broadCategory,
  categoryIcon,
  categoryLabel,
  localizedRestaurantName,
  type PublicLanguage,
} from "@/lib/discovery-ui";
import { restaurantPhotoCandidates } from "@/lib/restaurant-images";

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
  const stackRef = useRef<HTMLDivElement>(null);
  const photoCandidates = useMemo(() => restaurantPhotoCandidates(store), [store]);
  const preferredImage = photoCandidates[0] ?? "";
  const [selectedImage, setSelectedImage] = useState(preferredImage);
  const [viewerImage, setViewerImage] = useState("");
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectedImage(preferredImage);
    setViewerImage("");
    setFailedImages(new Set());
  }, [store.id, preferredImage]);

  useEffect(() => {
    if (compact) return;
    const scroller = stackRef.current?.closest(".restaurant-detail-scroll");
    if (scroller instanceof HTMLElement) scroller.scrollTo({ top: 0, behavior: "auto" });
  }, [store.id, compact]);

  const fallbackImage = photoCandidates.find((url) => !failedImages.has(url)) ?? "";
  const activeImage = selectedImage && !failedImages.has(selectedImage) ? selectedImage : fallbackImage;
  const hasImage = Boolean(activeImage);
  const isOriginalImage = activeImage === store.imageUrl;
  const isTourApiImage = isOriginalImage && store.imageSource.startsWith("tourapi_");
  const isEditableTourApiImage = store.imageSource.includes("type1");
  const preserveOriginal = isTourApiImage && !isEditableTourApiImage;

  function selectImage(url: string) {
    if (!photoCandidates.includes(url) || failedImages.has(url)) return;
    setSelectedImage(url);
  }

  function markImageFailed(url: string) {
    setFailedImages((current) => {
      const next = new Set(current);
      next.add(url);
      const replacement = photoCandidates.find((candidate) => !next.has(candidate));
      if (selectedImage === url) setSelectedImage(replacement ?? "");
      if (viewerImage === url) setViewerImage("");
      return next;
    });
  }

  const cover = (
    <div
      className={`restaurant-cover cover-${category} ${compact ? "restaurant-cover-compact" : "restaurant-cover-expandable"}`}
      style={{ position: "relative", overflow: "hidden", background: preserveOriginal ? "#f1eee7" : undefined }}
      role={!compact && hasImage ? "button" : undefined}
      tabIndex={!compact && hasImage ? 0 : undefined}
      aria-label={!compact && hasImage ? `${localizedRestaurantName(store, language)} image` : undefined}
      onClick={!compact && hasImage ? () => setViewerImage(activeImage) : undefined}
      onKeyDown={!compact && hasImage ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setViewerImage(activeImage);
        }
      } : undefined}
    >
      {hasImage && (
        <img
          src={activeImage}
          alt={localizedRestaurantName(store, language)}
          loading={compact ? "lazy" : "eager"}
          onError={() => markImageFailed(activeImage)}
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

  if (compact) return cover;

  return (
    <div className="restaurant-cover-stack" ref={stackRef}>
      {cover}
      <RestaurantMedia
        store={store}
        language={language}
        images={photoCandidates.filter((url) => !failedImages.has(url))}
        selectedImage={activeImage}
        onSelectImage={selectImage}
        onImageError={markImageFailed}
      />
      {viewerImage && (
        <ImageViewer
          src={viewerImage}
          alt={localizedRestaurantName(store, language)}
          onClose={() => setViewerImage("")}
        />
      )}
    </div>
  );
}
