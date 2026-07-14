import PublicDataCollector from "@/components/PublicDataCollector";
import PublicDataTabs from "@/components/PublicDataTabs";
import RedTableTokenSwitcher from "@/components/RedTableTokenSwitcher";

export const metadata = { title: "서울 음식관광 OPEN API | MapForYou" };

export default function PublicDataAdminPage() {
  return (
    <>
      <PublicDataTabs active="collect" />
      <RedTableTokenSwitcher />
      <PublicDataCollector />
    </>
  );
}
