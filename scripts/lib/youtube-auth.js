"use strict";

/**
 * YouTube OAuth 2.0 authentication helper.
 *
 * Manages OAuth 2.0 credentials for YouTube Data API v3:
 *   - First run: opens a browser for user consent, exchanges code for tokens
 *   - Subsequent runs: uses stored refresh token, auto-refreshes when expired
 *
 * Token storage: logs/youtube-oauth-tokens.json
 *
 * Prerequisites:
 *   1. Create a Google Cloud Project at https://console.cloud.google.com
 *   2. Enable "YouTube Data API v3"
 *   3. Create OAuth 2.0 credentials (Desktop application type)
 *   4. Set the redirect URI to http://localhost:3000/oauth2callback
 *
 * Required env:
 *   YOUTUBE_CLIENT_ID — OAuth 2.0 client ID
 *   YOUTUBE_CLIENT_SECRET — OAuth 2.0 client secret
 *   YOUTUBE_REDIRECT_URI — redirect URI (default: http://localhost:3000/oauth2callback)
 *
 * Usage:
 *   const { getYouTubeClient } = require("./lib/youtube-auth");
 *   const youtube = await getYouTubeClient();
 *   // youtube is an authenticated google.youtube('v3') instance
 *
 * Phase 4.2 — YouTube Shorts pipeline (TRAFFIC_ROADMAP.md)
 */

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { google } = require("googleapis");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN_PATH = path.resolve(
  process.cwd(),
  process.env.YOUTUBE_TOKEN_PATH || "logs/youtube-oauth-tokens.json",
);
const DEFAULT_REDIRECT_URI = "http://localhost:3000/oauth2callback";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(TOKEN_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.refresh_token === "string" &&
      parsed.refresh_token.length > 0
    ) {
      return {
        refresh_token: parsed.refresh_token,
        access_token: typeof parsed.access_token === "string" ? parsed.access_token : null,
        expiry_date: typeof parsed.expiry_date === "number" ? parsed.expiry_date : null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify(
      {
        refresh_token: tokens.refresh_token || null,
        access_token: tokens.access_token || null,
        expiry_date: tokens.expiry_date || null,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

// ---------------------------------------------------------------------------
// OAuth 2.0 flow
// ---------------------------------------------------------------------------

/**
 * Run the browser-based OAuth consent flow.
 * Opens a local HTTP server on a random port, generates the consent URL,
 * and waits for the redirect with the authorization code.
 */
function runConsentFlow(oauth2Client) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let port;

    server.on("error", (err) => {
      server.close();
      reject(new Error(`Failed to start OAuth callback server: ${err.message}`));
    });

    // Listen on an ephemeral port
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      const redirectUri = `http://localhost:${port}/oauth2callback`;
      oauth2Client.redirectUri = redirectUri;

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent",
      });

      console.log("[youtube-auth] ═══════════════════════════════════════════════");
      console.log("[youtube-auth] Open this URL in your browser to authorize:");
      console.log("[youtube-auth]");
      console.log(`[youtube-auth] ${authUrl}`);
      console.log("[youtube-auth]");
      console.log("[youtube-auth] Waiting for authorization...");
      console.log("[youtube-auth] ═══════════════════════════════════════════════");
    });

    server.on("request", async (req, res) => {
      const requestUrl = new URL(req.url, `http://localhost:${port}`);

      if (requestUrl.pathname === "/oauth2callback") {
        const code = requestUrl.searchParams.get("code");
        const error = requestUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Authorization failed</h1><p>Error: " + error + "</p><p>You can close this window.</p>");
          server.close();
          reject(new Error(`OAuth authorization error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Authorization failed</h1><p>No authorization code received.</p><p>You can close this window.</p>");
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        try {
          const { tokens } = await oauth2Client.getToken(code);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Authorization successful!</h1><p>You can close this window and return to your terminal.</p>");
          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("<h1>Token exchange failed</h1><p>" + err.message + "</p>");
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get an authenticated google.youtube('v3') client.
 *
 * On first run, opens a browser for OAuth consent and stores the refresh token.
 * On subsequent runs, uses the stored refresh token.
 *
 * Set YOUTUBE_FORCE_AUTH=1 to re-run the consent flow even if tokens exist.
 *
 * @returns {Promise<object>} Authenticated YouTube API client
 */
async function getYouTubeClient() {
  const clientId = (process.env.YOUTUBE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || "").trim();

  if (!clientId) {
    throw new Error("YOUTUBE_CLIENT_ID is required. Create OAuth credentials at https://console.cloud.google.com");
  }
  if (!clientSecret) {
    throw new Error("YOUTUBE_CLIENT_SECRET is required.");
  }

  const redirectUri = (process.env.YOUTUBE_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim();

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const forceAuth = process.env.YOUTUBE_FORCE_AUTH === "1";
  const storedTokens = !forceAuth ? readTokens() : null;

  if (storedTokens && storedTokens.refresh_token) {
    oauth2Client.setCredentials({
      refresh_token: storedTokens.refresh_token,
      access_token: storedTokens.access_token || undefined,
      expiry_date: storedTokens.expiry_date || undefined,
    });

    // Set up auto-refresh listener
    oauth2Client.on("tokens", (newTokens) => {
      if (newTokens.refresh_token) {
        storedTokens.refresh_token = newTokens.refresh_token;
      }
      if (newTokens.access_token) {
        storedTokens.access_token = newTokens.access_token;
      }
      if (newTokens.expiry_date) {
        storedTokens.expiry_date = newTokens.expiry_date;
      }
      writeTokens(storedTokens);
    });

    console.log("[youtube-auth] Using stored OAuth credentials.");

    return google.youtube({ version: "v3", auth: oauth2Client });
  }

  // Run consent flow
  console.log("[youtube-auth] No valid stored credentials. Starting OAuth consent flow...");
  const tokens = await runConsentFlow(oauth2Client);

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received. Try revoking access at https://myaccount.google.com/permissions " +
        "and re-run with YOUTUBE_FORCE_AUTH=1.",
    );
  }

  oauth2Client.setCredentials(tokens);
  writeTokens({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token || null,
    expiry_date: tokens.expiry_date || null,
  });

  oauth2Client.on("tokens", (newTokens) => {
    const current = readTokens() || {};
    if (newTokens.refresh_token) current.refresh_token = newTokens.refresh_token;
    if (newTokens.access_token) current.access_token = newTokens.access_token;
    if (newTokens.expiry_date) current.expiry_date = newTokens.expiry_date;
    writeTokens(current);
  });

  console.log("[youtube-auth] OAuth consent complete. Tokens stored.");

  return google.youtube({ version: "v3", auth: oauth2Client });
}

/**
 * Revoke stored tokens and remove the token file.
 * Useful for switching accounts or debugging auth issues.
 */
function revokeTokens() {
  const tokens = readTokens();
  if (tokens && tokens.refresh_token) {
    const oauth2Client = new google.auth.OAuth2(
      (process.env.YOUTUBE_CLIENT_ID || "").trim(),
      (process.env.YOUTUBE_CLIENT_SECRET || "").trim(),
      (process.env.YOUTUBE_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim(),
    );
    oauth2Client.revokeToken(tokens.refresh_token).catch(() => {});
  }

  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }

  console.log("[youtube-auth] Tokens revoked and removed.");
}

module.exports = {
  getYouTubeClient,
  revokeTokens,
  SCOPES,
  TOKEN_PATH,
};
