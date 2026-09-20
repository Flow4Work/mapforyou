type DetailActionKind = "google" | "naver" | "instagram" | "call";

export default function DetailActionIcon({ kind }: { kind: DetailActionKind }) {
  if (kind === "google") {
    return (
      <span className="secondary-action-icon google" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path fill="#4285F4" d="M12 2a7 7 0 0 0-7 7c0 4.9 7 13 7 13s7-8.1 7-13a7 7 0 0 0-7-7Z" />
          <path fill="#34A853" d="M6.1 5.3A7 7 0 0 0 5 9c0 4.9 7 13 7 13v-8.5L6.1 5.3Z" />
          <path fill="#FBBC04" d="M12 13.5V22s7-8.1 7-13c0-1.2-.3-2.3-.8-3.3L12 13.5Z" />
          <path fill="#EA4335" d="M6.1 5.3 12 13.5l6.2-7.8A7 7 0 0 0 6.1 5.3Z" />
          <circle cx="12" cy="9" r="2.5" fill="#fff" />
        </svg>
      </span>
    );
  }

  if (kind === "naver") {
    return (
      <span className="secondary-action-icon naver" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="2" y="2" width="20" height="20" rx="4" fill="#03C75A" />
          <path fill="#fff" d="M7 6.5h4.1l5.9 8.1V6.5h3V17.5h-4.1L10 9.4v8.1H7z" />
        </svg>
      </span>
    );
  }

  if (kind === "instagram") {
    return (
      <span className="secondary-action-icon instagram" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <defs>
            <linearGradient id="ig-detail-gradient" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFD600" />
              <stop offset=".35" stopColor="#FF7A00" />
              <stop offset=".68" stopColor="#FF0169" />
              <stop offset="1" stopColor="#D300C5" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-detail-gradient)" />
          <rect x="6.3" y="6.3" width="11.4" height="11.4" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.8" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
        </svg>
      </span>
    );
  }

  return (
    <span className="secondary-action-icon call" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path fill="currentColor" d="M6.6 3.4 9 3a1.5 1.5 0 0 1 1.7 1l1.1 3.2a1.5 1.5 0 0 1-.5 1.7l-1.5 1.2a13 13 0 0 0 4.1 4.1l1.2-1.5a1.5 1.5 0 0 1 1.7-.5l3.2 1.1a1.5 1.5 0 0 1 1 1.7l-.4 2.4a2.5 2.5 0 0 1-2.5 2.1C10.6 19.5 4.5 13.4 4.5 5.9a2.5 2.5 0 0 1 2.1-2.5Z" />
      </svg>
    </span>
  );
}
