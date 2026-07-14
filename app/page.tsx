import AnalyticsTracker from "@/components/AnalyticsTracker";
import DiscoveryApp from "@/components/DiscoveryApp";
import { loadDiscoveryRestaurants } from "@/lib/discovery";

export const revalidate = 300;

export default async function HomePage() {
  const stores = await loadDiscoveryRestaurants();
  return (
    <>
      <AnalyticsTracker />
      <DiscoveryApp initialStores={stores} />
    </>
  );
}
