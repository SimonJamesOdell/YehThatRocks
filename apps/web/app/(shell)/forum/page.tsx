import Link from "next/link";

import { OverlayHeader } from "@/components/overlay-header";
import { OverlayScrollReset } from "@/components/overlay-scroll-reset";
import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { getCurrentAuthenticatedUserAuthState } from "@/lib/server-auth";

export const metadata = {
  title: "Forum",
  description: "Community forum for rock and metal discovery, recommendations, and site support.",
};

export default async function ForumPage() {
  const authState = await getCurrentAuthenticatedUserAuthState();
  const isAuthenticated = authState.status === "authenticated";

  return (
    <>
      <OverlayScrollReset />
      <OverlayHeader title="Forum" />

      <main className="forumPage" role="main" aria-label="Forum">
        <section className="forumSectionGrid panel" aria-label="Forum sections">
          {FORUM_SECTIONS.map((section) => (
            <article key={section.id} className="forumOverlayCard">
              <h2>{section.title}</h2>
              <p>{section.description}</p>
            </article>
          ))}
        </section>

        <section className="forumContributePanel panel" aria-label="Start a forum contribution">
          <div className="forumContributeHeader">
            <h2>Start a thread</h2>
            <p>Forum browsing is public. Posting and replies require an account.</p>
          </div>

          {isAuthenticated ? (
            <form className="forumContributeForm">
              <label>
                <span>Thread title</span>
                <input type="text" name="title" placeholder="Thread creation is coming soon" disabled />
              </label>
              <label>
                <span>Opening post</span>
                <textarea rows={5} name="content" placeholder="Posting tools are on the roadmap" disabled />
              </label>
              <button type="submit" disabled>Post thread (coming soon)</button>
            </form>
          ) : (
            <div className="forumAuthGate">
              <p className="authMessage">Sign in to contribute to forum discussions.</p>
              <Link href="/login" className="magazinePrimaryCta">Sign in</Link>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
