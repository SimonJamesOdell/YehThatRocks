import { z } from "zod";
import { VIDEO_QUALITY_FLAG_REASONS } from "@/lib/video-quality-flags";
import { SEARCH_FLAG_REASONS } from "@/lib/search-flags";

export const favouriteMutationSchema = z.object({
  videoId: z.string().min(1),
  action: z.enum(["add", "remove"])
});

export const createPlaylistSchema = z.object({
  name: z.string().min(2).max(80),
  videoIds: z.array(z.string().min(1)).max(50).optional().default([])
});

export const addPlaylistItemSchema = z.object({
  videoId: z.string().min(1)
});

export const addPlaylistItemsBulkSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(5000),
});

export const removePlaylistItemSchema = z.object({
  playlistItemIndex: z.number().int().min(0).optional(),
  playlistItemId: z.string().min(1).optional(),
}).refine((value) => value.playlistItemId || value.playlistItemIndex !== undefined, {
  message: "playlistItemId or playlistItemIndex is required",
});

export const reorderPlaylistItemsSchema = z.object({
  fromIndex: z.number().int().min(0).optional(),
  toIndex: z.number().int().min(0).optional(),
  fromPlaylistItemId: z.string().min(1).optional(),
  toPlaylistItemId: z.string().min(1).optional(),
}).refine(
  (value) => (
    (value.fromPlaylistItemId && value.toPlaylistItemId)
    || (value.fromIndex !== undefined && value.toIndex !== undefined)
  ),
  { message: "from/to playlist item ids or indexes are required" },
);

export const renamePlaylistSchema = z.object({
  name: z.string().min(2).max(80),
});

export const registerSchema = z.object({
  email: z.email().max(255),
  screenName: z.string().trim().min(2).max(40),
  password: z.string().min(8).max(128),
  remember: z.boolean().optional().default(false),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(128),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(512),
  password: z.string().min(8).max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(512),
});

export const upgradeToEmailSchema = z.object({
  email: z.email().max(255),
});

export const watchHistoryEventSchema = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/),
  reason: z.enum(["qualified", "ended"]).default("qualified"),
  positionSec: z.number().min(0).max(86_400).optional().default(0),
  durationSec: z.number().min(0).max(86_400).optional().default(0),
  progressPercent: z.number().min(0).max(100).optional().default(0),
});

export const hiddenVideoMutationSchema = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/),
});

export const videoQualityFlagSchema = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/),
  reason: z.enum(VIDEO_QUALITY_FLAG_REASONS),
});

export const searchFlagSchema = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/),
  query: z.string().trim().min(1).max(255),
  reason: z.enum(SEARCH_FLAG_REASONS),
  correction: z.string().trim().max(255).optional(),
}).superRefine((value, ctx) => {
  if ((value.reason === "wrong-artist" || value.reason === "wrong-trackname") && value.correction && value.correction.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correction"],
      message: "Correction must not be empty when provided",
    });
  }
});

export const seenTogglePreferenceKeySchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^ytr-toggle-hide-seen-[A-Za-z0-9:_-]+$/);

export const seenTogglePreferenceMutationSchema = z.object({
  key: seenTogglePreferenceKeySchema,
  value: z.boolean(),
});

export const playerPreferenceMutationSchema = z.object({
  autoplayEnabled: z.boolean().optional(),
  volume: z.number().int().min(0).max(100).optional(),
}).refine((value) => value.autoplayEnabled !== undefined || value.volume !== undefined, {
  message: "autoplayEnabled or volume is required",
});
