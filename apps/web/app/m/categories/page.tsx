"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type GenreCard = {
  slug: string;
  label: string;
  count: number;
};

export default function MobileCategoriesPage() {
  const [categories, setCategories] = useState<GenreCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/categories");
        const data = await res.json();
        if (!cancelled) {
          setCategories(data.categories || []);
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Categories</h1>
        <p className="mobile-page-subtitle">Browse by genre</p>
      </div>

      {loading && (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
        </div>
      )}

      {!loading && categories.length === 0 && (
        <div className="mobile-empty-state">
          <p>No categories available.</p>
        </div>
      )}

      {!loading && categories.length > 0 && (
        <div className="mobile-categories-grid">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/m/categories/${cat.slug}`}
              className="mobile-category-card"
            >
              {cat.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
