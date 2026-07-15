import { POST as runNaverPlaceScan } from "@/app/api/public-data/naver-place-scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const internalRequest = new Request(new URL("/api/public-data/naver-place-scan", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: "seongsu", limit: 1, retry: false }),
  });
  return runNaverPlaceScan(internalRequest);
}
