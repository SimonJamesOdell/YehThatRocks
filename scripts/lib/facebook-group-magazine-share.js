"use strict";

const fs = require("node:fs");
const path = require("node:path");

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return { posted: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      posted: Array.isArray(parsed.posted) ? parsed.posted : [],
    };
  } catch {
    return { posted: [] };
  }
}

function writeState(statePath, state) {
  ensureDirFor(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function buildMessage(article) {
  const artist = String(article.artist || "Unknown artist").trim();
  const track = String(article.track || "Unknown track").trim();
  const genre = String(article.genre || "Rock / Metal").trim();
  const title = String(article.title || "New article").trim();

  return [
    "New YehThatRocks Magazine article is live:",
    title,
    "",
    `Track focus: ${artist} - ${track}`,
    `Genre: ${genre}`,
    "",
    "Read it and tell us what you think.",
  ].join("\n");
}

async function postToFacebookGroup({ groupId, accessToken, link, message }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(groupId)}/feed`;
  const payload = new URLSearchParams();
  payload.set("link", link);
  payload.set("message", message);
  payload.set("access_token", accessToken);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const reason = parsed?.error?.message || text || `facebook-http-${response.status}`;
    throw new Error(reason);
  }

  return {
    id: parsed?.id || null,
    raw: parsed,
  };
}

async function maybeShareMagazineArticle(article) {
  const enabled = toBool(process.env.FB_GROUP_MAGAZINE_AUTOSHARE_ENABLED, false);
  if (!enabled) {
    return { status: "disabled" };
  }

  const appUrl = String(process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (!appUrl) {
    return { status: "skipped", reason: "APP_URL is not set" };
  }

  const slug = String(article.slug || "").trim();
  if (!slug) {
    return { status: "skipped", reason: "missing-article-slug" };
  }

  const statePath = path.resolve(
    process.cwd(),
    String(process.env.FB_GROUP_MAGAZINE_AUTOSHARE_STATE_PATH || "logs/facebook-group-magazine-autoshare-state.json"),
  );
  const state = readState(statePath);
  const alreadyPosted = state.posted.some((entry) => String(entry.slug || "").trim().toLowerCase() === slug.toLowerCase());
  if (alreadyPosted) {
    return { status: "skipped", reason: "already-posted", slug };
  }

  const dryRun = toBool(process.env.FB_GROUP_MAGAZINE_AUTOSHARE_DRY_RUN, true);
  const groupId = String(process.env.FB_GROUP_ID || "").trim();
  const accessToken = String(process.env.FB_GROUP_ACCESS_TOKEN || "").trim();
  const link = `${appUrl}/magazine/${encodeURIComponent(slug)}`;
  const message = buildMessage(article);

  if (dryRun) {
    return {
      status: "dry-run",
      slug,
      link,
      payload: {
        groupId: groupId || "<not-set>",
        message,
      },
    };
  }

  if (!groupId) {
    return { status: "skipped", reason: "FB_GROUP_ID is not set" };
  }
  if (!accessToken) {
    return { status: "skipped", reason: "FB_GROUP_ACCESS_TOKEN is not set" };
  }

  const result = await postToFacebookGroup({
    groupId,
    accessToken,
    link,
    message,
  });

  const postedAt = new Date().toISOString();
  const nextState = {
    posted: [
      ...state.posted,
      {
        slug,
        postedAt,
        link,
        facebookPostId: result.id,
      },
    ].slice(-1000),
  };
  writeState(statePath, nextState);

  return {
    status: "posted",
    slug,
    link,
    facebookPostId: result.id,
  };
}

module.exports = {
  maybeShareMagazineArticle,
};
