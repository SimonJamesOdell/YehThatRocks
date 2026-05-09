import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

type MagazineDeleteRouteContext = {
  params: Promise<{ slug: string }>;
};

const patchSchema = z.object({
  title: z.string().trim().min(1).max(400).optional(),
  deck: z.string().trim().max(5000).nullable().optional(),
  bodyText: z.string().trim().min(1).max(60_000).optional(),
});

type MagazineBodyBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "quote"; text: string; attribution?: string };

function blocksToText(bodyRaw: string): string {
  try {
    const parsed = JSON.parse(bodyRaw) as MagazineBodyBlock[];
    if (!Array.isArray(parsed)) {
      return bodyRaw;
    }

    return parsed
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }

        if (block.type === "h2") {
          return `## ${block.text ?? ""}`.trim();
        }

        if (block.type === "quote") {
          const quoteText = block.text ?? "";
          const attribution = block.attribution ? `\n— ${block.attribution}` : "";
          return `> ${quoteText}${attribution}`.trim();
        }

        return String(block.text ?? "").trim();
      })
      .filter((chunk) => chunk.length > 0)
      .join("\n\n");
  } catch {
    return bodyRaw;
  }
}

function textToBlocks(bodyText: string): MagazineBodyBlock[] {
  const chunks = bodyText
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return [{ type: "p", text: "" }];
  }

  return chunks.map((chunk) => {
    if (chunk.startsWith("## ")) {
      return { type: "h2", text: chunk.slice(3).trim() };
    }

    if (chunk.startsWith(">")) {
      const quoteLines = chunk
        .split("\n")
        .map((line) => line.replace(/^>\s?/, "").trim())
        .filter(Boolean);
      const attributionLineIndex = quoteLines.findIndex((line) => line.startsWith("— "));

      if (attributionLineIndex >= 0) {
        const quoteText = quoteLines.slice(0, attributionLineIndex).join(" ").trim();
        const attribution = quoteLines[attributionLineIndex].slice(2).trim();
        return {
          type: "quote",
          text: quoteText,
          ...(attribution ? { attribution } : {}),
        };
      }

      return {
        type: "quote",
        text: quoteLines.join(" ").trim(),
      };
    }

    return { type: "p", text: chunk };
  });
}

export async function GET(request: NextRequest, context: MagazineDeleteRouteContext) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { slug } = await context.params;
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const article = await prisma.magazineArticle.findUnique({
    where: { slug: normalizedSlug },
  });

  if (!article) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    article: {
      slug: article.slug,
      title: article.title,
      deck: article.deck,
      bodyText: blocksToText(article.body),
      updatedAt: article.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(request: NextRequest, context: MagazineDeleteRouteContext) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { slug } = await context.params;
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const patch = parsed.data;
  const updateData: {
    title?: string;
    deck?: string | null;
    body?: string;
  } = {};

  if (patch.title !== undefined) {
    updateData.title = patch.title;
  }

  if (patch.deck !== undefined) {
    updateData.deck = patch.deck;
  }

  if (patch.bodyText !== undefined) {
    updateData.body = JSON.stringify(textToBlocks(patch.bodyText));
  }

  const updated = await prisma.magazineArticle.updateMany({
    where: { slug: normalizedSlug },
    data: updateData,
  });

  if (updated.count === 0) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, slug: normalizedSlug });
}

export async function DELETE(request: NextRequest, context: MagazineDeleteRouteContext) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { slug } = await context.params;
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const deleted = await prisma.magazineArticle.deleteMany({
    where: { slug: normalizedSlug },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: deleted.count, slug: normalizedSlug });
}
