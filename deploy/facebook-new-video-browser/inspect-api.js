const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/newest-test.json", "utf8"));
const v = j.videos && j.videos[0];
if (v) {
  console.log("keys:", Object.keys(v).join(", "));
  console.log("videoId:", v.videoId);
  console.log("parsedArtist:", v.parsedArtist);
  console.log("title:", v.title);
  console.log("genre:", v.genre);
} else {
  console.log("NO VIDEOS in response");
}
console.log("count:", j.count);
console.log("ok:", j.ok);
console.log("hasMore:", j.hasMore);
