import CuratedPlaceBuilder from "@/components/CuratedPlaceBuilder";
import PublicDataTabs from "@/components/PublicDataTabs";

export const metadata = { title: "인기 가게 1곳 완성 | MapForYou" };

export default function CuratedPlacePage() {
  return (
    <>
      <PublicDataTabs active="curate" />
      <CuratedPlaceBuilder />
    </>
  );
}
