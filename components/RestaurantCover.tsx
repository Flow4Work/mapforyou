import type { DiscoveryRestaurant } from "@/lib/discovery";
import { broadCategory, categoryIcon, categoryLabel, type PublicLanguage } from "@/lib/discovery-ui";

export default function RestaurantCover({
  store,
  language,
  compact = false,
}: {
  store: DiscoveryRestaurant;
  language: PublicLanguage;
  compact?: boolean;
}) {
  const category = broadCategory(store);
  const safeImage = store.imageUrl.replace(/"/g, "%22");
  const style = store.imageUrl
    ? { backgroundImage: `linear-gradient(180deg, rgba(17,25,20,.02), rgba(17,25,20,.58)), url("${safeImage}")` }
    : undefined;

  return (
    <div className={`restaurant-cover cover-${category} ${compact ? "restaurant-cover-compact" : ""}`} style={style}>
      {!store.imageUrl && <span className="restaurant-cover-icon">{categoryIcon(category)}</span>}
      <div className="restaurant-cover-label">
        <span>{categoryLabel(category, language)}</span>
        {!compact && <strong>{store.name}</strong>}
      </div>
    </div>
  );
}
