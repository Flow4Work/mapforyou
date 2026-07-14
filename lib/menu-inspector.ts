import type { MenuCheckStatus, MenuItem } from "./types";

const PRICE_PATTERN = /(?:₩\s*)?\d{1,3}(?:,\d{3})+(?:\s*원)?/g;
const MENU_HINTS = ["메뉴", "메뉴판", "대표", "가격", "원"];

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSimpleMenus(text: string): MenuItem[] {
  const prices = [...text.matchAll(PRICE_PATTERN)].slice(0, 20);
  const menus: MenuItem[] = [];
  for (const match of prices) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 70), index).trim();
    const candidate = before.split(/[|·•\n]/).pop()?.trim() ?? "";
    const name = candidate
      .replace(/메뉴|대표|AI 추천|가격|수정 제안하기/g, " ")
      .replace(/\s+/g, " ")
      .slice(-45)
      .trim();
    if (name.length < 2 || menus.some((item) => item.nameKo === name)) continue;
    menus.push({
      id: `auto-${menus.length + 1}`,
      category: "메뉴",
      nameKo: name,
      descriptionKo: "",
      price: match[0].includes("원") ? match[0] : `${match[0]}원`,
      isRepresentative: menus.length < 2,
      nameEn: "",
      descriptionEn: "",
      nameJa: "",
      descriptionJa: "",
    });
  }
  return menus;
}

export async function inspectKakaoMenu(placeUrl: string): Promise<{
  status: MenuCheckStatus;
  evidence: string;
  menus: MenuItem[];
}> {
  try {
    const response = await fetch(placeUrl.replace("http://", "https://"), {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MapForYouMenuResearch/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return { status: "failed", evidence: `상세페이지 응답 오류 ${response.status}`, menus: [] };
    }

    const html = await response.text();
    const text = cleanText(html);
    const hintCount = MENU_HINTS.filter((hint) => text.includes(hint)).length;
    const priceCount = (text.match(PRICE_PATTERN) ?? []).length;
    const menus = extractSimpleMenus(text);

    if (/메뉴판/.test(text) && priceCount === 0) {
      return { status: "image-only", evidence: "메뉴판 이미지 표시는 확인됐지만 텍스트 가격은 찾지 못함", menus: [] };
    }
    if (menus.length >= 3) {
      return { status: "found", evidence: `텍스트 메뉴 후보 ${menus.length}개와 가격 패턴 ${priceCount}개 확인`, menus };
    }
    if (hintCount >= 2 && priceCount >= 1) {
      return { status: "partial", evidence: `메뉴 관련 문구와 가격 ${priceCount}개 확인. 수동 검수 필요`, menus };
    }
    return { status: "missing", evidence: "공개 상세페이지에서 텍스트 메뉴를 확인하지 못함", menus: [] };
  } catch (error) {
    return {
      status: "failed",
      evidence: error instanceof Error ? error.message : "메뉴 검사 중 알 수 없는 오류",
      menus: [],
    };
  }
}
