import PublicDataImageBackfill from "@/components/PublicDataImageBackfill";
import PublicDataTabs from "@/components/PublicDataTabs";

export const metadata = { title: "사진 보강 | MapForYou" };

export default function PublicDataImagesPage() {
  return (
    <>
      <PublicDataTabs active="images" />
      <PublicDataImageBackfill />
    </>
  );
}
