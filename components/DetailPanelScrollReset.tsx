"use client";

import { useEffect } from "react";

function resetVisibleDetailPanel() {
  const panel = document.querySelector<HTMLElement>(".restaurant-detail-panel:not(.mobile-panel-hidden)");
  const scroller = panel?.querySelector<HTMLElement>(".restaurant-detail-scroll");
  if (!scroller) return;
  scroller.scrollTop = 0;
  scroller.scrollTo({ top: 0, behavior: "auto" });
}

export default function DetailPanelScrollReset() {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(resetVisibleDetailPanel);
    });

    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    window.requestAnimationFrame(resetVisibleDetailPanel);
    return () => observer.disconnect();
  }, []);

  return null;
}
