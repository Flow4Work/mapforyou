import AnalyticsTracker from "@/components/AnalyticsTracker";
import DetailPanelScrollReset from "@/components/DetailPanelScrollReset";
import DiscoveryApp from "@/components/DiscoveryApp";
import { loadDiscoveryRestaurants } from "@/lib/discovery";

export const revalidate = 300;

export default async function HomePage() {
  const stores = await loadDiscoveryRestaurants(1000);
  return (
    <>
      <AnalyticsTracker />
      <DetailPanelScrollReset />
      <DiscoveryApp initialStores={stores} />
    </>
  );
}
