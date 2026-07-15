"use client";

import { useEffect, useState } from "react";

type Candidate = {
  placeId?: string | null;
  placeUrl?: string | null;
  searchUrl?: string;
  officialWebsite?: string | null;
  instagramUrl?: string | null;
  instagramUsername?: string | null;
  confidence?: number;
  reasons?: string[];
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
  checkedAt: string | null;
  naverPlaceUrl: string | null;
  officialWebsiteUrl: string | null;
};

type StatusResponse = {
  total?: number;
  unchecked?: number;
  candidate?: number;
  verified?: number;
  notFound?: number;
  rows?: InstagramRow[];
  error?: string;
};

type ScanResponse = {
  processed?: number;
  placeResolved?: number;
  found?: number;
  stopped?: boolean;
  message?: string;
  error?: string;
};

const REGIONS = [
  { value: "all", label: "성수 + 홍대" },
  { value: "seongsu", label: "성수" },
  { value: "hongdae", label: "홍대" },
];

function regionLabel(value: string) {
  if (value === "seongsu") return "성수";
  if (value === "hongdae") return "홍대";
  return value || "지역 미확인";
}

function statusLabel(row: InstagramRow) {
  if (row.instagramStatus === "verified") {
    if (row.instagramSource === "naver_place_direct") return "네이버 링크 확인";
    if (row.instagramSource === "naver_official_website") return "공식 홈페이지 확인";
    return "확정";
  }
  if (row.instagramStatus === "candidate") return "장소 확인 필요";
  if (row.instagramStatus === "not_found") {
    return row.instagramSource === "naver_place_no_instagram" ? "인스타 없음" : "매칭 실패";
  }
  return "미확인";
}

function statusClass(status: string) {
  if (status === "verified") return "status-found";
  if (status === "candidate") return "status-partial";
  if (status === "not_found") return "status-missing";
  return "";
}

export default function NaverPlaceInstagramFinderV2() {
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<StatusResponse>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [stopped, setStopped] = useState(false);

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
      if (!response.ok) throw new Error(data.error || "현황 조회 실패");
      setStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "현황 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  async function scan(retry = false) {
    setRunning(true);
    setStopped(false);
    setMessage(retry ? "없음·실패 가게를 다시 확인 중입니다." : "네이버 장소 10곳을 순차 확인 중입니다.");
    try {
      const response = await fetch("/api/public-data/naver-place-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, limit: 10, retry }),
      });
      const data = (await response.json()) as ScanResponse;
      if (!response.ok) throw new Error(data.error || "네이버 장소 확인 실패");
      setStopped(Boolean(data.stopped));
      setMessage(data.message || "네이버 장소 확인을 완료했습니다.");
      await loadStatus(region);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "네이버 장소 확인 실패");
    } finally {
      setRunning(false);
    }
  }

  async function saveAction(
    row: InstagramRow,
    action: "manual" | "not_found" | "reject",
    url?: string,
  ) {
    setSavingId(row.sourceId);
    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceId: row.sourceId, url, region }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "저장 실패");
      setStatus(data);
      setMessage(`${row.name}: 저장했습니다.`);
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

  return (
    <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 22 }}>
        <div>
          <p className="eyebrow">NAVER PLACE BROWSER CHECK</p>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>
            네이버 장소에서 인스타 자동 확인
          </h1>
          <p style={{ maxWidth: 800, margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
            앱의 네이버 지도 검색 링크를 실제 서버 브라우저로 열고, 상호명·지점명·주소가 맞는 결과를 선택합니다.
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
            <h2>별도 API 없이 저속 시험</h2>
          </div>
          <strong>10곳씩 순차 처리</strong>
        </div>
        <div className="notice" style={{ marginTop: 0 }}>
          로그인·캡차 우회·프록시는 사용하지 않습니다. 접근 제한 문구가 나타나면 즉시 중단하고, 처리하지 못한
          가게는 그대로 남깁니다.
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {[
          ["전체", status.total ?? 0],
          ["미확인", status.unchecked ?? 0],
          ["장소 확인 필요", status.candidate ?? 0],
          ["인스타 확정", status.verified ?? 0],
          ["없음·실패", status.notFound ?? 0],
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
            <span>LOW-SPEED BATCH</span>
            <h2>네이버 장소 자동 확인</h2>
          </div>
          <p>한 브라우저에서 순차 실행</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            disabled={running}
            style={{ padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11, background: "white" }}
          >
            {REGIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <button className="primary-button" disabled={running || !status.unchecked} onClick={() => void scan(false)}>
            {running ? "네이버 장소 확인 중…" : "다음 10곳 자동 확인"}
          </button>
          <button className="ghost-button" disabled={running || !status.notFound} onClick={() => void scan(true)}>
            없음·실패 10곳 재확인
          </button>
        </div>
        {message && (
          <div className="notice" style={stopped ? { color: "#8b4a42", background: "#f5dfdc" } : undefined}>
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
          <p>네이버 장소·홈페이지·인스타 링크 확인</p>
        </div>

        {loading ? (
          <div className="empty-state compact">현황을 불러오는 중입니다.</div>
        ) : status.rows?.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {status.rows.map((row) => {
              const candidate = row.candidates?.[0];
              const placeUrl = row.naverPlaceUrl || candidate?.placeUrl || candidate?.searchUrl;
              const website = row.officialWebsiteUrl || candidate?.officialWebsite;
              const draft = manualDrafts[row.sourceId] ?? "";
              const saving = savingId === row.sourceId;

              return (
                <article
                  key={row.sourceId}
                  style={{ padding: 18, border: "1px solid var(--line)", borderRadius: 16, background: "#fbfcf8" }}
                >
                  <div className="result-grid">
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <strong style={{ fontSize: 16 }}>{row.name}</strong>
                        <span className={`status-pill ${statusClass(row.instagramStatus)}`}>{statusLabel(row)}</span>
                        <span className="status-pill">{regionLabel(row.regionKey)}</span>
                      </div>
                      <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
                        {row.address || "주소 없음"}{row.category ? ` · ${row.category}` : ""}
                      </p>
                      {row.checkedAt && (
                        <small style={{ display: "block", marginTop: 7, color: "var(--muted)" }}>
                          {new Date(row.checkedAt).toLocaleString("ko-KR")}
                        </small>
                      )}
                    </div>

                    <div>
                      {row.instagramUrl ? (
                        <a className="text-link" href={row.instagramUrl} target="_blank" rel="noreferrer">
                          @{row.instagramUsername || row.instagramUrl} ↗
                        </a>
                      ) : (
                        <div style={{ display: "grid", gap: 5 }}>
                          {(candidate?.reasons || ["인스타그램 링크를 찾지 못했습니다."]).map((reason) => (
                            <span key={reason} style={{ color: "var(--muted)", fontSize: 11 }}>{reason}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        {placeUrl && <a className="status-pill" href={placeUrl} target="_blank" rel="noreferrer">네이버 장소 ↗</a>}
                        {website && <a className="status-pill" href={website} target="_blank" rel="noreferrer">공식 홈페이지 ↗</a>}
                      </div>
                    </div>
                  </div>

                  {!row.instagramUrl && (
                    <>
                      <div className="manual-grid">
                        <input
                          value={draft}
                          onChange={(event) => setManualDrafts((current) => ({ ...current, [row.sourceId]: event.target.value }))}
                          placeholder="추가로 확인한 https://www.instagram.com/사용자명/"
                          disabled={saving}
                          style={{ minWidth: 0, padding: "11px 12px", border: "1px solid #dde0d8", borderRadius: 11 }}
                        />
                        <button className="ghost-button" disabled={saving || !draft.trim()} onClick={() => void saveAction(row, "manual", draft)}>
                          직접 URL 확정
                        </button>
                      </div>
                      <div className="action-row" style={{ marginTop: 10 }}>
                        <button className="text-button" disabled={saving} onClick={() => void saveAction(row, "not_found")}>
                          계정 없음 처리
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
            <span>성수 또는 홍대를 선택하고 10곳 시험을 실행해주세요.</span>
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
          margin-top: 14px;
        }
        @media (max-width: 760px) {
          .result-grid,
          .manual-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
