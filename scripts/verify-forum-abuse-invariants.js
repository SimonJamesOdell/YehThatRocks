#!/usr/bin/env node

// Domain: Forum abuse controls (CSRF + rate limiting + content length caps)
// Guards the three forum mutation endpoints against cross-site request forgery,
// spam floods, and unbounded content. The audit found these endpoints had auth
// but no CSRF check, no rate limiting, and no maximum length.

const path = require("node:path");
const {
  readFileStrict,
  mapRelativeFiles,
  assertFilesExist,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  threads: "apps/web/app/api/forum/threads/route.ts",
  vote: "apps/web/app/api/forum/threads/[threadId]/vote/route.ts",
  posts: "apps/web/app/api/forum/threads/[threadId]/posts/route.ts",
});

function main() {
  const failures = [];

  assertFilesExist(files, failures, ROOT);

  const threads = readFileStrict(files.threads, ROOT);
  const vote = readFileStrict(files.vote, ROOT);
  const posts = readFileStrict(files.posts, ROOT);

  // Every mutation endpoint must verify same-origin (CSRF) and rate-limit.
  for (const [name, source] of [
    ["threads", threads],
    ["vote", vote],
    ["posts", posts],
  ]) {
    assertContains(source, "verifySameOrigin", `forum ${name} checks CSRF via verifySameOrigin`, failures);
    assertContains(source, "rateLimitOrResponse", `forum ${name} applies per-IP rate limiting`, failures);
    assertContains(source, "rateLimitSharedOrResponse", `forum ${name} applies per-user rate limiting`, failures);
  }

  // Content length caps.
  assertContains(threads, "Title must be at most 200 characters", "thread title has a 200-char max", failures);
  assertContains(threads, "Content must be at most 10000 characters", "thread content has a 10000-char max", failures);
  assertContains(posts, "Content must be at most 10000 characters", "post content has a 10000-char max", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "\nForum abuse-control invariants FAILED:",
    successMessage: "\nAll forum abuse-control invariants passed.",
  });
}

main();
