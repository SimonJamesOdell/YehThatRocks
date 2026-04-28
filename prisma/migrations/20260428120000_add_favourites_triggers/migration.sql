-- CreateTrigger to maintain denormalized favourited count automatically
-- This replaces the application-level COUNT(DISTINCT) recount pattern
-- Triggers fire on INSERT/DELETE to favourites table, updating videos.favourited

-- Trigger on INSERT into favourites
CREATE TRIGGER IF NOT EXISTS trg_favourites_insert
AFTER INSERT ON favourites
FOR EACH ROW
BEGIN
  UPDATE videos 
  SET favourited = (SELECT COUNT(DISTINCT userid) FROM favourites WHERE videoId = NEW.videoId)
  WHERE videoId = NEW.videoId;
END;

-- Trigger on DELETE from favourites
CREATE TRIGGER IF NOT EXISTS trg_favourites_delete
AFTER DELETE ON favourites
FOR EACH ROW
BEGIN
  UPDATE videos 
  SET favourited = (SELECT COUNT(DISTINCT userid) FROM favourites WHERE videoId = OLD.videoId)
  WHERE videoId = OLD.videoId;
END;
