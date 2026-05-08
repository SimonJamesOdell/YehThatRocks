import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";

const execFileAsync = promisify(execFile);
const SCRIPT_TIMEOUT_MS = Math.max(30_000, Math.min(15 * 60_000, Number(process.env.MAGAZINE_DAILY_TIMEOUT_MS || "480000")));

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

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const scriptPath = resolveScriptPath();

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--count=1"], {
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
      scriptPath,
      result: parsed,
      stderr: stderr || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Magazine generation run failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
