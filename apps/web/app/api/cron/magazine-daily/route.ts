import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";
const DAILY_COUNT = Math.max(1, Math.min(10, Number(process.env.MAGAZINE_DAILY_COUNT || "3")));
const SCRIPT_TIMEOUT_MS = Math.max(30_000, Math.min(15 * 60_000, Number(process.env.MAGAZINE_DAILY_TIMEOUT_MS || "480000")));

function isCronAuthorized(request: NextRequest): boolean {
  if (!CRON_SECRET) {
    const forwarded = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    const ip = forwarded?.split(",")[0]?.trim() ?? realIp ?? "";
    return ip === "" || ip === "127.0.0.1" || ip === "::1";
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.length > 0 && token === CRON_SECRET;
}

function resolveScriptPath(): string {
  const direct = path.resolve(process.cwd(), "scripts/magazine-news-autogen.js");
  if (existsSync(direct)) {
    return direct;
  }

  const workspaceRoot = path.resolve(process.cwd(), "../../");
  const fallback = path.join(workspaceRoot, "scripts/magazine-news-autogen.js");
  if (existsSync(fallback)) {
    return fallback;
  }

  return direct;
}

const HTTP_UNAUTHORIZED = 401;

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: HTTP_UNAUTHORIZED });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const countParam = Number(request.nextUrl.searchParams.get("count") || String(DAILY_COUNT));
  const count = Math.max(1, Math.min(10, Number.isFinite(countParam) ? countParam : DAILY_COUNT));

  const scriptPath = resolveScriptPath();

  try {
    const args = [scriptPath, `--count=${count}`];
    if (dryRun) {
      args.push("--dry-run");
    }

    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(stdout || "{}");
    } catch {
      parsed = { ok: false, error: "Failed to parse autogen output.", stdout, stderr };
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      count,
      scriptPath,
      result: parsed,
      stderr: stderr || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Magazine daily run failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = POST;
