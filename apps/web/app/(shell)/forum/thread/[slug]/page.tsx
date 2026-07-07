import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { ForumThreadContent } from "@/components/forum-thread-content";
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
  const canonicalUrl = `${SITE_ORIGIN}/forum/thread/${canonicalSlug}`;

  // Extract a plain-text description from the first 160 chars of the opening post
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

  // Build a safe share image from thread videos when available
  const shareImage = detail.thread.video1Id
    ? `https://i.ytimg.com/vi/${encodeURIComponent(detail.thread.video1Id)}/hqdefault.jpg`
    : detail.thread.video2Id
      ? `https://i.ytimg.com/vi/${encodeURIComponent(detail.thread.video2Id)}/hqdefault.jpg`
      : `${SITE_ORIGIN}/images/guitar_back.png`;
  const shareImageAlt = detail.thread.video1Id ? detail.thread.title : "YehThatRocks forum artwork";

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
      images: detail.thread.video1Id || detail.thread.video2Id ? [{ url: shareImage, width: 480, height: 360, alt: shareImageAlt }] : [{ url: shareImage, alt: shareImageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: plainDescription || `Forum thread in ${sectionTitle}: ${title}`,
      images: [shareImage],
    },
  };
}

export default async function ThreadPage({ params }: ThreadPageProps) {
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
    redirect(`/forum/thread/${canonicalSlug}`);
  }

  // Fire-and-forget view count increment
  incrementThreadViewCount(id).catch(() => {});

  const videoMetadataMap = await resolveVideoMetadataMap(threadDetail.posts);

  // Build structured data for DiscussionForumPosting
  const canonicalUrl = `${SITE_ORIGIN}/forum/thread/${canonicalSlug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: threadDetail.thread.title,
    url: canonicalUrl,
    datePublished: threadDetail.thread.createdAt.toISOString(),
    author: {
      "@type": "Person",
      name: threadDetail.thread.userScreenName,
      url: `${SITE_ORIGIN}/u/${encodeURIComponent(threadDetail.thread.userScreenName)}`,
    },
    commentCount: threadDetail.posts.length,
    text: threadDetail.posts[0]?.content?.replace(/\[video:[\w-]{11}\]/g, "").slice(0, 200) ?? "",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <ForumThreadContent
        threadDetail={threadDetail}
        isAuthenticated={isAuthenticated}
        videoMetadataMap={videoMetadataMap}
      />
    </>
  );
}