import { notFound } from "next/navigation";
import RestaurantDetail from "@/components/RestaurantDetail";
import { loadDiscoveryRestaurant } from "@/lib/discovery";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await loadDiscoveryRestaurant(id);
  if (!store) return { title: "Restaurant not found | MapForYou" };
  return {
    title: `${store.name} Menu | MapForYou`,
    description: `Translated English and Japanese menu for ${store.name} in Seoul.`,
  };
}

export default async function PublicRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await loadDiscoveryRestaurant(id);
  if (!store) notFound();
  return <RestaurantDetail store={store} />;
}
