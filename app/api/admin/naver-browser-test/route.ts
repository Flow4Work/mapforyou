import { POST as runInstagramBatch } from "@/app/api/public-data/instagram/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const region = incoming.searchParams.get("region") || "seongsu";
  const internalUrl = new URL("/api/public-data/instagram", request.url);
  const internalRequest = new Request(internalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "scan", region, limit: 1, retry: false }),
  });
  return runInstagramBatch(internalRequest);
}
