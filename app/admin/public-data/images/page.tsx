import PublicDataImageBackfill from "@/components/PublicDataImageBackfill";
import PublicDataTabs from "@/components/PublicDataTabs";
import TourApiImageBackfill from "@/components/TourApiImageBackfill";

export const metadata = { title: "사진 보강 | MapForYou" };

export default function PublicDataImagesPage() {
  return (
    <>
      <PublicDataTabs active="images" />
      <TourApiImageBackfill />
      <PublicDataImageBackfill />
    </>
  );
}
