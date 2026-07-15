import FoursquareInstagramFinder from "@/components/NaverInstagramFinder";
import PublicDataTabs from "@/components/PublicDataTabs";

export const metadata = { title: "인스타그램 자동 수집 | MapForYou" };

export default function PublicDataInstagramPage() {
  return (
    <>
      <PublicDataTabs active="instagram" />
      <FoursquareInstagramFinder />
    </>
  );
}
