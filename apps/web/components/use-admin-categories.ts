/**
 * Category Management Hook
 * Handles all category CRUD operations and state
 */

import { useCallback, useState } from "react";
import { CategoryRow } from "@/components/admin-dashboard-types";
import { readJson, patchJson } from "@/components/admin-dashboard-utils";

export function useAdminCategories() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const categoryPayload = await readJson<{ categories: CategoryRow[] }>("/api/admin/categories");
      setCategories(categoryPayload.categories);
    } catch (error) {
      throw error;
    }
  }, []);

  const saveCategory = useCallback(
    async (row: CategoryRow) => {
      try {
        await patchJson("/api/admin/categories", row);
        setSaveMessage(`Saved category ${row.genre}.`);
        await loadCategories();
      } catch (saveError) {
        setSaveMessage(saveError instanceof Error ? saveError.message : "Category save failed.");
        throw saveError;
      }
    },
    [loadCategories]
  );

  return {
    categories,
    saveMessage,
    setSaveMessage,
    loadCategories,
    saveCategory,
  };
}
