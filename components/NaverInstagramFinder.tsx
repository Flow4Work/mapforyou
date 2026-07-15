"use client";

import { useEffect, useMemo, useState } from "react";

type Candidate = {
  provider: "naver_place";
  placeId: string | null;
  placeUrl: string | null;
  searchUrl: string;
  officialWebsite: string | null;
  instagramUrl: string | null;
  instagramUsername: string | null;
  discoverySource: "naver_place" | "official_website" | "none";
  confidence: number;
  reasons: string[];
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
  naverPlaceId: string | null;
  naverPlaceUrl: string | null;
  officialWebsiteUrl: string | null;
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
  placeResolved?: number;
  found?: number;
  stopped?: boolean;
  message?: string;
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
  if (status === "verified") {
    if (source === "naver_place_direct") return "네이버에서 자동 확인";
    if (source === "naver_official_website") return "공식 홈페이지에서 확인";
    return "확정";
  }
  if (status === "candidate") return "장소 확인 필요";
  if (status === "not_found") {
    if (source === "naver_place_no_instagram") return "인스타 없음";
    return "장소 매칭 실패";
  }
  if (status === "rejected") return "후보 제외";
  return "미확인";
}

function statusClass(status: string) {
  if (status === "verified") return "status-found";
  if (status === "candidate") return "status-partial";
  if (status === "not_found" || status === "rejected") return "status-missing";
  return "";
}

export default function NaverPlaceInstagramFinder() {
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<StatusResponse>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadStatus(region);
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

  async function scanBatch(retry = false) {
    setRunning(true);
    setMessage(
      retry
        ? "이전에 찾지 못한 가게를 네이버 장소에서 다시 확인 중입니다."
        : "네이버 장소 링크를 저속으로 열어 홈페이지와 인스타그램을 확인 중입니다.",
    );
    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", region, limit: 10, retry }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "네이버 장소 확인 실패");
      setStatus(data);
      setMessage(data.message || "네이버 장소 확인을 완료했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "네이버 장소 확인 실패");
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
        `${row.name}: ${action === "verify" || action === "manual" ? "인스타그램 계정을 확정했습니다." : "상태를 변경했습니다."}`,
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
          <p className="eyebrow">NAVER PLACE LINK CHECK</p>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>
            네이버 장소에서 인스타 자동 확인
          </h1>
          <p style={{ maxWidth: 800, margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
            현재 앱의 ‘네이버 지도에서 보기’ 검색 링크를 실제 브라우저로 엽니다. 주소가 맞는 장소를 찾은 뒤,
            장소 상세에 등록된 인스타그램 또는 공식 홈페이지의 인스타그램 링크만 저장합니다.
          </p>
        </div>
        <button className="ghost-button" disabled={loading || running} onClick={() => void loadStatus()}>
          현황 새로고침
        </button>
      </header>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 12 }}>
          <div>
            <span>NO API KEY</span>
            <h2>별도 API 연결 없이 시험</h2>
          </div>
          <strong>서버 브라우저 사용</strong>
        </div>
        <div className="notice" style={{ marginTop: 0 }}>
          로그인, 캡차 우회, 프록시는 사용하지 않습니다. 네이버의 접근 제한 문구가 감지되면 해당 실행은 즉시
          중단하며, 처리하지 못한 가게는 미확인 상태로 남깁니다.
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
          ["장소 확인 필요", status.candidate ?? 0],
          ["인스타 확정", status.verified ?? 0],
          ["없음·매칭 실패", status.notFound ?? 0],
        ].map(([label, value]) => (
          <article key={String(label)} className="card" style={{ marginBottom: 0, padding: 18 }}>
            <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 800 }}>{label}</span>
            <strong style={{ display: "block", marginTop: 9, fontSize: 28 }}>
              {Number(value).toLocaleString("ko-KR")}
            </strong>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 14 }}>
          <div>
            <span>LOW-SPEED TEST</span>
            <h2>다음 10곳 자동 확인</h2>
          </div>
          <p>한 브라우저에서 순차 처리</p>
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
            disabled={running || !status.unchecked}
            onClick={() => void scanBatch(false)}
          >
            {running ? "네이버 장소 확인 중…" : "다음 10곳 자동 확인"}
          </button>
          <button
            className="ghost-button"
            disabled={running || !status.notFound}
            onClick={() => void scanBatch(true)}
          >
            없음·실패 10곳 재확인
          </button>
        </div>
        <p className="fine-print" style={{ fontSize: 12 }}>
          네이버 검색 결과의 상호명과 주소를 비교한 뒤 장소 상세를 엽니다. 네이버 장소에 직접 등록된 링크는
          자동 확정하고, 공식 홈페이지에서 발견한 링크도 출처를 구분해 저장합니다.
        </p>
        {message && (
          <div
            className="notice"
            style={status.stopped ? { color: "#8b4a42", background: "#f5dfdc" } : undefined}
          >
            {message}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span>RESULTS</span>
            <h2>최근 처리 결과</h2>
          </div>
          <p>찾은 링크와 근거 확인</p>
        </div>
        {loading ? (
          <div className="empty-state compact">수집 현황을 불러오는 중입니다.</div>
        ) : recentRows.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {recentRows.map((row) => {
              const best = row.candidates[0] ?? null;
              const manualValue = manualDrafts[row.sourceId] ?? "";
              const saving = savingId === row.sourceId;
              const placeUrl = row.naverPlaceUrl || best?.placeUrl || best?.searchUrl || row.searchQuery;
              const website = row.officialWebsiteUrl || best?.officialWebsite;

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
                        <div style={{ display: "grid", gap: 9 }}>
                          <a className="text-link" href={row.instagramUrl} target="_blank" rel="noreferrer">
                            @{row.instagramUsername || row.instagramUrl} ↗
                          </a>
                          <span style={{ color: "var(--muted)", fontSize: 11 }}>
                            {row.instagramSource === "naver_place_direct"
                              ? "네이버 장소 상세에 직접 등록된 링크"
                              : row.instagramSource === "naver_official_website"
                                ? "네이버 장소에 등록된 공식 홈페이지에서 발견"
                                : "관리자 확인"}
                          </span>
                        </div>
                      ) : best ? (
                        <div style={{ display: "grid", gap: 7 }}>
                          <strong>{best.placeId ? `네이버 장소 ID ${best.placeId}` : "장소를 자동 확정하지 못함"}</strong>
                          {best.reasons.map((reason) => (
                            <span key={reason} style={{ color: "var(--muted)", fontSize: 11 }}>{reason}</span>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>처리 근거가 없습니다.</p>
                      )}

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        {placeUrl && (
                          <a className="status-pill" href={placeUrl} target="_blank" rel="noreferrer">네이버 장소 ↗</a>
                        )}
                        {website && (
                          <a className="status-pill" href={website} target="_blank" rel="noreferrer">공식 홈페이지 ↗</a>
                        )}
                      </div>
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
            <span>‘다음 10곳 자동 확인’을 눌러 소규모 시험부터 시작해주세요.</span>
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
          .result-grid,
          .manual-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
