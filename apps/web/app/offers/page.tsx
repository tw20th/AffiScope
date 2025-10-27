import OfferGallery from "@/components/offers/OfferGallery";
import { getServerSiteId } from "@/lib/site-server";

export default function Page({
  searchParams,
}: {
  searchParams?: { v?: string; limit?: string };
}) {
  const siteId = getServerSiteId();
  const variant =
    (searchParams?.v as "grid" | "list" | "hero" | undefined) ?? "grid";
  const limit = Number(searchParams?.limit ?? 24) || 24;

  return <OfferGallery siteId={siteId} variant={variant} limit={limit} />;
}
