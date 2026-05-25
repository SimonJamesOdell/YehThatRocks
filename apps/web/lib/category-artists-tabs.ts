type CategoryArtistTabDefinition = {
  id: string;
  label: string;
  matches: (value: string | null | undefined) => boolean;
};

function hasAny(input: string | null | undefined, patterns: RegExp[]) {
  const value = (input ?? "").toLowerCase();
  if (!value) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

export function buildCategoryArtistTabs(genre: string): CategoryArtistTabDefinition[] {
  switch (genre.trim()) {
    case "Thrash & Power Metal":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "thrash", label: "Thrash", matches: (value) => hasAny(value, [/thrash/i]) },
        { id: "power-speed", label: "Power/Speed", matches: (value) => hasAny(value, [/power/i, /speed/i]) },
        { id: "groove", label: "Groove", matches: (value) => hasAny(value, [/groove/i]) },
      ];
    case "Black and Death Metal":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "black", label: "Black", matches: (value) => hasAny(value, [/black/i]) },
        { id: "death", label: "Death", matches: (value) => hasAny(value, [/death/i]) },
        { id: "grind", label: "Grind", matches: (value) => hasAny(value, [/grind/i]) },
      ];
    case "Doom & Sludge":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "doom", label: "Doom", matches: (value) => hasAny(value, [/doom/i]) },
        { id: "sludge-stoner", label: "Sludge/Stoner", matches: (value) => hasAny(value, [/sludge/i, /stoner/i]) },
        { id: "drone", label: "Drone", matches: (value) => hasAny(value, [/drone/i]) },
      ];
    case "Nu-metal & Metalcore":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "nu-metal", label: "Nu-metal", matches: (value) => hasAny(value, [/nu\s*metal/i]) },
        { id: "metalcore", label: "Metalcore/Deathcore", matches: (value) => hasAny(value, [/metalcore/i, /deathcore/i, /core/i]) },
        { id: "alt-rap", label: "Alt/Rap", matches: (value) => hasAny(value, [/alternative/i, /rap/i]) },
      ];
    case "Progressive & Experimental":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "progressive", label: "Progressive", matches: (value) => hasAny(value, [/progressive/i, /prog\b/i]) },
        { id: "post", label: "Post/Blackgaze", matches: (value) => hasAny(value, [/post/i, /blackgaze/i]) },
        { id: "industrial-tech", label: "Industrial/Tech", matches: (value) => hasAny(value, [/industrial/i, /technical/i, /djent/i, /mathcore/i]) },
      ];
    case "Classic and Symphonic Metal":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "traditional", label: "Traditional", matches: (value) => hasAny(value, [/heavy/i, /nwobhm/i, /traditional/i]) },
        { id: "symphonic", label: "Symphonic", matches: (value) => hasAny(value, [/symphonic/i]) },
        { id: "glam", label: "Glam/Hair", matches: (value) => hasAny(value, [/glam/i, /hair/i]) },
      ];
    case "Punk & Hardcore":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "punk", label: "Punk", matches: (value) => hasAny(value, [/punk/i]) },
        { id: "hardcore", label: "Hardcore", matches: (value) => hasAny(value, [/hardcore/i, /powerviolence/i, /crust/i, /d beat/i]) },
        { id: "emo", label: "Emo/Screamo", matches: (value) => hasAny(value, [/emo/i, /screamo/i]) },
      ];
    case "Rock & Alternative":
      return [
        { id: "all", label: "All", matches: () => true },
        { id: "classic-hard", label: "Classic/Hard", matches: (value) => hasAny(value, [/classic rock/i, /hard rock/i, /heavy rock/i]) },
        { id: "alt-indie", label: "Alt/Indie", matches: (value) => hasAny(value, [/alternative/i, /indie/i, /grunge/i, /shoegaze/i]) },
        { id: "other-rock", label: "Other Rock", matches: (value) => hasAny(value, [/rock/i]) },
      ];
    default:
      return [{ id: "all", label: "All", matches: () => true }];
  }
}

export function resolveCategoryArtistTabById(genre: string, tabId: string) {
  const normalizedTabId = tabId.trim().toLowerCase();
  const tabs = buildCategoryArtistTabs(genre);
  return tabs.find((tab) => tab.id === normalizedTabId) ?? tabs[0] ?? null;
}

export type { CategoryArtistTabDefinition };
