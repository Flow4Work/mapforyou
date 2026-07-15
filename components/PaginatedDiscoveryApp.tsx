"use client";

import DiscoveryApp from "@/components/DiscoveryApp";
import type { DiscoveryRestaurant } from "@/lib/discovery";

export default function PaginatedDiscoveryApp({
  initialStores,
}: {
  initialStores: DiscoveryRestaurant[];
  initialNextOffset: number | null;
}) {
  return <DiscoveryApp initialStores={initialStores} />;
}
