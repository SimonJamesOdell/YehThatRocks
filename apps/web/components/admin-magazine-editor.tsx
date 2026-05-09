"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type AdminMagazineEditorProps = {
  slug: string;
};

type MagazineArticlePayload = {
  slug: string;
  title: string;
  deck: string | null;
  bodyText: string;
  updatedAt: string;
};

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuthRetry(input, init);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export function AdminMagazineEditor({ slug }: AdminMagazineEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [article, setArticle] = useState<MagazineArticlePayload | null>(null);
  const [title, setTitle] = useState("");
  const [deck, setDeck] = useState("");
  const [bodyText, setBodyText] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const payload = await readJson<{ ok: boolean; article: MagazineArticlePayload }>(
          `/api/admin/magazine/${encodeURIComponent(slug)}`,
          {
            cache: "no-store",
            headers: {
              "Cache-Control": "no-store",
            },
          },
        );

        if (cancelled) {
          return;
        }

        setArticle(payload.article);
        setTitle(payload.article.title);
        setDeck(payload.article.deck ?? "");
        setBodyText(payload.article.bodyText ?? "");
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Failed to load article.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const wordCount = useMemo(() => {
    const words = bodyText.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }, [bodyText]);

  const canSave = !saving && title.trim().length > 0 && bodyText.trim().length > 0;

  async function save() {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await readJson<{ ok: boolean }>(`/api/admin/magazine/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          deck: deck.trim() ? deck.trim() : null,
          bodyText,
        }),
      });

      setMessage("Article saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save article.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="authMessage">Loading article editor…</p>;
  }

  return (
    <section className="panel featurePanel">
      <div className="panelHeading">
        <span>Edit Magazine Article</span>
        <strong>{article?.slug ?? slug}</strong>
      </div>

      <div className="interactiveStack">
        {message ? <p className="authMessage">{message}</p> : null}

        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          <span>Deck</span>
          <textarea value={deck} onChange={(event) => setDeck(event.target.value)} rows={3} />
        </label>

        <label>
          <span>Body Text</span>
          <textarea
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            rows={20}
            spellCheck={true}
            style={{ fontFamily: "var(--font-body), sans-serif", lineHeight: 1.45 }}
          />
        </label>

        <p className="authMessage" style={{ margin: 0 }}>
          Word count: {wordCount.toLocaleString()} • Use blank lines to separate paragraphs. Prefix headings with "## ". Prefix quotes with "> ".
        </p>

        <div className="primaryActions compactActions">
          <button type="button" onClick={() => void save()} disabled={!canSave}>
            {saving ? "Saving…" : "Save Article"}
          </button>
        </div>
      </div>
    </section>
  );
}
