import { notFound, redirect } from "next/navigation";

import { getThreadDetail, generateThreadSlug } from "@/lib/forum-data";

type ThreadPageProps = {
  params: Promise<{ threadId: string }>;
};

export default async function LegacyThreadPage({ params }: ThreadPageProps) {
  const { threadId } = await params;
  const id = Number(threadId);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const detail = await getThreadDetail(id);
  if (!detail) {
    notFound();
  }

  const slug = detail.thread.slug ?? generateThreadSlug(detail.thread.title, detail.thread.id);
  redirect(`/forum/thread/${slug}`);
}
