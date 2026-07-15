import AnalyticsTracker from "@/components/AnalyticsTracker";
import DetailPanelScrollReset from "@/components/DetailPanelScrollReset";
import PaginatedDiscoveryApp from "@/components/PaginatedDiscoveryApp";
import { loadDiscoveryRestaurantPage } from "@/lib/discovery";

export const revalidate = 300;

export default async function HomePage() {
  const page = await loadDiscoveryRestaurantPage();
  return (
    <>
      <AnalyticsTracker />
      <DetailPanelScrollReset />
      <PaginatedDiscoveryApp initialStores={page.stores} initialNextOffset={page.nextOffset} />
    </>
  );
}
