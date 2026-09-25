import type { DiscoveryMenu, DiscoveryRestaurant } from "@/lib/discovery";

function isHttpImage(value: string) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function imageKey(value: string) {
  return String(value || "")
    .trim()
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
}

function searchableImageText(value: string) {
  const raw = String(value || "").toLowerCase();
  try {
    return `${raw} ${decodeURIComponent(raw)}`;
  } catch {
    return raw;
  }
}

function isSuspiciousImage(value: string) {
  const text = searchableImageText(value);
  return /(qrcode|\bqr\b|logo|symbol|brandmark|banner|poster|coupon|notice|menu[-_ ]?board|\uB85C\uACE0|\uBC30\uB108|\uD3EC\uC2A4\uD130|\uCFE0\uD3F0|\uACF5\uC9C0|\uBA54\uB274\uD310)/i.test(text);
}

function imageQualityScore(value: string) {
  const text = searchableImageText(value);
  if (isSuspiciousImage(value)) return -1000;
  if (/\.(jpe?g)(?:$|[?#])/i.test(text)) return 20;
  if (/\.webp(?:$|[?#])/i.test(text)) return 16;
  if (/\.png(?:$|[?#])/i.test(text)) return -15;
  return 0;
}

function scoredVerifiedMenuImages(store: DiscoveryRestaurant) {
  return store.menus
    .filter((menu) => menu.imageStatus === "verified" && isHttpImage(menu.imageUrl))
    .map((menu, index) => ({
      url: menu.imageUrl.trim(),
      score:
        imageQualityScore(menu.imageUrl)
        + (menu.isSpecialty ? 30 : 0)
        + (menu.price > 0 ? 5 : 0),
      index,
    }))
    .filter((item) => item.score > -500)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.url);
}

export function restaurantPhotoCandidates(store: DiscoveryRestaurant, limit = 12) {
  const trustedGallery: string[] = [];
  const gallerySeen = new Set<string>();

  for (const raw of [store.imageUrl, ...(store.imageGalleryUrls || [])]) {
    const url = String(raw || "").trim();
    if (!isHttpImage(url) || isSuspiciousImage(url)) continue;
    const key = imageKey(url);
    if (!key || gallerySeen.has(key)) continue;
    gallerySeen.add(key);
    trustedGallery.push(url);
  }

  const ordered = [...trustedGallery, ...scoredVerifiedMenuImages(store)];
  const targetCount = Math.min(limit, trustedGallery.length >= 8 ? trustedGallery.length : 8);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of ordered) {
    const url = String(raw || "").trim();
    if (!isHttpImage(url)) continue;
    const key = imageKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
    if (result.length >= targetCount) break;
  }
  return result;
}
export function representativeMenu(store: DiscoveryRestaurant): DiscoveryMenu | undefined {
  const menus = store.menus.filter((menu) => Boolean(menu.nameKo || menu.nameEn || menu.nameJa));
  const currentlyAvailable = menus.filter((menu) => !/(시즌아웃|판매종료|시즌종료|품절|단종)/.test(menu.nameKo));
  const isCafe = /(카페|커피|디저트|베이커리|제과)/i.test(store.category);
  const food = isCafe ? currentlyAvailable : currentlyAvailable.filter((menu) =>
    !/(막걸리|소주|맥주|하이볼|칵테일|위스키|사케|와인|콜라|사이다|에이드)/i.test(menu.nameKo),
  );
  const candidates = food.length ? food : currentlyAvailable.length ? currentlyAvailable : menus;
  return [...candidates].sort((a, b) => {
    const specialty = Number(b.isSpecialty) - Number(a.isSpecialty);
    if (specialty) return specialty;
    const verifiedImage = Number(b.imageStatus === "verified" && isHttpImage(b.imageUrl) && !isSuspiciousImage(b.imageUrl)) - Number(a.imageStatus === "verified" && isHttpImage(a.imageUrl) && !isSuspiciousImage(a.imageUrl));
    if (verifiedImage) return verifiedImage;
    const priced = Number(b.price > 0) - Number(a.price > 0);
    if (priced) return priced;
    return 0;
  })[0];
}
