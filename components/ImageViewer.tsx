"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!src || typeof document === "undefined" || !document.body) return null;

  return createPortal(
    <div
      className="image-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button className="image-viewer-close" type="button" onClick={onClose} aria-label="Close image">
        ×
      </button>
      <img className="image-viewer-image" src={src} alt={alt} />
    </div>,
    document.body,
  );
}
