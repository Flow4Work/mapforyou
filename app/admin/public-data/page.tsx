import PublicDataCollector from "@/components/PublicDataCollector";
import PublicDataImageBackfill from "@/components/PublicDataImageBackfill";
import RedTableTokenSwitcher from "@/components/RedTableTokenSwitcher";

export const metadata = { title: "서울 음식관광 OPEN API | MapForYou" };

export default function PublicDataAdminPage() {
  return (
    <>
      <RedTableTokenSwitcher />
      <PublicDataImageBackfill />
      <PublicDataCollector />
    </>
  );
}
