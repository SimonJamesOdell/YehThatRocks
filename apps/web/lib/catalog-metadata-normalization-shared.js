function collapseWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLooseToken(value) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function truncate(value, maxLength) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function scoreLikelyMojibake(value) {
  const markerCount = (value.match(/(?:Ã.|Â.|â.|Ð.|Ñ.|┬.|�)/g) ?? []).length;
  const replacementCount = (value.match(/�/g) ?? []).length;
  const boxDrawingCount = (value.match(/[┬▒░]/g) ?? []).length;
  return markerCount * 3 + replacementCount * 4 + boxDrawingCount * 2;
}

function normalizePossiblyMojibakeText(value) {
  const input = collapseWhitespace(value);
  if (!input) {
    return input;
  }

  const originalScore = scoreLikelyMojibake(input);
  if (originalScore === 0) {
    return input;
  }

  const candidates = new Set();
  const repairedOnce = Buffer.from(input, "latin1").toString("utf8").trim();
  if (repairedOnce && repairedOnce !== input) {
    candidates.add(repairedOnce);
  }

  const repairedTwice = Buffer.from(repairedOnce, "latin1").toString("utf8").trim();
  if (repairedTwice && repairedTwice !== input) {
    candidates.add(repairedTwice);
  }

  let best = input;
  let bestScore = originalScore;

  for (const candidate of candidates) {
    const candidateScore = scoreLikelyMojibake(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return bestScore <= originalScore - 2 ? best : input;
}

function sanitizeMetadataToken(value, maxLength = 255) {
  const normalized = normalizePossiblyMojibakeText(value ?? "");
  if (!normalized) {
    return null;
  }

  const cleaned = collapseWhitespace(normalized);
  if (!cleaned) {
    return null;
  }

  return truncate(cleaned, maxLength);
}

function splitTitle(title) {
  const raw = collapseWhitespace(title);
  if (!raw) {
    return null;
  }

  const separators = [" - ", " – ", " — ", " | "];
  let best = null;

  for (const separator of separators) {
    const idx = raw.indexOf(separator);
    if (idx <= 0) {
      continue;
    }

    if (!best || idx < best.idx) {
      best = { idx, separator };
    }
  }

  if (!best) {
    return null;
  }

  const left = raw.slice(0, best.idx).trim();
  const right = raw.slice(best.idx + best.separator.length).trim();
  if (!left || !right) {
    return null;
  }

  return { left, right };
}

function stripKnownPrefix(text, token) {
  if (!text || !token) {
    return text;
  }

  const textNorm = normalizeLooseToken(text);
  const tokenNorm = normalizeLooseToken(token);
  if (!tokenNorm || !textNorm.startsWith(tokenNorm)) {
    return text;
  }

  const consumed = text.slice(0, token.length);
  if (normalizeLooseToken(consumed) !== tokenNorm) {
    return text;
  }

  return text.slice(consumed.length).trim();
}

function collectBracketTags(text) {
  const tags = [];
  const tagRegex = /(\([^)]*(?:live|official|video|lyrics?|lyric\s+video|remaster(?:ed)?|feat\.?|ft\.?|featuring|cover|remix|acoustic|session|version|edit)[^)]*\)|\[[^\]]*(?:live|official|video|lyrics?|lyric\s+video|remaster(?:ed)?|feat\.?|ft\.?|featuring|cover|remix|acoustic|session|version|edit)[^\]]*\])/gi;

  for (const match of text.matchAll(tagRegex)) {
    const value = collapseWhitespace(match[0]);
    if (value) {
      tags.push(value);
    }
  }

  return tags;
}

function collectInlineFeatureTag(text) {
  const featureRegex = /(?:^|\s)(feat\.?|ft\.?|featuring)\s+[^\[\]()]+$/i;
  const hit = text.match(featureRegex);
  if (!hit) {
    return null;
  }

  return collapseWhitespace(hit[0]);
}

module.exports = {
  collapseWhitespace,
  normalizeLooseToken,
  truncate,
  scoreLikelyMojibake,
  normalizePossiblyMojibakeText,
  sanitizeMetadataToken,
  splitTitle,
  stripKnownPrefix,
  collectBracketTags,
  collectInlineFeatureTag,
};