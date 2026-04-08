import { redirect } from "next/navigation";

type LegacyArtistRouteProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyArtistRoute({ params, searchParams }: LegacyArtistRouteProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const redirectParams = new URLSearchParams();

  if (resolvedSearchParams) {
    for (const [key, value] of Object.entries(resolvedSearchParams)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            redirectParams.append(key, item);
          }
        }
      } else if (typeof value === "string") {
        redirectParams.set(key, value);
      }
    }
  }

  const target = redirectParams.toString()
    ? `/artist/${encodeURIComponent(slug)}?${redirectParams.toString()}`
    : `/artist/${encodeURIComponent(slug)}`;

  redirect(target);
}
