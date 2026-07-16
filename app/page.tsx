import AnalyticsTracker from "@/components/AnalyticsTracker";
import DetailPanelScrollReset from "@/components/DetailPanelScrollReset";
import DiscoveryApp from "@/components/DiscoveryApp";
import { loadDiscoveryRestaurants } from "@/lib/discovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const stores = (await loadDiscoveryRestaurants(1000)).filter(
    (store) => store.regionKey === "seongsu",
  );

  return (
    <>
      <AnalyticsTracker />
      <DetailPanelScrollReset />
      <DiscoveryApp initialStores={stores} />
    </>
  );
}
