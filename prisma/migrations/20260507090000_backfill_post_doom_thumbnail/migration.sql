UPDATE genre_cards gc
LEFT JOIN (
  SELECT v.videoId AS video_id
  FROM videos v
  INNER JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
  WHERE (
    LOWER(COALESCE(v.title, '')) LIKE '%post-doom%'
    OR LOWER(COALESCE(v.title, '')) LIKE '%post doom%'
    OR LOWER(COALESCE(v.description, '')) LIKE '%post-doom%'
    OR LOWER(COALESCE(v.description, '')) LIKE '%post doom%'
  )
  ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC
  LIMIT 1
) candidate ON 1 = 1
SET gc.thumbnail_video_id = candidate.video_id,
    gc.updated_at = NOW(3)
WHERE gc.genre = 'Post-Doom'
  AND candidate.video_id IS NOT NULL
  AND (gc.thumbnail_video_id IS NULL OR TRIM(gc.thumbnail_video_id) = '');
