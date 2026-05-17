/**
 * Admin Dashboard Type Definitions
 * Centralized types for all admin dashboard domains
 */

// Analytics
export type AnalyticsBucket = {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  pageViews: number;
  videoViews: number;
  uniqueVisitors: number;
  returnVisits: number;
  magazineExternalLandings: number;
  authEvents: number;
};

export type AnalyticsZoomLevel = "allTime" | "monthly" | "weekly" | "daily" | "hourly";

// Dashboard Data Structures
export type DashboardPayload = {
  meta: {
    durationMs: number;
    generatedAt: string;
    rollups?: {
      available: boolean;
      mode: "background";
      message: string | null;
    };
  };
  health: {
    nodeUptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
    host: {
      platform: string;
      loadAvg: number[];
      totalMemMb: number;
      freeMemMb: number;
      cpuUsagePercent: number | null;
      cpuAverageUsagePercent: number | null;
      cpuPeakCoreUsagePercent: number | null;
      memoryUsagePercent: number;
      diskUsagePercent: number | null;
      swapUsagePercent: number | null;
      networkUsagePercent: number | null;
    };
  };
  counts: {
    users: number;
    registeredUsers: number;
    anonymousUsers: number;
    videos: number;
    artists: number;
    categories: number;
  };
  locations: Array<{ location: string; count: number }>;
  traffic: Array<{ day: string; count: number }>;
  analytics: {
    daily: Array<{ day: string; pageViews: number; videoViews: number; uniqueVisitors: number }>;
    hourlyRecent: Array<{
      bucketStart: string;
      pageViews: number;
      videoViews: number;
      uniqueVisitors: number;
      returnVisits: number;
      magazineExternalLandings: number;
      authEvents: number;
    }>;
    series: {
      allTime: AnalyticsBucket[];
      monthly: AnalyticsBucket[];
      weekly: AnalyticsBucket[];
      daily: AnalyticsBucket[];
    };
    newVsRepeat: { newVisitors: number; repeatVisitors: number };
    registrationsPerDay: Array<{ day: string; count: number }>;
    totals: { pageViews: number; videoViews: number; uniqueVisitors: number; sessions: number };

  };
  hostMetrics: {
    minute: Array<{
      bucketStart: string;
      cpuUsagePercent: number | null;
      memoryUsagePercent: number | null;
      swapUsagePercent: number | null;
      diskUsagePercent: number | null;
      networkUsagePercent: number | null;
    }>;
  };
  insights: {
    auth24h: {
      total: number;
      success: number;
      failed: number;
      uniqueIps: number;
      uniqueUsers: number;
    };
    authActionBreakdown: Array<{ action: string; total: number; failed: number }>;
    metadataQuality: {
      availableVideos: number;
      checkFailedEntries: number;
      missingMetadata: number;
      lowConfidence: number;
      unknownType: number;
    };
    ingestVelocity: Array<{ day: string; count: number }>;
    groqSpend: {
      wikiCacheCount: number;
      daily: Array<{ day: string; classified: number; errors: number }>;
    };
    memoryDiagnostics: {
      snapshotAt: string;
      process: {
        rssMb: number;
        heapUsedMb: number;
        heapTotalMb: number;
        externalMb: number;
        arrayBuffersMb: number;
      };
      caches: {
        currentVideo: {
          currentVideoCache: number;
          currentVideoPendingCache: number;
          currentVideoInflight: number;
          currentVideoRelatedPoolCache: number;
          currentVideoRelatedPoolInflight: number;
        };
        artist: {
          limits: { defaultMaxEntries: number; heavyMaxEntries: number };
          sizes: {
            artistNormVideoPoolCache: number;
            artistNormVideoPoolInFlight: number;
            sameGenreRelatedPoolCache: number;
            sameGenreRelatedPoolInFlight: number;
            artistLetterCache: number;
            artistLetterPageCache: number;
            artistSearchCache: number;
            artistSingleSlugCache: number;
            artistVideosCache: number;
            artistVideosInFlight: number;
          };  
        };
        wikiCacheCount: number;
      };
    };
  };
};

export type AdminHealthStreamPayload = {
  health: DashboardPayload["health"];
  meta: { generatedAt: string };
};

// Categories Domain
export type CategoryRow = {
  id: number;
  genre: string;
  thumbnailVideoId: string | null;
  updatedAt: string;
};

// Videos Domain
export type VideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  channelTitle: string | null;
  updatedAt: string | null;
};

export type RecentlyApprovedVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  updatedAt: string | null;
};

export type PendingVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PendingVideoDraft = {
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
};

// Catalog Review Domain
export type CatalogReviewVideoRow = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  enqueuedAt: string | null;
};

// Magazine Domain
export type AdminMagazineArticleRow = {
  slug: string;
  title: string;
  videoId: string | null;
  publishedAt: string;
  externalLandings: number;
};

export type AdminMagazineCommentModerationRow = {
  id: number;
  articleSlug: string;
  userId: number;
  content: string;
  moderationStatus: string;
  moderationLabel: string | null;
  moderationReason: string | null;
  moderationSource: string | null;
  createdAt: string;
  reviewedAt: string | null;
  authorDisplayName: string;
  authorEmail: string | null;
};

export type AdminMagazineCommentModerationAction =
  | "approve"
  | "keep_restricted"
  | "delete_comment"
  | "delete_user";

// Performance Domain
export type PerfWindowResetResponse = {
  ok: boolean;
  startedAt: string;
  deletedSamples: number;
  sampleIntervalSeconds: number;
  slowLog: {
    enabled: boolean;
    warning: string | null;
  };
};

// Tab Routing
export type AdminTab = "overview" | "magazine" | "performance" | "categories" | "videos" | "catalog-review";
