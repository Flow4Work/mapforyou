import NaverPlaceInstagramFinderV2 from "@/components/NaverPlaceInstagramFinderV2";
import PublicDataTabs from "@/components/PublicDataTabs";

export const metadata = { title: "네이버 장소 인스타 자동 확인 | MapForYou" };

export default function PublicDataInstagramPage() {
  return (
    <>
      <PublicDataTabs active="instagram" />
      <NaverPlaceInstagramFinderV2 />
    </>
  );
}
