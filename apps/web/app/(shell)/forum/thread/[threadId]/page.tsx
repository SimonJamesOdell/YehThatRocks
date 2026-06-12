import { notFound } from "next/navigation";

import { ForumThreadContent } from "@/components/forum-thread-content";
import { getThreadDetail } from "@/lib/forum-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

type ThreadPageProps = {
  params: Promise<{ threadId: string }>;
};

export async function generateMetadata({ params }: ThreadPageProps) {
  const { threadId } = await params;
  const id = Number(threadId);
  if (!Number.isInteger(id) || id <= 0) return { title: "Thread not found" };
  const detail = await getThreadDetail(id);
  if (!detail) return { title: "Thread not found" };
  return {
    title: detail.thread.title,
    description: `Forum thread in ${detail.thread.sectionTitle}: ${detail.thread.title}`,
  };
}

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { threadId } = await params;
  const id = Number(threadId);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const authState = await getCurrentAuthenticatedUserAuthState();
  const isAuthenticated = authState.status === "authenticated";
  const threadDetail = await getThreadDetail(id);

  if (!threadDetail) {
    notFound();
  }

  return (
    <ForumThreadContent threadDetail={threadDetail} isAuthenticated={isAuthenticated} />
  );
}
