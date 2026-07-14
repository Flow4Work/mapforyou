"use client";

import { FormEvent, useEffect, useState } from "react";

type TokenStatus = {
  configured?: boolean;
  updatedAt?: string | null;
  error?: string;
};

export default function RedTableTokenSwitcher() {
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch("/api/redtable/token", { cache: "no-store" });
      const data = (await response.json()) as TokenStatus;
      setConfigured(Boolean(data.configured));
      setUpdatedAt(data.updatedAt ?? null);
    } catch {
      setConfigured(false);
    }
  }

  async function saveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setMessage("새 API KEY를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/redtable/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      const data = (await response.json()) as { saved?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "API KEY 저장 실패");

      setMessage("새 API KEY로 교체했습니다. 화면을 다시 불러옵니다.");
      setToken("");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API KEY 저장 실패");
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 1180, margin: "24px auto 0", padding: "0 20px" }}>
      <section className="card" style={{ padding: 20 }}>
        <div className="section-heading" style={{ marginBottom: 14 }}>
          <div>
            <span>API KEY</span>
            <h2 style={{ marginBottom: 4 }}>서울관광재단 키 교체</h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              실행을 중지한 뒤 새 키를 넣어주세요. 저장 즉시 다음 수집부터 새 키를 사용합니다.
            </p>
          </div>
          <strong>{configured ? "기본 키 저장됨" : "키 없음"}</strong>
        </div>

        <form onSubmit={saveToken} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="새 API KEY 붙여넣기"
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
          />
          <button className="secondary-button" type="submit" disabled={saving || !token.trim()}>
            {saving ? "교체 중…" : "이 키 사용"}
          </button>
        </form>

        <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
          {updatedAt ? `마지막 교체: ${new Date(updatedAt).toLocaleString("ko-KR")}` : "저장된 키 상태를 확인 중입니다."}
        </div>
        {message && <div className="notice" style={{ marginTop: 12 }}>{message}</div>}
      </section>
    </div>
  );
}
