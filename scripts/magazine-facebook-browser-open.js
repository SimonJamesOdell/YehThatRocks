#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ARGS = new Set(process.argv.slice(2));

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));
  loadEnvFile(path.join(cwd, ".env.production"));
  loadEnvFile(path.join(cwd, ".env.production.local"));
}

function resolveHomePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function normalizeTargetUrl(input) {
  const normalized = String(input || "").trim() || "https://www.facebook.com/YehThatRocks";

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Invalid Facebook target URL: ${normalized}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "www.facebook.com" && hostname !== "facebook.com" && hostname !== "m.facebook.com") {
    throw new Error(`Target must be a Facebook URL: ${normalized}`);
  }

  return normalized;
}

async function resolveLatestMagazineUrl(appUrl) {
  const response = await fetch(`${appUrl}/api/magazine/latest?limit=1`);
  if (!response.ok) {
    throw new Error(`Failed to fetch latest magazine article (${response.status})`);
  }

  const payload = await response.json();
  const article = Array.isArray(payload?.articles) ? payload.articles[0] : null;
  if (!article || !article.slug) {
    throw new Error("Latest magazine article response did not include a slug");
  }

  return `${appUrl}/magazine/${article.slug}`;
}

async function clickWhatsOnYourMind(page) {
  const result = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const spans = Array.from(document.querySelectorAll("span"));
    const label = spans.find((span) => normalizeText(span.textContent) === "What's on your mind?" && isVisible(span));
    if (!(label instanceof HTMLElement)) {
      return { clicked: false, reason: "label-not-found" };
    }

    let button = label.closest('[role="button"]');
    if (!(button instanceof HTMLElement)) {
      let current = label.parentElement;
      while (current) {
        if (current.getAttribute("role") === "button" || current.tabIndex >= 0) {
          button = current;
          break;
        }
        current = current.parentElement;
      }
    }

    if (!(button instanceof HTMLElement) || !isVisible(button)) {
      return { clicked: false, reason: "button-not-found" };
    }

    button.click();
    return {
      clicked: true,
      buttonTag: button.tagName,
      buttonRole: button.getAttribute("role") || "",
      buttonText: normalizeText(button.textContent).slice(0, 120),
    };
  });

  if (!result.clicked) {
    throw new Error(`Could not click What's on your mind? (${result.reason})`);
  }

  return result;
}

async function pasteUrlAtCurrentFocus(page, url) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: page.url() }).catch(() => {});
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, url);
  await page.keyboard.press("Control+V");
  return { pasted: true, url };
}

async function clickNextButton(page) {
  const result = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const buttons = Array.from(document.querySelectorAll('[role="button"]'));
    const ariaMatch = buttons.find((button) => {
      if (!(button instanceof HTMLElement) || !isVisible(button)) {
        return false;
      }

      return normalizeText(button.getAttribute("aria-label")) === "Next";
    });

    if (ariaMatch instanceof HTMLElement) {
      ariaMatch.click();
      return {
        clicked: true,
        match: "aria-label",
        text: normalizeText(ariaMatch.textContent).slice(0, 120),
      };
    }

    const spans = Array.from(document.querySelectorAll("span"));
    const label = spans.find((span) => normalizeText(span.textContent) === "Next" && isVisible(span));
    if (!(label instanceof HTMLElement)) {
      return { clicked: false, reason: "next-label-not-found" };
    }

    const button = label.closest('[role="button"]');
    if (!(button instanceof HTMLElement) || !isVisible(button)) {
      return { clicked: false, reason: "next-button-not-found" };
    }

    button.click();
    return {
      clicked: true,
      match: "text",
      text: normalizeText(button.textContent).slice(0, 120),
    };
  });

  if (!result.clicked) {
    throw new Error(`Could not click Next (${result.reason})`);
  }

  return result;
}

async function clickPostButton(page) {
  const result = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/gu, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const buttons = Array.from(document.querySelectorAll('[role="button"]'));
    const ariaMatch = buttons.find((button) => {
      if (!(button instanceof HTMLElement) || !isVisible(button)) {
        return false;
      }

      return normalizeText(button.getAttribute("aria-label")) === "Post";
    });

    if (ariaMatch instanceof HTMLElement) {
      ariaMatch.click();
      return {
        clicked: true,
        match: "aria-label",
        text: normalizeText(ariaMatch.textContent).slice(0, 120),
      };
    }

    const spans = Array.from(document.querySelectorAll("span"));
    const label = spans.find((span) => normalizeText(span.textContent) === "Post" && isVisible(span));
    if (!(label instanceof HTMLElement)) {
      return { clicked: false, reason: "post-label-not-found" };
    }

    const button = label.closest('[role="button"]');
    if (!(button instanceof HTMLElement) || !isVisible(button)) {
      return { clicked: false, reason: "post-button-not-found" };
    }

    button.click();
    return {
      clicked: true,
      match: "text",
      text: normalizeText(button.textContent).slice(0, 120),
    };
  });

  if (!result.clicked) {
    throw new Error(`Could not click Post (${result.reason})`);
  }

  return result;
}

async function main() {
  loadEnv();

  const runOnce = ARGS.has("--run-once") || toBool(process.env.MAGAZINE_BROWSER_RUN_ONCE, false);

  const targetUrl = normalizeTargetUrl(
    process.env.MAGAZINE_BROWSER_TARGET_URL ||
      process.env.MAGAZINE_BROWSER_POST_GROUP_URL ||
      "https://www.facebook.com/YehThatRocks",
  );
  const appUrl = String(process.env.APP_URL || "https://yehthatrocks.com").replace(/\/+$/u, "");
  const pasteUrl = String(process.env.MAGAZINE_BROWSER_PASTE_URL || (await resolveLatestMagazineUrl(appUrl))).trim();
  const profileDir = path.resolve(
    process.env.MAGAZINE_BROWSER_POST_PROFILE_DIR ||
      resolveHomePath(".local", "share", "yehthatrocks", "facebook-magazine-browser-profile"),
  );

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });

  const closeBrowser = async () => {
    await context.close().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", closeBrowser);
  process.on("SIGTERM", closeBrowser);

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);
  const scrollResult = await page.evaluate(() => {
    const isScrollable = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return /(auto|scroll)/u.test(style.overflowY) && element.scrollHeight > element.clientHeight + 20;
    };

    let element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    while (element) {
      if (isScrollable(element)) {
        const before = element.scrollTop;
        element.scrollTop += 1200;
        return {
          mode: "element",
          before,
          after: element.scrollTop,
          tagName: element.tagName,
          className: element.className || "",
        };
      }

      element = element.parentElement;
    }

    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    const before = scrollingElement ? scrollingElement.scrollTop : window.scrollY;
    window.scrollBy(0, 1200);
    const after = scrollingElement ? scrollingElement.scrollTop : window.scrollY;
    return { mode: "window", before, after };
  });
  await page.waitForTimeout(1000);
  const clickResult = await clickWhatsOnYourMind(page);
  await page.waitForTimeout(1000);
  const pasteResult = await pasteUrlAtCurrentFocus(page, pasteUrl);
  await page.waitForTimeout(5000);
  const nextResult = await clickNextButton(page);
  await page.waitForTimeout(2000);
  const postResult = await clickPostButton(page);

  console.log(`[launcher] Browser opened at ${targetUrl}`);
  console.log(`[launcher] Scroll result: ${JSON.stringify(scrollResult)}`);
  console.log(`[launcher] Click result: ${JSON.stringify(clickResult)}`);
  console.log(`[launcher] Paste result: ${JSON.stringify(pasteResult)}`);
  console.log(`[launcher] Next result: ${JSON.stringify(nextResult)}`);
  console.log(`[launcher] Post result: ${JSON.stringify(postResult)}`);
  if (runOnce) {
    console.log("[launcher] Run-once mode complete. Exiting.");
    await context.close().catch(() => {});
    return;
  }

  console.log("[launcher] Waiting for further instructions. Press Ctrl+C to close.");

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});