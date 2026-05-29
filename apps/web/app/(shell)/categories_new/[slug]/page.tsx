import { redirect } from "next/navigation";

type CategoryNewPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryNewDetailPage({ params }: CategoryNewPageProps) {
  const { slug } = await params;
  redirect(`/categories/${encodeURIComponent(slug)}`);
}