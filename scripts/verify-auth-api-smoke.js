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

function buildAnonymousScreenName() {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `smokeanon${suffix}`;
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

  const invalidTokenMe = await fetchJson(
    `${baseUrl}/api/auth/me`,
    {
      method: "GET",
      headers: {
        Cookie: "ytr_access=not-a-real-jwt-token",
      },
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (invalidTokenMe?.error) {
    assertInvariant(false, "Invalid-token /api/auth/me endpoint reachable", String(invalidTokenMe.error), failures);
  } else {
    assertInvariant(
      invalidTokenMe.response.status === 401 || invalidTokenMe.response.status === 403,
      "Invalid-token /api/auth/me is rejected as unauthenticated",
      `status=${invalidTokenMe.response.status}`,
      failures,
    );
  }

  const optionalAuthInvalidTokenSearch = await fetchJson(
    `${baseUrl}/api/search?q=metal`,
    {
      method: "GET",
      headers: {
        Cookie: "ytr_access=not-a-real-jwt-token",
      },
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (optionalAuthInvalidTokenSearch?.error) {
    assertInvariant(false, "Invalid-token optional-auth /api/search endpoint reachable", String(optionalAuthInvalidTokenSearch.error), failures);
  } else {
    assertInvariant(
      optionalAuthInvalidTokenSearch.response.ok,
      "Invalid-token optional-auth /api/search still returns success",
      `status=${optionalAuthInvalidTokenSearch.response.status}`,
      failures,
    );
    assertInvariant(
      typeof optionalAuthInvalidTokenSearch.payload?.query === "string",
      "Invalid-token optional-auth /api/search still returns payload",
      `query=${String(optionalAuthInvalidTokenSearch.payload?.query)}`,
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

  const anonymousCookieJar = new Map();
  const anonymousScreenName = buildAnonymousScreenName();
  const anonymousCreate = await fetchJson(
    `${baseUrl}/api/auth/anonymous`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ screenName: anonymousScreenName }),
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (anonymousCreate?.error) {
    assertInvariant(false, "Anonymous account create endpoint reachable", String(anonymousCreate.error), failures);
  } else {
    assertInvariant(
      anonymousCreate.response.status === 201,
      "Anonymous account create returns 201",
      `status=${anonymousCreate.response.status}`,
      failures,
    );

    const setCookie = anonymousCreate.setCookies.join("\n");
    assertInvariant(
      setCookie.includes("ytr_access=") && setCookie.includes("ytr_refresh="),
      "Anonymous account create sets access and refresh cookies",
      "expected ytr_access and ytr_refresh in set-cookie",
      failures,
    );

    assertInvariant(
      typeof anonymousCreate.payload?.credentials?.username === "string" && anonymousCreate.payload.credentials.username.length > 0,
      "Anonymous account create returns credentials.username",
      `credentials.username=${String(anonymousCreate.payload?.credentials?.username)}`,
      failures,
    );

    assertInvariant(
      typeof anonymousCreate.payload?.credentials?.password === "string" && anonymousCreate.payload.credentials.password.length >= 12,
      "Anonymous account create returns credentials.password",
      `credentials.password.length=${String(anonymousCreate.payload?.credentials?.password?.length)}`,
      failures,
    );

    updateCookieJar(anonymousCookieJar, anonymousCreate.setCookies);
  }

  let anonymousAuthenticated = false;
  const anonymousMe = await fetchJson(
    `${baseUrl}/api/auth/me`,
    {
      method: "GET",
      headers: {
        Cookie: cookieHeader(anonymousCookieJar),
      },
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (anonymousMe?.error) {
    assertInvariant(false, "Anonymous /api/auth/me endpoint reachable", String(anonymousMe.error), failures);
  } else if (anonymousMe.response.ok) {
    anonymousAuthenticated = true;
    assertInvariant(true, "Anonymous /api/auth/me returns 2xx", undefined, failures);
  } else {
    const anonymousUsername = anonymousCreate?.payload?.credentials?.username;
    const anonymousPassword = anonymousCreate?.payload?.credentials?.password;

    if (!anonymousUsername || !anonymousPassword) {
      assertInvariant(
        false,
        "Anonymous flow can establish authenticated session",
        `status=${anonymousMe.response.status}; missing returned credentials for fallback login`,
        failures,
      );
    } else {
      const anonymousLogin = await fetchJson(
        `${baseUrl}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: baseUrl,
          },
          body: JSON.stringify({ email: anonymousUsername, password: anonymousPassword, remember: true }),
        },
        timeoutMs,
      ).catch((error) => ({ error }));

      if (anonymousLogin?.error) {
        assertInvariant(false, "Anonymous fallback login endpoint reachable", String(anonymousLogin.error), failures);
      } else {
        assertInvariant(
          anonymousLogin.response.ok,
          "Anonymous fallback login returns 2xx",
          `status=${anonymousLogin.response.status}`,
          failures,
        );
        updateCookieJar(anonymousCookieJar, anonymousLogin.setCookies);

        const anonymousMeAfterLogin = await fetchJson(
          `${baseUrl}/api/auth/me`,
          {
            method: "GET",
            headers: {
              Cookie: cookieHeader(anonymousCookieJar),
            },
          },
          timeoutMs,
        ).catch((error) => ({ error }));

        if (anonymousMeAfterLogin?.error) {
          assertInvariant(false, "Anonymous post-login /api/auth/me endpoint reachable", String(anonymousMeAfterLogin.error), failures);
        } else {
          anonymousAuthenticated = anonymousMeAfterLogin.response.ok;
          assertInvariant(
            anonymousMeAfterLogin.response.ok,
            "Anonymous flow establishes authenticated session",
            `status=${anonymousMeAfterLogin.response.status}`,
            failures,
          );
        }
      }
    }
  }

  if (!anonymousAuthenticated) {
    assertInvariant(
      false,
      "Anonymous flow authenticated before logout",
      "Anonymous user could not establish authenticated session prior to logout check",
      failures,
    );
  }

  const anonymousLogout = await fetchJson(
    `${baseUrl}/api/auth/logout`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        Cookie: cookieHeader(anonymousCookieJar),
      },
      body: JSON.stringify({}),
    },
    timeoutMs,
  ).catch((error) => ({ error }));

  if (anonymousLogout?.error) {
    assertInvariant(false, "Anonymous logout endpoint reachable", String(anonymousLogout.error), failures);
  } else {
    assertInvariant(anonymousLogout.response.ok, "Anonymous logout returns 2xx", `status=${anonymousLogout.response.status}`, failures);
    updateCookieJar(anonymousCookieJar, anonymousLogout.setCookies);

    const cookieHeaderAfterAnonymousLogout = cookieHeader(anonymousCookieJar);
    assertInvariant(
      !cookieHeaderAfterAnonymousLogout.includes("ytr_access=") && !cookieHeaderAfterAnonymousLogout.includes("ytr_refresh="),
      "Anonymous logout clears auth cookies from client jar",
      `remainingCookieHeader=${cookieHeaderAfterAnonymousLogout || "<empty>"}`,
      failures,
    );
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
