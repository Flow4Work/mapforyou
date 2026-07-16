"use client";

import { useMemo, useState } from "react";

type MenuDraft = {
  nameKo: string;
  price: number;
  sourceText?: string;
};

type PlaceDraft = {
  sourceId: string;
  naverPlaceId: string;
  naverPlaceUrl: string;
  name: string;
  roadAddress: string;
  address: string;
  phone: string;
  category: string;
  introduction: string;
  instagramUrl: string;
  instagramUsername: string;
  officialWebsiteUrl: string;
  latitude: number | null;
  longitude: number | null;
  menus: MenuDraft[];
  warnings: string[];
};

type SaveTest = {
  restaurantSaved?: boolean;
  addressSaved?: boolean;
  instagramSaved?: boolean;
  menuCount?: number;
  publishStatus?: string;
  readyForPublic?: boolean;
};

function menusToText(menus: MenuDraft[]) {
  return menus.map((menu) => `${menu.nameKo} | ${menu.price || ""}`).join("\n");
}

function parseMenuText(value: string): MenuDraft[] {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(/\s*[|\t]\s*/);
      if (parts.length < 2) return [];
      const nameKo = parts[0]?.trim() ?? "";
      const price = Number((parts[1] ?? "").replace(/[^0-9]/g, ""));
      return nameKo && price > 0 ? [{ nameKo, price }] : [];
    })
    .slice(0, 40);
}

function statusBox(label: string, complete: boolean, detail: string) {
  return (
    <div className="notice" style={{ margin: 0 }}>
      <strong style={{ display: "block", fontSize: 17 }}>{complete ? "완료" : "필요"} · {label}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function CuratedPlaceBuilder() {
  const [url, setUrl] = useState("");
  const [regionKey, setRegionKey] = useState("seongsu");
  const [draft, setDraft] = useState<PlaceDraft | null>(null);
  const [menuText, setMenuText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [test, setTest] = useState<SaveTest | null>(null);

  const parsedMenus = useMemo(() => parseMenuText(menuText), [menuText]);
  const hasPlace = Boolean(draft?.name.trim() && (draft?.roadAddress.trim() || draft?.address.trim()));
  const hasInstagram = Boolean(draft?.instagramUrl.trim());
  const hasMenus = parsedMenus.length > 0;
  const hasCoordinates = Number.isFinite(Number(draft?.latitude)) && Number.isFinite(Number(draft?.longitude));
  const ready = hasPlace && hasInstagram && hasMenus && hasCoordinates;

  function update<K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setTest(null);
  }

  async function preview() {
    setLoading(true);
    setMessage("네이버 장소 1곳을 확인하고 있습니다.");
    setTest(null);
    try {
      const response = await fetch("/api/public-data/curated-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", url }),
      });
      const data = (await response.json()) as { preview?: PlaceDraft; error?: string };
      if (!response.ok || !data.preview) throw new Error(data.error || "가게 정보를 불러오지 못했습니다.");

      let nextDraft = data.preview;
      if ((!Number.isFinite(Number(nextDraft.latitude)) || !Number.isFinite(Number(nextDraft.longitude))) && nextDraft.name) {
        const coordinateResponse = await fetch("/api/public-data/curated-place/coordinates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextDraft.name, address: nextDraft.roadAddress || nextDraft.address }),
        });
        const coordinateData = (await coordinateResponse.json()) as { place?: Partial<PlaceDraft> };
        if (coordinateResponse.ok && coordinateData.place) nextDraft = { ...nextDraft, ...coordinateData.place };
      }

      setDraft(nextDraft);
      setMenuText(menusToText(nextDraft.menus));
      setMessage(
        `가게·주소 ${nextDraft.name && nextDraft.roadAddress ? "확인" : "수정 필요"} · 인스타 ${nextDraft.instagramUrl ? "확인" : "직접 입력 필요"} · 메뉴 ${nextDraft.menus.length}개 후보`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "가게 확인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage("Supabase 저장 후 다시 읽어 검증하고 있습니다.");
    setTest(null);
    try {
      const response = await fetch("/api/public-data/curated-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          action: "save",
          regionKey,
          menus: parsedMenus,
          publish: true,
        }),
      });
      const data = (await response.json()) as { test?: SaveTest; error?: string };
      if (!response.ok || !data.test) throw new Error(data.error || "저장 검증에 실패했습니다.");
      setTest(data.test);
      setMessage(data.test.readyForPublic ? "저장·공개와 재조회 검증이 완료됐습니다." : "저장됐지만 공개 준비 검증에 실패했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
      <header style={{ marginBottom: 22 }}>
        <p className="eyebrow">CURATED PLACE BUILDER</p>
        <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>인기 가게 1곳 완성</h1>
        <p style={{ maxWidth: 820, margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
          네이버 장소 URL 한 개를 기준으로 가게·주소·인스타그램·메뉴 후보를 모은 뒤, 사람이 수정하고 한 번에 저장합니다.
        </p>
      </header>

      <section className="card" style={{ padding: 24 }}>
        <div className="section-heading" style={{ marginBottom: 16 }}>
          <div><span>STEP 1</span><h2>네이버 장소 불러오기</h2></div>
          <strong>한 번에 1곳</strong>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 150px", gap: 10 }}>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://map.naver.com/p/entry/place/... 또는 장소 ID"
            disabled={loading || saving}
            style={{ width: "100%", padding: "13px 14px", border: "1px solid var(--line)", borderRadius: 12 }}
          />
          <button className="primary-button" disabled={!url.trim() || loading || saving} onClick={() => void preview()}>
            {loading ? "확인 중…" : "가게 불러오기"}
          </button>
        </div>
        {message && <div className="notice">{message}</div>}
      </section>

      {draft && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, margin: "18px 0" }}>
            {statusBox("가게·주소", hasPlace, hasPlace ? "기준 장소가 정해졌습니다." : "가게명과 주소를 확인해주세요.")}
            {statusBox("인스타그램", hasInstagram, hasInstagram ? draft.instagramUrl : "공식 계정을 직접 입력해주세요.")}
            {statusBox("메뉴", hasMenus, hasMenus ? `${parsedMenus.length}개 메뉴가 저장됩니다.` : "메뉴명 | 가격 형식으로 입력해주세요.")}
            {statusBox("지도 좌표", hasCoordinates, hasCoordinates ? `${draft.latitude}, ${draft.longitude}` : "네이버 검색 API 키 또는 주소를 확인해주세요.")}
          </section>

          <section className="card" style={{ padding: 24 }}>
            <div className="section-heading" style={{ marginBottom: 16 }}>
              <div><span>STEP 2</span><h2>자동 결과 확인·수정</h2></div>
              <a className="ghost-button" href={draft.naverPlaceUrl} target="_blank" rel="noreferrer">네이버 원본 열기</a>
            </div>

            {draft.warnings.length > 0 && (
              <div className="notice">
                <strong>자동 확인 결과</strong><br />
                {draft.warnings.join(" · ")}
              </div>
            )}

            <div className="form-grid">
              <label className="field"><span>지역</span><select value={regionKey} onChange={(event) => setRegionKey(event.target.value)}><option value="seongsu">성수</option><option value="hongdae">홍대</option></select></label>
              <label className="field"><span>가게명</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
              <label className="field"><span>도로명 주소</span><input value={draft.roadAddress} onChange={(event) => update("roadAddress", event.target.value)} /></label>
              <label className="field"><span>전화번호</span><input value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label>
              <label className="field"><span>카테고리</span><input value={draft.category} onChange={(event) => update("category", event.target.value)} placeholder="카페, 한식 등" /></label>
              <label className="field"><span>공식 인스타그램</span><input value={draft.instagramUrl} onChange={(event) => update("instagramUrl", event.target.value)} placeholder="https://www.instagram.com/..." /></label>
              <label className="field" style={{ gridColumn: "1 / -1" }}><span>짧은 소개</span><textarea rows={3} value={draft.introduction} onChange={(event) => update("introduction", event.target.value)} /></label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>메뉴 · 한 줄에 `메뉴명 | 가격`</span>
                <textarea rows={12} value={menuText} onChange={(event) => { setMenuText(event.target.value); setTest(null); }} placeholder={"아메리카노 | 5000\n성수 시그니처 라떼 | 6500"} />
                <small>자동 추출이 틀리면 지우거나 고쳐주세요. 대표 메뉴부터 최대 40개까지 저장합니다.</small>
              </label>
            </div>
          </section>

          <section className="card" style={{ padding: 24, marginTop: 18 }}>
            <div className="section-heading" style={{ marginBottom: 16 }}>
              <div><span>STEP 3</span><h2>저장·재조회 테스트</h2></div>
              <strong>{ready ? "3가지 조합 완료" : "정보 보완 필요"}</strong>
            </div>
            <div className="notice" style={{ marginTop: 0 }}>
              가게·주소·인스타그램·메뉴·지도 좌표가 모두 확인된 경우에만 저장과 공개가 가능합니다.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button className="primary-button" disabled={saving || !ready} onClick={() => void save()}>{saving ? "저장·검증 중…" : "저장하고 공개"}</button>
            </div>

            {test && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 16 }}>
                {statusBox("가게 DB", Boolean(test.restaurantSaved), test.restaurantSaved ? "재조회 성공" : "저장 실패")}
                {statusBox("주소 DB", Boolean(test.addressSaved), test.addressSaved ? "재조회 성공" : "주소 없음")}
                {statusBox("인스타 DB", Boolean(test.instagramSaved), test.instagramSaved ? "재조회 성공" : "인스타 없음")}
                {statusBox("메뉴 DB", Number(test.menuCount || 0) > 0, `${Number(test.menuCount || 0)}개 재조회`)}
                {statusBox("공개 준비", Boolean(test.readyForPublic), test.publishStatus || "draft")}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
