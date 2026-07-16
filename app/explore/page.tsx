import AnalyticsTracker from "@/components/AnalyticsTracker";
import DetailPanelScrollReset from "@/components/DetailPanelScrollReset";
import DiscoveryApp from "@/components/DiscoveryApp";
import { loadDiscoveryRestaurants } from "@/lib/discovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "お店を探す | MapForYou",
  description: "ソウルのお店と日本語・英語メニューを地図から探せます。",
};

export default async function ExplorePage() {
  const stores = await loadDiscoveryRestaurants(1000);
  return (
    <>
      <AnalyticsTracker />
      <DetailPanelScrollReset />
      <DiscoveryApp initialStores={stores} />
    </>
  );
}
