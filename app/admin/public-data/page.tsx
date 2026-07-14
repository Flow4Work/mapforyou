import RedTableConnector from "@/components/RedTableConnector";
import RedTableMenuBrowser from "@/components/RedTableMenuBrowser";

export const metadata = { title: "서울 음식관광 OPEN API | MapForYou" };

export default function PublicDataAdminPage() {
  return (
    <>
      <RedTableConnector />
      <main style={{ maxWidth: 1180, margin: "-60px auto 0", padding: "0 20px 80px" }}>
        <RedTableMenuBrowser />
      </main>
    </>
  );
}
