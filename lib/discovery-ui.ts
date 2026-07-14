import type { DiscoveryRestaurant } from "@/lib/discovery";

export type PublicLanguage = "en" | "ja";
export type BroadCategory = "cafe" | "korean" | "japanese" | "chinese" | "meat" | "dessert" | "other";

const INITIAL_ROMAN = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWEL_ROMAN = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const FINAL_ROMAN = ["", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lk", "lm", "lb", "ls", "lt", "lp", "lh", "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "h"];

const ENGLISH_TERMS: Array<[RegExp, string]> = [
  [/파리바게뜨/g, "Paris Baguette"],
  [/이디야커피/g, "Ediya Coffee"],
  [/멕시카나치킨/g, "Mexicana Chicken"],
  [/페리카나치킨/g, "Pelicana Chicken"],
  [/이삭토스트/g, "Isaac Toast"],
  [/써브웨이/g, "Subway"],
  [/롯데리아/g, "Lotteria"],
  [/둘둘치킨/g, "Two Two Chicken"],
  [/손칼국수/g, "Hand-cut Noodles"],
  [/중국집/g, "Chinese Restaurant"],
  [/베이커리/g, "Bakery"],
  [/삼겹살/g, "Samgyeopsal"],
  [/떡볶이/g, "Tteokbokki"],
  [/설렁탕/g, "Seolleongtang"],
  [/칼국수/g, "Kalguksu"],
  [/돈까스/g, "Pork Cutlet"],
  [/아이스크림/g, "Ice Cream"],
  [/반점/g, "Chinese Restaurant"],
  [/식당/g, "Restaurant"],
  [/카페/g, "Cafe"],
  [/커피/g, "Coffee"],
  [/치킨/g, "Chicken"],
  [/피자/g, "Pizza"],
  [/버거/g, "Burger"],
  [/마을/g, "Maeul"],
  [/국밥/g, "Gukbap"],
  [/찌개/g, "Jjigae"],
  [/갈비/g, "Galbi"],
  [/곱창/g, "Gopchang"],
  [/족발/g, "Jokbal"],
  [/보쌈/g, "Bossam"],
  [/냉면/g, "Naengmyeon"],
  [/김밥/g, "Gimbap"],
  [/초밥/g, "Sushi"],
  [/스시/g, "Sushi"],
  [/라멘/g, "Ramen"],
  [/우동/g, "Udon"],
  [/막창/g, "Makchang"],
  [/포차/g, "Pocha"],
  [/브루어리/g, "Brewery"],
  [/펍/g, "Pub"],
];

const JAPANESE_BRANDS: Array<[RegExp, string]> = [
  [/써브웨이/g, "サブウェイ"],
  [/롯데리아/g, "ロッテリア"],
  [/파리바게뜨/g, "パリバゲット"],
  [/이디야커피/g, "イディヤコーヒー"],
  [/이삭토스트/g, "イサックトースト"],
  [/멕시카나チキン/g, "メキシカーナチキン"],
  [/페리카나치킨/g, "ペリカーナチキン"],
  [/둘둘치킨/g, "トゥドゥルチキン"],
];

const KNOWN_ENGLISH_MENUS: Record<string, string> = {
  "묵은지 매운갈비찜": "Aged Kimchi Spicy Braised Short Ribs",
  "묵은지매운갈비찜": "Aged Kimchi Spicy Braised Short Ribs",
  "불고기 짜장면": "Bulgogi Black Bean Noodles",
  "불고기짜장면": "Bulgogi Black Bean Noodles",
  "불고기 짬뽕": "Bulgogi Spicy Seafood Noodle Soup",
  "불고기짬뽕": "Bulgogi Spicy Seafood Noodle Soup",
  "김치찌개": "Kimchi Stew",
  "된장찌개": "Soybean Paste Stew",
  "순두부찌개": "Soft Tofu Stew",
  "제육볶음": "Spicy Stir-fried Pork",
  "돼지갈비": "Pork Ribs",
  "소갈비": "Beef Short Ribs",
  "갈비찜": "Braised Short Ribs",
  "삼겹살": "Pork Belly",
  "비빔밥": "Bibimbap",
  "불고기": "Bulgogi",
  "냉면": "Cold Noodles",
  "칼국수": "Knife-cut Noodles",
  "보쌈": "Bossam",
  "족발": "Jokbal",
  "떡볶이": "Spicy Rice Cakes",
  "김밥": "Gimbap",
};

const KNOWN_ENGLISH_PLACES: Record<string, string> = {
  "성수": "Seongsu",
  "성수역": "Seongsu Station",
  "서울숲": "Seoul Forest",
  "왕십리": "Wangsimni",
  "홍대": "Hongdae",
  "연남": "Yeonnam",
  "합정": "Hapjeong",
  "망원": "Mangwon",
  "뚝섬": "Ttukseom",
  "건대": "Konkuk Univ.",
};

function romanizeHangul(value: string) {
  return [...value].map((character) => {
    const code = character.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return character;
    const initial = Math.floor(code / 588);
    const vowel = Math.floor((code % 588) / 28);
    const final = code % 28;
    return `${INITIAL_ROMAN[initial]}${VOWEL_ROMAN[vowel]}${FINAL_ROMAN[final]}`;
  }).join("");
}

function cleanRomanized(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s*/g, " (")
    .replace(/\s*\)/g, ")")
    .trim()
    .replace(/(^|\s|\()([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

export function romanizeKorean(value: string) {
  let working = value;
  const protectedValues: string[] = [];
  for (const [pattern, replacement] of ENGLISH_TERMS) {
    working = working.replace(pattern, () => {
      const token = `__TERM_${protectedValues.length}__`;
      protectedValues.push(replacement);
      return ` ${token} `;
    });
  }
  let result = cleanRomanized(romanizeHangul(working));
  protectedValues.forEach((replacement, index) => {
    result = result.replace(`__TERM_${index}__`, replacement);
  });
  return cleanRomanized(result);
}

function normalizeEnglishText(value: string) {
  const collapsed = value
    .replace(/\s+/g, " ")
    .replace(/\(\s*/g, " (")
    .replace(/\s*\)/g, ")")
    .replace(/\bbul\s*gogi\b/gi, "Bulgogi")
    .replace(/\bjjajangmyeon\b/gi, "Jajangmyeon")
    .replace(/\bjjajang\b/gi, "Jajang")
    .replace(/\bjjamppong\b/gi, "Jjamppong")
    .replace(/\bmukeunji\s+maeun\s*galbijjim\b/gi, "Aged Kimchi Spicy Braised Short Ribs")
    .replace(/\bmukeunji\s+maeungalbijjim\b/gi, "Aged Kimchi Spicy Braised Short Ribs")
    .replace(/\bmaeun\s*galbijjim\b/gi, "Spicy Braised Short Ribs")
    .trim();

  if (!collapsed) return collapsed;
  if (collapsed === collapsed.toLowerCase()) {
    return collapsed.replace(/(^|[\s(/-])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
  }
  return collapsed.replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

function englishPlaceName(value: string) {
  if (KNOWN_ENGLISH_PLACES[value]) return KNOWN_ENGLISH_PLACES[value];
  if (value.endsWith("역")) {
    const base = value.slice(0, -1);
    return `${KNOWN_ENGLISH_PLACES[base] || romanizeKorean(base)} Station`;
  }
  return romanizeKorean(value);
}

function englishBranchLabel(value: string) {
  if (value.endsWith("본점")) {
    const place = value.slice(0, -2);
    return place ? `${englishPlaceName(place)} Main Branch` : "Main Branch";
  }
  if (value.endsWith("점")) {
    const place = value.slice(0, -1);
    return place ? `${englishPlaceName(place)} Branch` : "Branch";
  }
  return romanizeKorean(value);
}

function fallbackEnglishRestaurantName(value: string) {
  const match = value.trim().match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (!match) return romanizeKorean(value);
  const base = romanizeKorean(match[1]);
  const branch = englishBranchLabel(match[2]);
  return `${base} – ${branch}`;
}

function englishNameNeedsRepair(value: string) {
  const compact = value.replace(/[^A-Za-z]/g, "");
  return /[가-힣]/.test(value)
    || /seongsuyeokjeom|seoulsupjeom|wangsimnibonjeom|bonjeom/i.test(value)
    || (!value.includes(" ") && compact.length >= 16);
}

const KANA_ROWS: Record<string, string[]> = {
  "": ["ア", "イ", "ウ", "エ", "オ"],
  g: ["ガ", "ギ", "グ", "ゲ", "ゴ"],
  kk: ["カ", "キ", "ク", "ケ", "コ"],
  k: ["カ", "キ", "ク", "ケ", "コ"],
  n: ["ナ", "ニ", "ヌ", "ネ", "ノ"],
  d: ["ダ", "ディ", "ドゥ", "デ", "ド"],
  tt: ["タ", "ティ", "トゥ", "テ", "ト"],
  t: ["タ", "ティ", "トゥ", "テ", "ト"],
  r: ["ラ", "リ", "ル", "レ", "ロ"],
  m: ["マ", "ミ", "ム", "メ", "モ"],
  b: ["バ", "ビ", "ブ", "ベ", "ボ"],
  pp: ["パ", "ピ", "プ", "ペ", "ポ"],
  p: ["パ", "ピ", "プ", "ペ", "ポ"],
  s: ["サ", "シ", "ス", "セ", "ソ"],
  ss: ["サ", "シ", "ス", "セ", "ソ"],
  j: ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
  jj: ["チャ", "チ", "チュ", "チェ", "チョ"],
  ch: ["チャ", "チ", "チュ", "チェ", "チョ"],
  h: ["ハ", "ヒ", "フ", "ヘ", "ホ"],
};

const FINAL_KANA = ["", "ク", "ク", "クス", "ン", "ンジ", "ン", "ッ", "ル", "ルク", "ルム", "ルプ", "ルス", "ルト", "ルプ", "ル", "ム", "プ", "プス", "ッ", "ッ", "ン", "ッ", "ッ", "ク", "ッ", "プ", "ッ"];

function kanaSyllable(initialIndex: number, vowelIndex: number, finalIndex: number) {
  const initial = INITIAL_ROMAN[initialIndex];
  const row = KANA_ROWS[initial] ?? KANA_ROWS[""];
  const vowel = VOWEL_ROMAN[vowelIndex];
  const basicIndex = vowel === "i" ? 1 : vowel === "u" || vowel === "eu" ? 2 : vowel === "e" || vowel === "ae" ? 3 : vowel === "o" || vowel === "eo" ? 4 : 0;
  let body = row[basicIndex];

  if (["ya", "yae", "yeo", "ye", "yo", "yu"].includes(vowel)) {
    const small = vowel === "yu" ? "ュ" : vowel === "yo" || vowel === "yeo" ? "ョ" : "ャ";
    body = initial ? `${row[1]}${small}` : vowel === "yu" ? "ユ" : vowel === "yo" || vowel === "yeo" ? "ヨ" : "ヤ";
  } else if (vowel === "wa") body = initial ? `${row[2]}ァ` : "ワ";
  else if (["wae", "we", "oe"].includes(vowel)) body = initial ? `${row[2]}ェ` : "ウェ";
  else if (vowel === "wo") body = initial ? `${row[2]}ォ` : "ウォ";
  else if (vowel === "wi" || vowel === "ui") body = initial ? `${row[2]}ィ` : "ウィ";

  return `${body}${FINAL_KANA[finalIndex]}`;
}

export function koreanToKatakana(value: string) {
  let working = value;
  const protectedValues: string[] = [];
  for (const [pattern, replacement] of JAPANESE_BRANDS) {
    working = working.replace(pattern, () => {
      const token = `__ブランド_${protectedValues.length}__`;
      protectedValues.push(replacement);
      return token;
    });
  }

  let result = [...working].map((character) => {
    const code = character.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return character;
    const initial = Math.floor(code / 588);
    const vowel = Math.floor((code % 588) / 28);
    const final = code % 28;
    return kanaSyllable(initial, vowel, final);
  }).join("").replace(/\s+/g, " ").trim();

  protectedValues.forEach((replacement, index) => {
    result = result.replace(`__ブランド_${index}__`, replacement);
  });
  return result;
}

export function broadCategory(store: Pick<DiscoveryRestaurant, "category" | "licenseType" | "name">): BroadCategory {
  const value = `${store.category} ${store.licenseType} ${store.name}`.toLowerCase();
  if (/카페|커피|다방|휴게음식|베이커리|제과|빵/.test(value)) return "cafe";
  if (/일식|초밥|스시|라멘|우동|돈까스|참치/.test(value)) return "japanese";
  if (/중식|중국|짜장|짬뽕|마라|양꼬치/.test(value)) return "chinese";
  if (/고기|구이|갈비|삼겹|식육|숯불|곱창|족발/.test(value)) return "meat";
  if (/도넛|도너츠|아이스크림|과자|떡|강정|마카롱|디저트/.test(value)) return "dessert";
  if (/한식|백반|국밥|찌개|분식|김밥/.test(value)) return "korean";
  return "other";
}

export function categoryLabel(category: BroadCategory, language: PublicLanguage) {
  const labels: Record<BroadCategory, { en: string; ja: string }> = {
    cafe: { en: "Cafe", ja: "カフェ" },
    korean: { en: "Korean", ja: "韓国料理" },
    japanese: { en: "Japanese", ja: "日本料理" },
    chinese: { en: "Chinese", ja: "中華料理" },
    meat: { en: "Korean BBQ", ja: "韓国焼肉" },
    dessert: { en: "Dessert", ja: "デザート" },
    other: { en: "Restaurant", ja: "レストラン" },
  };
  return labels[category][language];
}

export function categoryIcon(category: BroadCategory) {
  const icons: Record<BroadCategory, string> = {
    cafe: "☕",
    korean: "🍚",
    japanese: "🍜",
    chinese: "🥟",
    meat: "🥩",
    dessert: "🍩",
    other: "🍽",
  };
  return icons[category];
}

export function localizedRestaurantName(store: Pick<DiscoveryRestaurant, "name" | "nameEn" | "nameJa">, language: PublicLanguage) {
  if (language === "ja") return store.nameJa || koreanToKatakana(store.name);
  const supplied = store.nameEn?.trim();
  if (supplied && !englishNameNeedsRepair(supplied)) return normalizeEnglishText(supplied);
  return fallbackEnglishRestaurantName(store.name);
}

function fallbackAddress(value: string, language: PublicLanguage) {
  if (!value) return language === "ja" ? "住所情報なし" : "Address unavailable";
  if (language === "ja") {
    return koreanToKatakana(value)
      .replace("ソウルトゥクビョルシ", "ソウル特別市")
      .replace("ソンドング", "城東区")
      .replace("マポグ", "麻浦区");
  }
  return romanizeHangul(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)
    .replace("Seoulteukbyeolsi", "Seoul")
    .replace("Seongdonggu", "Seongdong-gu")
    .replace("Mapogu", "Mapo-gu");
}

export function localizedAddress(store: Pick<DiscoveryRestaurant, "roadAddress" | "roadAddressEn" | "roadAddressJa" | "address">, language: PublicLanguage) {
  if (language === "ja") return store.roadAddressJa || fallbackAddress(store.roadAddress || store.address, language);
  return store.roadAddressEn || fallbackAddress(store.roadAddress || store.address, language);
}

export function localizedIntroduction(store: Pick<DiscoveryRestaurant, "introduction" | "introductionEn" | "introductionJa">, language: PublicLanguage) {
  if (language === "ja") return store.introductionJa || "翻訳メニューと価格を来店前に確認できます。";
  return store.introductionEn || "Check translated menu names and prices before you visit.";
}

export function localizedMenuName(menu: { nameKo: string; nameEn: string; nameJa: string }, language: PublicLanguage) {
  if (language === "ja") return menu.nameJa || (menu.nameKo ? koreanToKatakana(menu.nameKo) : menu.nameEn);
  const known = KNOWN_ENGLISH_MENUS[menu.nameKo?.replace(/\s+/g, " ").trim()];
  if (known) return known;
  if (menu.nameEn) return normalizeEnglishText(menu.nameEn);
  return menu.nameKo ? romanizeKorean(menu.nameKo) : normalizeEnglishText(menu.nameJa);
}

export function priceLabel(price: number, language: PublicLanguage) {
  if (!price) return language === "ja" ? "価格未確認" : "Price unavailable";
  return `₩${price.toLocaleString("en-US")}`;
}

export function regionLabel(regionKey: string, language: PublicLanguage) {
  const labels: Record<string, { en: string; ja: string }> = {
    seongsu: { en: "Seongsu", ja: "聖水" },
    hongdae: { en: "Hongdae", ja: "弘大" },
    geondae: { en: "Konkuk Univ.", ja: "建大入口" },
  };
  return labels[regionKey]?.[language] ?? (regionKey || (language === "ja" ? "ソウル" : "Seoul"));
}

export function googleMapUrl(store: DiscoveryRestaurant) {
  const address = store.roadAddress || store.address;
  const query = [store.name, address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function naverMapUrl(store: DiscoveryRestaurant) {
  const query = `${store.name} ${store.roadAddress || store.address}`.trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}
