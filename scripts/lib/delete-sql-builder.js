"use strict";

function sanitizeSqlString(value) {
  return value.replace(/'/g, "''");
}

function buildDeleteSql(ids, generatedAt, sourceComment) {
  const idRows = ids.map((id) => `('${sanitizeSqlString(id)}')`).join(",\n");
  return `-- Generated at ${generatedAt.toISOString()}\n-- Source: ${sourceComment}\n-- Target count: ${ids.length}\n\nSTART TRANSACTION;\n\nDROP TEMPORARY TABLE IF EXISTS ytr_non_music_targets;\nCREATE TEMPORARY TABLE ytr_non_music_targets (\n  video_id VARCHAR(32) NOT NULL PRIMARY KEY\n);\n\nINSERT INTO ytr_non_music_targets (video_id) VALUES\n${idRows};\n\nSELECT COUNT(*) AS target_count FROM ytr_non_music_targets;\nSELECT COUNT(*) AS videos_found FROM videos v INNER JOIN ytr_non_music_targets t ON t.video_id = v.videoId;\n\n-- Delete dependent rows first to keep referential integrity.\nDELETE sv FROM site_videos sv\nINNER JOIN videos v ON v.id = sv.video_id\nINNER JOIN ytr_non_music_targets t ON t.video_id = v.videoId;\n\nDELETE av FROM videosbyartist av\nINNER JOIN videos v ON v.id = av.video_id\nINNER JOIN ytr_non_music_targets t ON t.video_id = v.videoId;\n\nDELETE pi FROM playlistitems pi\nINNER JOIN videos v ON v.id = pi.video_id\nINNER JOIN ytr_non_music_targets t ON t.video_id = v.videoId;\n\nDELETE f FROM favourites f\nINNER JOIN ytr_non_music_targets t ON t.video_id = f.videoId;\n\nDELETE m FROM messages m\nINNER JOIN ytr_non_music_targets t ON t.video_id = m.video_id;\n\nDELETE r FROM related r\nINNER JOIN ytr_non_music_targets t ON t.video_id = r.videoId OR t.video_id = r.related;\n\nDELETE v FROM videos v\nINNER JOIN ytr_non_music_targets t ON t.video_id = v.videoId;\n\nCOMMIT;\n`;
}

module.exports = {
  sanitizeSqlString,
  buildDeleteSql,
};
