const ANONYMOUS_NAME_ADJECTIVES = ["Metal", "Riff", "Steel", "Echo", "Iron", "Shadow", "Loud", "Neon", "Storm", "Night"];
const ANONYMOUS_NAME_NOUNS = ["Wolf", "Rider", "Fury", "Pulse", "Viper", "Flame", "Static", "Blade", "Circuit", "Howl"];

export function buildAnonymousScreenNameSuggestion() {
  const adjective = ANONYMOUS_NAME_ADJECTIVES[Math.floor(Math.random() * ANONYMOUS_NAME_ADJECTIVES.length)] ?? "Metal";
  const noun = ANONYMOUS_NAME_NOUNS[Math.floor(Math.random() * ANONYMOUS_NAME_NOUNS.length)] ?? "Wolf";
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${adjective}${noun}${suffix}`;
}