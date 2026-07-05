import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { MobileForumThreadPage } from "@/components/mobile/mobile-forum-thread-page";
import {
  getThreadDetail,
  incrementThreadViewCount,
  resolveVideoMetadataMap,
  parseThreadIdFromSlug,
  generateThreadSlug,
} from "@/lib/forum-data";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://yehthatrocks.com";

type ThreadPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: ThreadPageProps): Promise<Metadata> {
  const { slug } = await params;
  const id = parseThreadIdFromSlug(slug);
  if (id === null) return { title: "Thread not found" };

  const detail = await getThreadDetail(id);
  if (!detail) return { title: "Thread not found" };

  const canonicalSlug = detail.thread.slug ?? generateThreadSlug(detail.thread.title, detail.thread.id);
  const canonicalUrl = `${SITE_ORIGIN}/m/forum/thread/${canonicalSlug}`;

  const openingPost = detail.posts[0]?.content ?? "";
  const plainDescription = openingPost
    .replace(/\[video:[\w-]{11}\]/g, "")
    .replace(/\[b\](.*?)\[\/b\]/g, "$1")
    .replace(/\[url=.*?\](.*?)\[\/url\]/g, "$1")
    .replace(/\[quote\].*?\[\/quote\]/gs, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 160);

  const title = detail.thread.title;
  const sectionTitle = detail.thread.sectionTitle;

  return {
    title,
    description: plainDescription || `Forum thread in ${sectionTitle}: ${title}`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description: plainDescription || `Forum thread in ${sectionTitle}: ${title}`,
      type: "article",
      url: canonicalUrl,
      siteName: "Yeh That Rocks",
    },
  };
}

export default async function MobileThreadPage({ params }: ThreadPageProps) {
  const { slug } = await params;
  const id = parseThreadIdFromSlug(slug);

  if (id === null) {
    notFound();
  }

  const authState = await getCurrentAuthenticatedUserAuthState();
  const isAuthenticated = authState.status === "authenticated";
  const threadDetail = await getThreadDetail(id);

  if (!threadDetail) {
    notFound();
  }

  // Redirect to canonical URL if the slug doesn't match
  const canonicalSlug = threadDetail.thread.slug ?? generateThreadSlug(threadDetail.thread.title, threadDetail.thread.id);
  if (slug !== canonicalSlug) {
    redirect(`/m/forum/thread/${canonicalSlug}`);
  }

  // Fire-and-forget view count increment
  incrementThreadViewCount(id).catch(() => {});

  const videoMetadataMap = await resolveVideoMetadataMap(threadDetail.posts);

  return (
    <MobileForumThreadPage
      threadDetail={threadDetail}
      isAuthenticated={isAuthenticated}
      videoMetadataMap={videoMetadataMap}
    />
  );
}
