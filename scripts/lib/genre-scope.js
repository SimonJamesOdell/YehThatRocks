"use strict";

const ROCK_METAL_GENRE_PATTERNS = [
  /\brock\b/i,
  /\bmetal\b/i,
  /\bpunk\b/i,
  /\bgrunge\b/i,
  /\bshoegaze\b/i,
  /\bemo\b/i,
  /\bscreamo\b/i,
  /\bhardcore\b/i,
  /\bpost-?hardcore\b/i,
  /\bmetalcore\b/i,
  /\bdeathcore\b/i,
  /\bmathcore\b/i,
  /\bgrindcore\b/i,
  /\bdeath\b/i,
  /\bblack(ened)?\b/i,
  /\bpower\b/i,
  /\bprogressive\b/i,
  /\bprog\b/i,
  /\bsymphonic\b/i,
  /\bheavy\b/i,
  /\bglam\b/i,
  /\bgroove\b/i,
  /\bgrind\b/i,
  /\bgoth(ic)?\b/i,
  /\bindustrial\b/i,
  /\bdjent\b/i,
  /\bnwobhm\b/i,
  /\bstoner\b/i,
  /\bsludge\b/i,
  /\bdoom\b/i,
  /\bthrash\b/i,
];

function normalizeGenreName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function isRockMetalGenre(value) {
  const genre = normalizeGenreName(value);
  if (!genre) {
    return false;
  }
  return ROCK_METAL_GENRE_PATTERNS.some((pattern) => pattern.test(genre));
}

function partitionGenresByScope(values) {
  const seen = new Set();
  const allowed = [];
  const disallowed = [];

  for (const rawValue of values) {
    const genre = normalizeGenreName(rawValue);
    if (!genre) {
      continue;
    }

    const key = genre.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (isRockMetalGenre(genre)) {
      allowed.push(genre);
    } else {
      disallowed.push(genre);
    }
  }

  return { allowed, disallowed };
}

module.exports = {
  isRockMetalGenre,
  normalizeGenreName,
  partitionGenresByScope,
};
