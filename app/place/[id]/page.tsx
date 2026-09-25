import { notFound } from "next/navigation";
import RestaurantDetail from "@/components/RestaurantDetail";
import { loadDiscoveryRestaurant } from "@/lib/discovery";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sourceId = decodeURIComponent(id);
  const store = await loadDiscoveryRestaurant(sourceId);
  if (!store) return { title: "Restaurant not found | MapForYou" };
  return {
    title: `${store.name} Menu | MapForYou`,
    description: store.regionKey === "hongdae" && store.searchKeyword === "전체"
      ? `Archived Mapo-area restaurant data for ${store.name}. Menu translations and listing details may be incomplete.`
      : `Translated English and Japanese menu for ${store.name} in Seoul.`,
  };
}

export default async function PublicRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sourceId = decodeURIComponent(id);
  const store = await loadDiscoveryRestaurant(sourceId);
  if (!store) notFound();
  return <RestaurantDetail store={store} />;
}
