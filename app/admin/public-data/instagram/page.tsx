import NaverInstagramFinder from "@/components/NaverInstagramFinder";
import PublicDataTabs from "@/components/PublicDataTabs";

export const metadata = { title: "인스타그램 찾기 | MapForYou" };

export default function PublicDataInstagramPage() {
  return (
    <>
      <PublicDataTabs active="instagram" />
      <NaverInstagramFinder />
    </>
  );
}
