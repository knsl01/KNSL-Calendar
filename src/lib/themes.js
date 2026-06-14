// KALA — theme system. Each theme has a light + dark variant sharing one personality.

export const THEME_DEFS = {
  warm: {
    label: "Warm Paper", mood: "Grounded & calm",
    swatch: ["#F7F1E7", "#8A4A2C", "#B86E2E"],
    light: {
      bg: "#F7F1E7", paper: "#FFFBF4", card: "#FBF5EC",
      clay: "#8A4A2C", amber: "#B86E2E", soil: "#2E2018", soilSoft: "#6B5644",
      line: "#E4D7C2", sage: "#5C6B47", past: "#C2A47E", now: "#8A4A2C", rose: "#A86A8E", blue: "#4A6A7A",
    },
    dark: {
      bg: "#1C1510", paper: "#241B14", card: "#241B14",
      clay: "#C97B4E", amber: "#D98B45", soil: "#F2E8DA", soilSoft: "#B6A593",
      line: "#3A2D22", sage: "#8BA06E", past: "#7A6347", now: "#C97B4E", rose: "#C98BAE", blue: "#7BA0B5",
    },
  },
  sage: {
    label: "Sage Garden", mood: "Fresh & hopeful",
    swatch: ["#EEF1E8", "#4F6B45", "#7A9359"],
    light: {
      bg: "#EEF1E8", paper: "#F8FAF3", card: "#F2F5EC",
      clay: "#4F6B45", amber: "#7A9359", soil: "#27301F", soilSoft: "#5A6B4D",
      line: "#D8E0CC", sage: "#4F6B45", past: "#A9BE94", now: "#4F6B45", rose: "#9E7A8E", blue: "#5A7A78",
    },
    dark: {
      bg: "#161A12", paper: "#1E241A", card: "#1E241A",
      clay: "#8FB06B", amber: "#A6C47F", soil: "#E8EFE0", soilSoft: "#A2B295",
      line: "#2C3526", sage: "#8FB06B", past: "#5E7049", now: "#8FB06B", rose: "#B595A8", blue: "#7BA098",
    },
  },
  dusk: {
    label: "Dusk", mood: "Reflective & soft",
    swatch: ["#F3ECEC", "#8E4F5E", "#B0707E"],
    light: {
      bg: "#F3ECEC", paper: "#FBF6F6", card: "#F6EEEE",
      clay: "#8E4F5E", amber: "#B0707E", soil: "#2E1F23", soilSoft: "#6B5258",
      line: "#E4D2D5", sage: "#6B6B47", past: "#C9A6AE", now: "#8E4F5E", rose: "#8E4F5E", blue: "#5A6A7A",
    },
    dark: {
      bg: "#1E1518", paper: "#271B20", card: "#271B20",
      clay: "#C98BA0", amber: "#D9A0AE", soil: "#F2E2E6", soilSoft: "#B69BA2",
      line: "#3A2A30", sage: "#9BA06E", past: "#7A5A64", now: "#C98BA0", rose: "#C98BA0", blue: "#7B8BA0",
    },
  },
  ocean: {
    label: "Deep Tide", mood: "Cool & contemplative",
    swatch: ["#E9EFF1", "#3D6376", "#5A8299"],
    light: {
      bg: "#E9EFF1", paper: "#F4F8F9", card: "#EDF2F4",
      clay: "#3D6376", amber: "#5A8299", soil: "#1B2A30", soilSoft: "#4A5F68",
      line: "#CCDBE0", sage: "#4F7A6B", past: "#9DB9C4", now: "#3D6376", rose: "#8E6A8A", blue: "#3D6376",
    },
    dark: {
      bg: "#11191D", paper: "#172227", card: "#172227",
      clay: "#6BA0B8", amber: "#85B5CC", soil: "#E0EBF0", soilSoft: "#94AAB2",
      line: "#243239", sage: "#6FA593", past: "#4A6975", now: "#6BA0B8", rose: "#A88AA4", blue: "#6BA0B8",
    },
  },
  mono: {
    label: "Ink", mood: "Minimal & timeless",
    swatch: ["#F2F1EE", "#3A3A38", "#6B6B66"],
    light: {
      bg: "#F2F1EE", paper: "#FAFAF8", card: "#F4F3F0",
      clay: "#3A3A38", amber: "#6B6B66", soil: "#1A1A18", soilSoft: "#5A5A55",
      line: "#DCDBD6", sage: "#5A6B52", past: "#B5B4AE", now: "#3A3A38", rose: "#8A6A78", blue: "#52606B",
    },
    dark: {
      bg: "#161614", paper: "#1E1E1C", card: "#1E1E1C",
      clay: "#C4C4BE", amber: "#9A9A94", soil: "#EDEDE8", soilSoft: "#9A9A94",
      line: "#2C2C28", sage: "#8A9A82", past: "#5A5A55", now: "#C4C4BE", rose: "#B59AA6", blue: "#82909B",
    },
  },
};

export function buildPalette(themeKey, isDark) {
  const def = THEME_DEFS[themeKey] || THEME_DEFS.warm;
  return { ...(isDark ? def.dark : def.light) };
}

