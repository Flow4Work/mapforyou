"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Candidate = {
  provider: "foursquare";
  fsqId: string;
  placeName: string;
  address: string;
  distance: number | null;
  score: number;
  reasons: string[];
  instagramUrl: string | null;
  instagramUsername: string | null;
  website: string | null;
  phone: string | null;
  verifiedPlace: boolean;
};

type InstagramRow = {
  sourceId: string;
  name: string;
  address: string;
  category: string;
  regionKey: string;
  instagramUrl: string | null;
  instagramUsername: string | null;
  instagramStatus: string;
  instagramSource: string | null;
  confidence: number | null;
  candidates: Candidate[];
  searchQuery: string | null;
  checkedAt: string | null;
};

type StatusResponse = {
  total?: number;
  unchecked?: number;
  candidate?: number;
  verified?: number;
  notFound?: number;
  rejected?: number;
  rows?: InstagramRow[];
  processed?: number;
  matched?: number;
  found?: number;
  autoVerified?: number;
  message?: string;
  error?: string;
};

type CredentialStatus = {
  configured?: boolean;
  source?: "environment" | "admin";
  updatedAt?: string | null;
  error?: string;
};

const REGION_OPTIONS = [
  { value: "all", label: "성수 + 홍대" },
  { value: "seongsu", label: "성수" },
  { value: "hongdae", label: "홍대" },
];

function regionLabel(regionKey: string) {
  if (regionKey === "seongsu") return "성수";
  if (regionKey === "hongdae") return "홍대";
  return regionKey || "지역 미확인";
}

function statusLabel(status: string, source: string | null) {
  if (status === "verified") return source === "foursquare_auto" ? "자동 확정" : "확정";
  if (status === "candidate") return "검토 필요";
  if (status === "not_found") return source === "foursquare_no_instagram" ? "인스타 없음" : "매칭 실패";
  if (status === "rejected") return "후보 제외";
  return "미확인";
}

function statusClass(status: string) {
  if (status === "verified") return "status-found";
  if (status === "candidate") return "status-partial";
  if (status === "not_found" || status === "rejected") return "status-missing";
  return "";
}

function distanceLabel(distance: number | null) {
  if (distance === null) return "거리 정보 없음";
  return `${Math.round(distance).toLocaleString("ko-KR")}m`;
}

export default function FoursquareInstagramFinder() {
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<StatusResponse>({});
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>({});
  const [apiKey, setApiKey] = useState("");
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([loadStatus(region), loadCredentialStatus()]);
  }, [region]);

  async function loadStatus(nextRegion = region) {
    setLoading(true);
    try {
      const response = await fetch(`/api/public-data/instagram?region=${encodeURIComponent(nextRegion)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "인스타그램 현황 조회 실패");
      setStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인스타그램 현황 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  async function loadCredentialStatus() {
    try {
      const response = await fetch("/api/foursquare/credentials", { cache: "no-store" });
      const data = (await response.json()) as CredentialStatus;
      setCredentialStatus(data);
    } catch {
      setCredentialStatus({ configured: false });
    }
  }

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) {
      setMessage("Foursquare Places API Key를 입력해주세요.");
      return;
    }
    setSavingCredentials(true);
    setMessage("");
    try {
      const response = await fetch("/api/foursquare/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = (await response.json()) as CredentialStatus & { saved?: boolean };
      if (!response.ok) throw new Error(data.error || "Foursquare API Key 저장 실패");
      setApiKey("");
      setCredentialStatus({ configured: true, source: "admin", updatedAt: data.updatedAt ?? null });
      setMessage("Foursquare Places API 연결을 확인하고 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Foursquare API Key 저장 실패");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function scanBatch(retry = false) {
    setRunning(true);
    setMessage(retry ? "결과가 없었던 가게 20곳을 다시 확인 중입니다." : "다음 가게 20곳을 자동 매칭 중입니다.");
    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", region, limit: 20, retry }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "Foursquare 인스타그램 검색 실패");
      setStatus(data);
      setMessage(data.message || "20곳 검색을 완료했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Foursquare 인스타그램 검색 실패");
    } finally {
      setRunning(false);
    }
  }

  async function saveStoreAction(
    row: InstagramRow,
    action: "verify" | "manual" | "not_found" | "reject",
    url?: string,
  ) {
    setSavingId(row.sourceId);
    setMessage("");
    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceId: row.sourceId, url, region }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "저장 실패");
      setStatus(data);
      setMessage(
        `${row.name}: ${action === "verify" || action === "manual" ? "공식 계정으로 확정했습니다." : "상태를 변경했습니다."}`,
      );
      if (action === "manual") {
        setManualDrafts((current) => {
          const next = { ...current };
          delete next[row.sourceId];
          return next;
        });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSavingId("");
    }
  }

  const rows = status.rows ?? [];
  const recentRows = useMemo(
    () => [...rows].sort((a, b) => String(b.checkedAt ?? "").localeCompare(String(a.checkedAt ?? ""))),
    [rows],
  );

  return (
    <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          marginBottom: 22,
        }}
      >
        <div>
          <p className="eyebrow">FOURSQUARE PLACES</p>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>
            가게 인스타그램 자동 수집
          </h1>
          <p style={{ maxWidth: 780, margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
            상호명과 실제 좌표를 함께 비교해 20곳씩 매칭합니다. 일치도가 높은 장소의 인스타그램은 자동 확정하고,
            애매한 결과만 검토 목록에 남깁니다.
          </p>
        </div>
        <button className="ghost-button" disabled={loading || running} onClick={() => void loadStatus()}>
          현황 새로고침
        </button>
      </header>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 16 }}>
          <div>
            <span>PLACES API KEY</span>
            <h2>Foursquare 연결</h2>
          </div>
          <strong>{credentialStatus.configured ? "연결됨" : "키 필요"}</strong>
        </div>
        <div className="notice" style={{ marginTop: 0, marginBottom: 14 }}>
          네이버 웹검색은 사용하지 않습니다. Foursquare Developer Console에서 Places API Key 하나만 발급해 넣으면 됩니다.
        </div>
        <form onSubmit={saveCredentials} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Foursquare Places API Key"
            autoComplete="off"
            spellCheck={false}
            disabled={savingCredentials}
            style={{ minWidth: 0, padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11 }}
          />
          <button className="secondary-button" type="submit" disabled={savingCredentials || !apiKey.trim()}>
            {savingCredentials ? "연결 확인 중…" : "확인 후 저장"}
          </button>
        </form>
        <div style={{ marginTop: 9, color: "var(--muted)", fontSize: 12 }}>
          {credentialStatus.configured
            ? credentialStatus.source === "environment"
              ? "Vercel 환경변수에 저장된 키를 사용 중입니다."
              : `관리자에서 저장한 키 사용 중${credentialStatus.updatedAt ? ` · ${new Date(credentialStatus.updatedAt).toLocaleString("ko-KR")}` : ""}`
            : "Foursquare Places API Key가 아직 없습니다."}
        </div>
      </section>

      <section
        aria-label="인스타그램 수집 현황"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {[
          ["전체 가게", status.total ?? 0],
          ["미확인", status.unchecked ?? 0],
          ["검토 필요", status.candidate ?? 0],
          ["확정", status.verified ?? 0],
          ["없음·매칭 실패", status.notFound ?? 0],
        ].map(([label, value]) => (
          <article key={String(label)} className="card" style={{ marginBottom: 0, padding: 18 }}>
            <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 800 }}>{label}</span>
            <strong style={{ display: "block", marginTop: 9, fontSize: 28 }}>{Number(value).toLocaleString("ko-KR")}</strong>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 14 }}>
          <div>
            <span>AUTO MATCH</span>
            <h2>20곳씩 시험 수집</h2>
          </div>
          <p>상호명 + 좌표 + 주소 + 전화번호 일치도 계산</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            disabled={running}
            style={{ padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11, background: "white" }}
          >
            {REGION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            className="primary-button"
            disabled={running || !credentialStatus.configured || !status.unchecked}
            onClick={() => void scanBatch(false)}
          >
            {running ? "Foursquare에서 매칭 중…" : "다음 20곳 자동 수집"}
          </button>
          <button
            className="ghost-button"
            disabled={running || !credentialStatus.configured || !status.notFound}
            onClick={() => void scanBatch(true)}
          >
            결과 없음 20곳 재확인
          </button>
        </div>
        <p className="fine-print" style={{ fontSize: 12 }}>
          검색 결과를 단순히 상호명으로 고르지 않습니다. 저장된 좌표와 거리까지 계산하며, 88점 이상인 장소만 자동 확정합니다.
        </p>
        {message && <div className="notice">{message}</div>}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span>RESULTS</span>
            <h2>최근 처리 결과</h2>
          </div>
          <p>자동 확정 결과와 애매한 후보만 확인</p>
        </div>
        {loading ? (
          <div className="empty-state compact">수집 현황을 불러오는 중입니다.</div>
        ) : recentRows.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {recentRows.map((row) => {
              const best = row.candidates[0] ?? null;
              const manualValue = manualDrafts[row.sourceId] ?? "";
              const saving = savingId === row.sourceId;
              return (
                <article
                  key={row.sourceId}
                  style={{ padding: 18, border: "1px solid var(--line)", borderRadius: 16, background: "#fbfcf8" }}
                >
                  <div className="result-grid">
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <strong style={{ fontSize: 16 }}>{row.name}</strong>
                        <span className={`status-pill ${statusClass(row.instagramStatus)}`}>
                          {statusLabel(row.instagramStatus, row.instagramSource)}
                        </span>
                        <span className="status-pill">{regionLabel(row.regionKey)}</span>
                      </div>
                      <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
                        {row.address || "주소 없음"}{row.category ? ` · ${row.category}` : ""}
                      </p>
                      {row.checkedAt && (
                        <small style={{ display: "block", marginTop: 7, color: "var(--muted)" }}>
                          처리: {new Date(row.checkedAt).toLocaleString("ko-KR")}
                        </small>
                      )}
                    </div>
                    <div>
                      {row.instagramStatus === "verified" && row.instagramUrl ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9 }}>
                            <a className="text-link" href={row.instagramUrl} target="_blank" rel="noreferrer">
                              @{row.instagramUsername || row.instagramUrl} ↗
                            </a>
                            <span className="status-pill status-found">
                              {row.instagramSource === "foursquare_auto" ? "높은 일치도로 자동 저장" : "공식 URL 저장됨"}
                            </span>
                          </div>
                          {best && (
                            <small style={{ color: "var(--muted)" }}>
                              Foursquare: {best.placeName} · {distanceLabel(best.distance)} · 일치도 {best.score}
                            </small>
                          )}
                        </div>
                      ) : best ? (
                        <>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9 }}>
                            <strong>{best.placeName || "Foursquare 장소명 없음"}</strong>
                            <span className={`status-pill ${best.score >= 88 ? "status-found" : "status-partial"}`}>
                              일치도 {best.score}
                            </span>
                            <span className="status-pill">{distanceLabel(best.distance)}</span>
                          </div>
                          <p style={{ margin: "7px 0 0", color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}>
                            {best.address || "Foursquare 주소 없음"}
                          </p>
                          {best.reasons.length > 0 && (
                            <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 11 }}>
                              {best.reasons.join(" · ")}
                            </p>
                          )}
                          {best.instagramUrl ? (
                            <a
                              className="text-link"
                              href={best.instagramUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ display: "inline-block", marginTop: 9 }}
                            >
                              @{best.instagramUsername} ↗
                            </a>
                          ) : (
                            <p style={{ margin: "9px 0 0", color: "var(--muted)", fontSize: 12 }}>
                              장소는 매칭됐지만 Foursquare에 인스타그램 정보가 없습니다.
                            </p>
                          )}
                          {best.website && (
                            <a
                              className="status-pill"
                              href={best.website}
                              target="_blank"
                              rel="noreferrer"
                              style={{ display: "inline-flex", marginTop: 9 }}
                            >
                              공식 웹사이트 ↗
                            </a>
                          )}
                        </>
                      ) : (
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                          800m 안에서 신뢰할 수 있는 Foursquare 장소를 찾지 못했습니다.
                        </p>
                      )}
                    </div>
                  </div>
                  {row.instagramStatus !== "verified" && (
                    <>
                      <div className="action-row" style={{ marginTop: 14 }}>
                        {best?.instagramUrl && (
                          <button
                            className="secondary-button"
                            disabled={saving}
                            onClick={() => void saveStoreAction(row, "verify", best.instagramUrl!)}
                          >
                            이 계정 확정
                          </button>
                        )}
                        {best?.instagramUrl && (
                          <button className="ghost-button" disabled={saving} onClick={() => void saveStoreAction(row, "reject")}>
                            후보 아님
                          </button>
                        )}
                        <button className="text-button" disabled={saving} onClick={() => void saveStoreAction(row, "not_found")}>
                          계정 없음 처리
                        </button>
                      </div>
                      <div className="manual-grid">
                        <input
                          value={manualValue}
                          onChange={(event) =>
                            setManualDrafts((current) => ({ ...current, [row.sourceId]: event.target.value }))
                          }
                          placeholder="추가로 확인한 https://www.instagram.com/사용자명/"
                          disabled={saving}
                          style={{ minWidth: 0, padding: "11px 12px", border: "1px solid #dde0d8", borderRadius: 11 }}
                        />
                        <button
                          className="ghost-button"
                          disabled={saving || !manualValue.trim()}
                          onClick={() => void saveStoreAction(row, "manual", manualValue)}
                        >
                          직접 URL 확정
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <strong>아직 처리한 가게가 없습니다.</strong>
            <span>Foursquare 키를 연결하고 ‘다음 20곳 자동 수집’을 실행해주세요.</span>
          </div>
        )}
      </section>

      <style jsx>{`
        .result-grid {
          display: grid;
          grid-template-columns: minmax(180px, .8fr) minmax(260px, 1.2fr);
          gap: 18px;
        }
        .manual-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 9px;
          margin-top: 13px;
        }
        @media (max-width: 760px) {
          form,
          .result-grid,
          .manual-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
