/**
 * Shared HTTP status-code constants.
 *
 * The budget guardrail (scripts/verify-budget-guardrails.js) treats raw
 * `status: 401` / `status: 403` literals in API route handlers as duplication
 * that belongs in one place. Import from here instead of inlining numbers.
 */
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
