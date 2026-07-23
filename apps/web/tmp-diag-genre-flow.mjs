// Simulate the exact data pipeline
const selectedGenres = new Set([
  "Rock & Alternative",
  "Punk & Hardcore",
  "Heavy Metal",
  "Progressive Metal",
  "Power Metal",
  "Thrash / Speed Metal"
]);
const genreArray = Array.from(selectedGenres);
const stored = JSON.stringify(genreArray);
console.log("Step 1 - Stored:", stored);

const parsed = JSON.parse(stored);
const normalized = parsed
  .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
  .map((entry) => entry.trim());
console.log("Step 2 - readGenrePreferences:", JSON.stringify(normalized));

// Simulate normalizeNewVideoGenreFilters (simplified - just lowercasing)
const result = normalized
  .map((value) => {
    if (typeof value !== "string") return "";
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue) return "";
    return normalizedValue;
  })
  .filter((value) => value.length > 0);
const includeGenres = [...new Set(result)];
console.log("Step 3 - includeGenres:", JSON.stringify(includeGenres));
console.log("Step 4 - length:", includeGenres.length);
