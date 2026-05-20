#!/usr/bin/env node
"use strict";

const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const { chromium } = require("playwright");

const profileDir = path.join(os.homedir(), ".local", "share", "yehthatrocks", "facebook-magazine-browser-profile");
const groupUrl = "https://www.facebook.com/YehThatRocks";

async function waitForEnter(msg) {
  process.stdout.write(msg + "\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question("Press Enter to continue...", resolve));
  rl.close();
}

async function main() {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    console.log("[click-test] Navigating to " + groupUrl);
    await page.goto(groupUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Scroll down slightly to reveal the composer card
    await page.evaluate(() => window.scrollBy(0, 150));
    await page.waitForTimeout(800);

    // Try to find and click the "What's on your mind?" text as a clickable element
    const selectors = [
      'span:text("What\'s on your mind?")',
      'span:has-text("What\'s on your mind?")',
      '[aria-label*="Create a post"]',
      '[aria-label*="What\'s on your mind"]',
      'div[role="button"]:has(span:has-text("What\'s on your mind"))',
      'div[role="complementary"] div[role="button"]',
    ];

    let clicked = false;
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: "visible", timeout: 2000 });
        const box = await el.boundingBox();
        if (box) {
          console.log("[click-test] Found via: " + sel + " at " + JSON.stringify(box));
          await el.click();
          clicked = true;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!clicked) {
      console.log("[click-test] None of the targeted selectors found. Taking screenshot...");
    } else {
      console.log("[click-test] Clicked! Waiting 2s for dialog...");
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: "/tmp/fb-click-test.png" });
    console.log("[click-test] Screenshot saved to /tmp/fb-click-test.png");

    await waitForEnter("[click-test] Browser is held open. Press Enter to close.");
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("[click-test] ERROR:", err.message);
  process.exit(1);
});
