import AnalyticsTracker from "@/components/AnalyticsTracker";
import DetailPanelScrollReset from "@/components/DetailPanelScrollReset";
import PaginatedDiscoveryApp from "@/components/PaginatedDiscoveryApp";
import { loadDiscoveryRestaurantPage } from "@/lib/discovery";

export const revalidate = 300;

const INITIAL_PER_REGION = 12;

export default async function HomePage() {
  const page = await loadDiscoveryRestaurantPage({
    offset: 0,
    perRegion: INITIAL_PER_REGION,
  });

  return (
    <>
      <AnalyticsTracker />
      <DetailPanelScrollReset />
      <PaginatedDiscoveryApp
        initialStores={page.stores}
        initialNextOffset={page.nextOffset}
      />
    </>
  );
}
