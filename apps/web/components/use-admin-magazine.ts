/**
 * Magazine Management Hook
 * Handles magazine article CRUD operations
 */

import { useCallback, useState } from "react";
import { AdminMagazineArticleRow } from "@/components/admin-dashboard-types";
import { readJson } from "@/components/admin-dashboard-utils";

export function useAdminMagazine() {
  const [magazineArticles, setMagazineArticles] = useState<AdminMagazineArticleRow[]>([]);
  const [deleteModalSlug, setDeleteModalSlug] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadMagazineArticles = useCallback(async () => {
    try {
      const payload = await readJson<{ articles: AdminMagazineArticleRow[] }>("/api/admin/magazine");
      setMagazineArticles(payload.articles);
    } catch (error) {
      throw error;
    }
  }, []);

  const deleteMagazineArticle = useCallback(
    async (slug: string) => {
      try {
        await readJson(`/api/admin/magazine/${encodeURIComponent(slug)}`, {
          method: "DELETE",
        });
        setSaveMessage(`Deleted magazine article ${slug}.`);
        setDeleteModalSlug(null);
        await loadMagazineArticles();
      } catch (deleteError) {
        setSaveMessage(deleteError instanceof Error ? deleteError.message : "Delete failed.");
        throw deleteError;
      }
    },
    [loadMagazineArticles]
  );

  return {
    // Data
    magazineArticles,
    deleteModalSlug,
    // UI State
    saveMessage,
    // Setters
    setDeleteModalSlug,
    setSaveMessage,
    // Actions
    loadMagazineArticles,
    deleteMagazineArticle,
  };
}
