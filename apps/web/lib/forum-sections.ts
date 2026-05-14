export type ForumSection = {
  id: string;
  title: string;
  description: string;
};

export const FORUM_SECTIONS: ForumSection[] = [
  {
    id: "new-finds",
    title: "New Finds",
    description: "Share freshly discovered rock and metal videos and explain what hooked you.",
  },
  {
    id: "track-battles",
    title: "Track Battles",
    description: "Put two songs head-to-head and let the community vote and argue their case.",
  },
  {
    id: "deep-cuts",
    title: "Deep Cuts",
    description: "Underrated tracks, B-sides, and hidden gems that deserve way more attention.",
  },
  {
    id: "live-legends",
    title: "Live Legends",
    description: "Best live performances, festival sets, and concert footage worth revisiting.",
  },
  {
    id: "riff-lab",
    title: "Riff Lab",
    description: "Break down riffs, tones, and production details with fellow musicians and fans.",
  },
  {
    id: "requests-recommendations",
    title: "Requests and Recommendations",
    description: "Ask for similar artists, specific moods, or genre paths and get tailored suggestions.",
  },
  {
    id: "site-support",
    title: "Site Support",
    description: "Report bugs, ask account questions, and get help with playback or navigation issues.",
  },
];
