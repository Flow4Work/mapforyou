import AnalyticsTracker from "@/components/AnalyticsTracker";
import DetailPanelScrollReset from "@/components/DetailPanelScrollReset";
import PaginatedDiscoveryApp from "@/components/PaginatedDiscoveryApp";
import { loadDiscoveryRestaurantPage } from "@/lib/discovery";
import { isDatabaseEgressQuotaError, lastPublishedHomeStores, lastPublishedHomeDate } from "@/lib/public-home-fallback";

export const revalidate = 300;

const INITIAL_PER_REGION = 12;

export default async function HomePage() {
  let page;
  try {
    page = await loadDiscoveryRestaurantPage({
      offset: 0,
      perRegion: INITIAL_PER_REGION,
    });
  } catch (error) {
    if (!isDatabaseEgressQuotaError(error)) throw error;
    console.warn(`Database egress limit reached; serving public homepage snapshot from ${lastPublishedHomeDate}.`);
    page = { stores: lastPublishedHomeStores, nextOffset: null };
  }

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
