export type MagazineDraftTrack = {
  slug: string;
  videoId: string;
  title: string;
  artist: string;
  genre: string;
  takeaway: string;
};

export const magazineDraftEdition = {
  slug: "new-heavy-metal-tracks-2026-week-17",
  title: "New Heavy Metal Tracks 2026: Week 17",
  kicker: "Yeh Magazine Draft",
  publishedDate: "April 25, 2026",
  summary:
    "A first-draft editorial edition built to funnel search visitors into the core YehThatRocks watch experience.",
  tracks: [
    {
      slug: "evanescence-bring-me-to-life",
      videoId: "3YxaaGgTQYM",
      title: "Bring Me To Life",
      artist: "Evanescence",
      genre: "Gothic Metal",
      takeaway: "Still one of the cleanest crossover entry points between melodic hooks and heavy rhythm sections.",
    },
    {
      slug: "mastodon-blood-and-thunder",
      videoId: "v-Su1YXQYek",
      title: "Blood and Thunder",
      artist: "Mastodon",
      genre: "Sludge Metal",
      takeaway: "A high-impact riff-forward track that instantly signals the edition's heavier center of gravity.",
    },
    {
      slug: "gojira-stranded",
      videoId: "SU1apJTv94o",
      title: "Stranded",
      artist: "Gojira",
      genre: "Progressive Groove Metal",
      takeaway: "Precision drumming and groove pressure make this a strong bridge from modern metal into deeper catalogs.",
    },
    {
      slug: "killswitch-engage-my-curse",
      videoId: "iPW9AbRMwFU",
      title: "My Curse",
      artist: "Killswitch Engage",
      genre: "Metalcore",
      takeaway: "A concise melodic-metalcore staple that performs well as an onboarding click target.",
    },
  ] satisfies MagazineDraftTrack[],
};

export function getMagazineTrackBySlug(slug: string) {
  return magazineDraftEdition.tracks.find((track) => track.slug === slug) ?? null;
}
