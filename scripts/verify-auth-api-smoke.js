#!/usr/bin/env node
"use strict";

function readArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }

  const value = raw.slice(name.length + 3);
  return value || fallback;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertInvariant(condition, description, details, failures) {
  if (condition) {
    console.log(`[ok] ${description}`);
    return;
  }

  failures.push({ description, details });
  console.error(`[fail] ${description}`);
  if (details) {
    console.error(`       ${details}`);
  }
}

function splitSetCookieHeader(raw) {
  if (!raw) {
    return [];
  }

  const parts = [];
  let current = "";
  let inExpires = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw.slice(i, i + 8).toLowerCase();

    if (next === "expires=") {
      inExpires = true;
    }

    if (ch === "," && !inExpires) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    if (ch === ";") {
      inExpires = false;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  return splitSetCookieHeader(response.headers.get("set-cookie"));
}

function updateCookieJar(cookieJar, setCookies) {
  for (const setCookie of setCookies) {
    const firstPart = setCookie.split(";")[0] || "";
    const separatorIndex = firstPart.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = firstPart.slice(0, separatorIndex).trim();
    const value = firstPart.slice(separatorIndex + 1).trim();

    if (!name) {
      continue;
    }

    if (!value) {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
}

function cookieHeader(cookieJar) {
  const values = [];

  for (const [name, value] of cookieJar.entries()) {
    values.push(`${name}=${value}`);
  }

  return values.join("; ");
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });

    const setCookies = getSetCookies(response);

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload, setCookies };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const baseUrl = readArg("base-url", "http://localhost:3000").replace(/\/$/, "");
  const timeoutMs = Math.max(1200, asNumber(readArg("timeout-ms", "7000"), 7000));
  const authEmail = readArg("email", process.env.AUTH_SMOKE_EMAIL || "");
  const authPassword = readArg("password", process.env.AUTH_SMOKE_PASSWORD || "");
  const failures = [];

  console.log("Auth API smoke checks\n");
  console.log(`baseUrl=${baseUrl} timeoutMs=${timeoutMs} credsProvided=${authEmail && authPassword ? "yes" : "no"}\n`);

  const unauthMe = await fetchJson(`${baseUrl}/api/auth/me`, { method: "GET" }, timeoutMs).catch((error) => ({ error }));
  if (unauthMe?.error) {
    assertInvariant(false, "Unauthenticated /api/auth/me endpoint reachable", String(unauthMe.error), failures);
  } else {
    assertInvariant(
      unauthMe.response.status === 401 || unauthMe.response.status === 403,
      "Unauthenticated /api/auth/me is rejected",
      `status=${unauthMe.response.status}`,
      failures,
    );
  }

  const invalidPayloadLogin = await fetchJson(
    `${baseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: "", password: "", remember: true }),
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (invalidPayloadLogin?.error) {
    assertInvariant(false, "Invalid payload login endpoint reachable", String(invalidPayloadLogin.error), failures);
  } else {
    assertInvariant(
      invalidPayloadLogin.response.status === 400,
      "Invalid payload login returns 400",
      `status=${invalidPayloadLogin.response.status}`,
      failures,
    );
  }

  const wrongCredsLogin = await fetchJson(
    `${baseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ email: "smoke.invalid@example.com", password: "definitely-wrong-password", remember: true }),
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (wrongCredsLogin?.error) {
    assertInvariant(false, "Wrong credentials login endpoint reachable", String(wrongCredsLogin.error), failures);
  } else {
    assertInvariant(
      wrongCredsLogin.response.status === 401,
      "Wrong credentials login returns 401",
      `status=${wrongCredsLogin.response.status}`,
      failures,
    );
  }

  if (!authEmail || !authPassword) {
    console.log("\nAuth credentials were not provided; skipping authenticated login/logout cookie lifecycle checks.");
  } else {
    const cookieJar = new Map();

    const loginResult = await fetchJson(
      `${baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
        body: JSON.stringify({ email: authEmail, password: authPassword, remember: true }),
      },
      timeoutMs,
    ).catch((error) => ({ error }));

    if (loginResult?.error) {
      assertInvariant(false, "Authenticated login endpoint reachable", String(loginResult.error), failures);
    } else {
      assertInvariant(loginResult.response.ok, "Authenticated login returns 2xx", `status=${loginResult.response.status}`, failures);

      const setCookie = loginResult.setCookies.join("\n");
      assertInvariant(
        setCookie.includes("ytr_access=") && setCookie.includes("ytr_refresh="),
        "Authenticated login sets access and refresh cookies",
        "expected ytr_access and ytr_refresh in set-cookie",
        failures,
      );

      updateCookieJar(cookieJar, loginResult.setCookies);
    }

    const meAfterLogin = await fetchJson(
      `${baseUrl}/api/auth/me`,
      {
        method: "GET",
        headers: {
          Cookie: cookieHeader(cookieJar),
        },
      },
      timeoutMs,
    ).catch((error) => ({ error }));

    if (meAfterLogin?.error) {
      assertInvariant(false, "Authenticated /api/auth/me endpoint reachable", String(meAfterLogin.error), failures);
    } else {
      assertInvariant(meAfterLogin.response.ok, "Authenticated /api/auth/me returns 2xx", `status=${meAfterLogin.response.status}`, failures);
      assertInvariant(
        typeof meAfterLogin.payload?.user?.id === "number",
        "Authenticated /api/auth/me includes numeric user.id",
        `user.id=${String(meAfterLogin.payload?.user?.id)}`,
        failures,
      );
    }

    const logoutResult = await fetchJson(
      `${baseUrl}/api/auth/logout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
          Cookie: cookieHeader(cookieJar),
        },
        body: JSON.stringify({}),
      },
      timeoutMs,
    ).catch((error) => ({ error }));

    if (logoutResult?.error) {
      assertInvariant(false, "Authenticated logout endpoint reachable", String(logoutResult.error), failures);
    } else {
      assertInvariant(logoutResult.response.ok, "Authenticated logout returns 2xx", `status=${logoutResult.response.status}`, failures);
      updateCookieJar(cookieJar, logoutResult.setCookies);

      const cookieHeaderAfterLogout = cookieHeader(cookieJar);
      assertInvariant(
        !cookieHeaderAfterLogout.includes("ytr_access=") && !cookieHeaderAfterLogout.includes("ytr_refresh="),
        "Logout clears auth cookies from client jar",
        `remainingCookieHeader=${cookieHeaderAfterLogout || "<empty>"}`,
        failures,
      );
    }

    const meAfterLogout = await fetchJson(
      `${baseUrl}/api/auth/me`,
      {
        method: "GET",
        headers: {
          Cookie: cookieHeader(cookieJar),
        },
      },
      timeoutMs,
    ).catch((error) => ({ error }));

    if (meAfterLogout?.error) {
      assertInvariant(false, "Post-logout /api/auth/me endpoint reachable", String(meAfterLogout.error), failures);
    } else {
      assertInvariant(
        meAfterLogout.response.status === 401 || meAfterLogout.response.status === 403,
        "Post-logout /api/auth/me is rejected",
        `status=${meAfterLogout.response.status}`,
        failures,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`\nAuth API smoke check failed with ${failures.length} issue(s).`);
    process.exit(1);
  }

  console.log("\nAuth API smoke check passed.");
}

main().catch((error) => {
  console.error("Auth API smoke check failed with an unhandled error.", error);
  process.exit(1);
});
