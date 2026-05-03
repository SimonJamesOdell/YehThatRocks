import { OverlayLoadingShell } from "@/components/overlay-loading-shell";

export default function ArtistsLoading() {
  return <OverlayLoadingShell breadcrumb="🎸 Artists" message="Loading artists..." />;
}
