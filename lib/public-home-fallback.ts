import "server-only";
import type { DiscoveryRestaurant } from "@/lib/discovery";
import snapshot from "@/data/public-home-snapshot.json";

// Last-known-good public data, used only if Supabase has suspended API egress.
// Normal requests still use the live database and the existing revalidation path.
export const lastPublishedHomeStores = snapshot.stores as unknown as DiscoveryRestaurant[];
export const lastPublishedHomeDate = snapshot.capturedAt;

export function isDatabaseEgressQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("exceed_egress_quota");
}
