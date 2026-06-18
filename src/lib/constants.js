// KALA — app constants (life areas, tabs, seasons, relations, wrapped themes, prompts)

export const AREAS = [
  { key: "career", label: "Career", color: "#8A4A2C" },
  { key: "wealth", label: "Wealth", color: "#B86E2E" },
  { key: "health", label: "Health", color: "#5C6B47" },
  { key: "relationships", label: "Relationships", color: "#A86A8E" },
  { key: "legacy", label: "Legacy", color: "#4A6A7A" },
];


export const PRIMARY_TABS = [
  { key: "life", label: "Life" },
  { key: "reflect", label: "Reflect" },
  { key: "architect", label: "Plans" },
  { key: "simulate", label: "Simulate" },
];
export const SECONDARY_TABS = [
  { key: "calendar", label: "Calendar", desc: "Your month at a glance" },
  { key: "countdown", label: "Countdown", desc: "Count down to what matters" },
  { key: "future", label: "Future Me", desc: "Write a letter to your future self" },
  { key: "people", label: "Time With", desc: "The moments you have left together" },
  { key: "family", label: "Family Tree", desc: "Your lineage, generation by generation" },
  { key: "memory", label: "Memory Timeline", desc: "Mark the moments that shaped you" },
  { key: "diary", label: "Diary", desc: "Write this week's page" },
  { key: "wrapped", label: "Wrapped", desc: "Your year, shareable" },
  { key: "settings", label: "Settings", desc: "Profile, appearance, language" },
];

// Single source of truth for every tab the app can show. The main menu (the
// top tab bar) is user-customizable, so we look tabs up by key from here
// rather than relying on the primary/secondary split above.
export const TAB_META = {
  life: { label: "Life", desc: "Your life in weeks" },
  reflect: { label: "Reflect", desc: "This week's check-in" },
  architect: { label: "Plans", desc: "Design your roadmap" },
  simulate: { label: "Simulate", desc: "Explore possible futures" },
  calendar: { label: "Calendar", desc: "Your month at a glance" },
  countdown: { label: "Countdown", desc: "Count down to what matters" },
  future: { label: "Future Me", desc: "Write a letter to your future self" },
  people: { label: "Time With", desc: "The moments you have left together" },
  family: { label: "Family Tree", desc: "Your lineage, generation by generation" },
  memory: { label: "Memory Timeline", desc: "Mark the moments that shaped you" },
  diary: { label: "Diary", desc: "Write this week's page" },
  wrapped: { label: "Wrapped", desc: "Your year, shareable" },
  settings: { label: "Settings", desc: "Profile, appearance, language" },
};

// Tabs the user can pin to / unpin from the top bar. `settings` is always
// reachable from the side drawer, so it's intentionally not customizable.
export const CUSTOMIZABLE_TABS = [
  "life", "reflect", "architect", "simulate",
  "calendar", "countdown", "future", "people", "family", "memory", "diary", "wrapped",
];
// What the top bar shows until the user changes it.
export const DEFAULT_NAV = ["life", "reflect", "architect", "simulate"];

// Keep a navTabs array valid: known keys only, de-duped, never empty.
export function sanitizeNav(nav) {
  const seen = new Set();
  const clean = (Array.isArray(nav) ? nav : []).filter(
    (k) => CUSTOMIZABLE_TABS.includes(k) && !seen.has(k) && seen.add(k)
  );
  return clean.length ? clean : [...DEFAULT_NAV];
}

export const LIFE_SEASONS = [
  { from: 0, to: 18, label: "Childhood", tint: "rgba(122,147,89,0.10)" },
  { from: 18, to: 30, label: "Becoming", tint: "rgba(184,110,46,0.09)" },
  { from: 30, to: 45, label: "Building", tint: "rgba(138,74,44,0.08)" },
  { from: 45, to: 65, label: "Mastery", tint: "rgba(74,106,122,0.08)" },
  { from: 65, to: 200, label: "Harvest", tint: "rgba(168,106,142,0.08)" },
];


export const RELATIONS = [
  { key: "parent", label: "Parent", defaultExp: 80, icon: "❀" },
  { key: "child", label: "Child", defaultExp: 85, icon: "✿" },
  { key: "partner", label: "Partner", defaultExp: 82, icon: "♥" },
  { key: "friend", label: "Friend", defaultExp: 82, icon: "✦" },
  { key: "sibling", label: "Sibling", defaultExp: 82, icon: "❖" },
  { key: "grandparent", label: "Grandparent", defaultExp: 88, icon: "❀" },
  { key: "other", label: "Someone", defaultExp: 82, icon: "○" },
];

// ---- Family Tree ----------------------------------------------------------
// Roles a family member can hold. The role drives the icon, a sensible default
// life expectancy, and how the member maps onto a "Time With" card. Lineage
// itself is defined by parent links (member.parents[]), not by the role — so
// "where someone descends from" is always explicit and never guessed.
export const FAMILY_ROLES = [
  { key: "self",        label: "You",         icon: "◈", defaultExp: 73, timeWith: null },
  { key: "partner",     label: "Partner",     icon: "♥", defaultExp: 82, timeWith: "partner" },
  { key: "parent",      label: "Parent",      icon: "❀", defaultExp: 80, timeWith: "parent" },
  { key: "child",       label: "Child",       icon: "✿", defaultExp: 85, timeWith: "child" },
  { key: "sibling",     label: "Sibling",     icon: "❖", defaultExp: 82, timeWith: "sibling" },
  { key: "grandparent", label: "Grandparent", icon: "❀", defaultExp: 88, timeWith: "grandparent" },
  { key: "grandchild",  label: "Grandchild",  icon: "✿", defaultExp: 86, timeWith: "other" },
  { key: "other",       label: "Relative",    icon: "○", defaultExp: 80, timeWith: "other" },
];

export function familyRole(key) {
  return FAMILY_ROLES.find((r) => r.key === key) || FAMILY_ROLES[FAMILY_ROLES.length - 1];
}

// Couples — two people are a "couple" (kept side by side, joined by a marriage
// bar, sharing a generation) when they're explicitly partnered OR when they're
// both parents of the same child. Returns a map: member id -> couple-group root.
export function coupleRoots(members) {
  const idSet = new Set(members.map((m) => m.id));
  const uf = {};
  members.forEach((m) => { uf[m.id] = m.id; });
  const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const union = (a, b) => {
    if (uf[a] == null || uf[b] == null) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) uf[ra] = rb;
  };
  // explicit partners
  members.forEach((m) => (m.partners || []).forEach((p) => { if (idSet.has(p)) union(m.id, p); }));
  // co-parents of the same child
  members.forEach((c) => {
    const ps = (c.parents || []).filter((p) => idSet.has(p));
    for (let i = 1; i < ps.length; i++) union(ps[0], ps[i]);
  });
  const root = {};
  members.forEach((m) => { root[m.id] = find(m.id); });
  return root;
}

// Generation of every member, derived from the relationships themselves: a
// parent is always exactly one row above their child, and partners share a row.
// Because levels are relative (not "distance from the topmost person"), a
// great-grandparent lands one row above the grandparent — even if the other
// side of the family has no ancestors recorded that far back.
export function computeGenerations(members) {
  const idSet = new Set(members.map((m) => m.id));
  const adj = {};
  members.forEach((m) => { adj[m.id] = []; });
  const edge = (a, b, off) => {
    if (!idSet.has(a) || !idSet.has(b) || a === b) return;
    adj[a].push({ to: b, off });
    adj[b].push({ to: a, off: -off });
  };
  members.forEach((c) => {
    const ps = (c.parents || []).filter((p) => idSet.has(p));
    ps.forEach((p) => edge(p, c.id, 1));      // parent sits one row above child
    for (let i = 0; i < ps.length; i++)        // co-parents share a row
      for (let j = i + 1; j < ps.length; j++) edge(ps[i], ps[j], 0);
  });
  members.forEach((m) => (m.partners || []).forEach((p) => edge(m.id, p, 0)));

  const level = {};
  members.forEach((m) => {
    if (level[m.id] != null) return;
    level[m.id] = 0;
    const queue = [m.id];
    while (queue.length) {
      const cur = queue.shift();
      adj[cur].forEach(({ to, off }) => {
        if (level[to] == null) { level[to] = level[cur] + off; queue.push(to); }
      });
    }
  });
  const min = members.length ? Math.min(...members.map((m) => level[m.id] ?? 0)) : 0;
  const out = {};
  members.forEach((m) => { out[m.id] = (level[m.id] ?? 0) - min; });
  return out;
}

// Build the rows of the tree the way a genealogy chart reads:
//   Father  Mother          (a couple, side by side)
//      └──┬──┘
//        Child              (their child, centred below)
//         │
//      Grandchild
//
// Couples are kept adjacent; each generation is ordered so couples/people sit
// under their own parents, which keeps the descent lines short and uncrossed.
const minBirth = (group) => Math.min(...group.map((m) => m.birthYear || 9999));

export function layoutGenerations(members) {
  const levels = computeGenerations(members);
  const root = coupleRoots(members);
  const maxLevel = members.length ? Math.max(...members.map((m) => levels[m.id] ?? 0)) : -1;
  const orderIndex = {}; // member id -> horizontal slot within its own row
  const rows = [];

  for (let l = 0; l <= maxLevel; l++) {
    const rowMembers = members.filter((m) => (levels[m.id] ?? 0) === l);

    // group this row's people into couple units
    const unitsById = {};
    rowMembers.forEach((m) => { (unitsById[root[m.id]] = unitsById[root[m.id]] || []).push(m); });
    const units = Object.values(unitsById);
    units.forEach((u) => u.sort((a, b) => (a.birthYear || 9999) - (b.birthYear || 9999)));

    // order units under their parents (generation 0 just by age)
    const unitKey = (u) => {
      if (l === 0) return minBirth(u);
      let sum = 0, cnt = 0;
      u.forEach((m) => (m.parents || []).forEach((p) => {
        if (orderIndex[p] != null) { sum += orderIndex[p]; cnt++; }
      }));
      return cnt ? sum / cnt : Number.POSITIVE_INFINITY;
    };
    units.sort((a, b) => {
      const ka = unitKey(a), kb = unitKey(b);
      if (ka !== kb) return ka - kb;
      return minBirth(a) - minBirth(b);
    });

    const row = units.flat();
    row.forEach((m, i) => { orderIndex[m.id] = i; });
    rows.push(row);
  }
  return { rows, levels };
}

// Turn the ordered rows into actual x/y coordinates. Leaves (the lowest
// descendants) are spaced out left→right; every ancestor is then centred over
// its own children — so a grandparent sits directly above the parent they had,
// not floating between two in-laws. Returns pixel positions per member.
export function computeTreeLayout(members, opts = {}) {
  const NODE_W = opts.nodeW ?? 138;
  const NODE_H = opts.nodeH ?? 98;
  const V_GAP = opts.vGap ?? 58;
  const COUPLE_GAP = opts.coupleGap ?? 14;
  const UNIT_GAP = opts.unitGap ?? 30;
  const MARGIN = opts.margin ?? 16;

  const { rows, levels } = layoutGenerations(members);
  const root = coupleRoots(members);
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));

  // rebuild couple units from the ordered rows (couple members are adjacent)
  const units = [];
  const memIdx = {};
  const unitOf = {};
  rows.forEach((row, lvl) => {
    let current = null;
    row.forEach((m) => {
      if (!current || root[current.members[0]] !== root[m.id]) {
        current = { id: "u" + units.length, level: lvl, members: [], center: 0 };
        units.push(current);
      }
      memIdx[m.id] = current.members.length;
      current.members.push(m.id);
      unitOf[m.id] = current;
    });
  });

  const unitW = (u) => u.members.length * NODE_W + (u.members.length - 1) * COUPLE_GAP;
  units.forEach((u) => { u.half = unitW(u) / 2; });
  const maxLevel = units.reduce((mx, u) => Math.max(mx, u.level), 0);
  const byLevel = [];
  for (let l = 0; l <= maxLevel; l++) byLevel.push(units.filter((u) => u.level === l));

  const memberX = (id) => {
    const u = unitOf[id];
    return u.center - unitW(u) / 2 + NODE_W / 2 + memIdx[id] * (NODE_W + COUPLE_GAP);
  };

  // each unit's children (members whose parents fall inside the unit)
  const childMembersOf = {};
  units.forEach((u) => {
    const set = new Set(u.members);
    childMembersOf[u.id] = members
      .filter((m) => (m.parents || []).some((p) => set.has(p)))
      .map((m) => m.id);
  });

  // initial spread, left to right, per level
  byLevel.forEach((row) => {
    let cursor = MARGIN;
    row.forEach((u) => { u.center = cursor + u.half; cursor += unitW(u) + UNIT_GAP; });
  });

  const resolveRow = (row) => {
    const sorted = [...row].sort((a, b) => a.center - b.center);
    for (let i = 1; i < sorted.length; i++) {
      const min = sorted[i - 1].center + sorted[i - 1].half + UNIT_GAP + sorted[i].half;
      if (sorted[i].center < min) sorted[i].center = min;
    }
  };

  // centre each ancestor over its children (bottom-up); a couple of sweeps
  for (let pass = 0; pass < 3; pass++) {
    for (let l = maxLevel - 1; l >= 0; l--) {
      byLevel[l].forEach((u) => {
        const kids = childMembersOf[u.id];
        if (kids.length) u.center = kids.reduce((s, id) => s + memberX(id), 0) / kids.length;
      });
      resolveRow(byLevel[l]);
    }
  }

  // normalise so the leftmost node starts at the margin
  const positions = {};
  members.forEach((m) => { if (unitOf[m.id]) positions[m.id] = { x: memberX(m.id), y: 0 }; });
  const xs = Object.values(positions).map((p) => p.x);
  const shift = xs.length ? MARGIN + NODE_W / 2 - Math.min(...xs) : 0;
  let width = MARGIN, height = MARGIN;
  members.forEach((m) => {
    const p = positions[m.id];
    if (!p) return;
    p.x += shift;
    p.y = MARGIN + (levels[m.id] ?? 0) * (NODE_H + V_GAP);
    width = Math.max(width, p.x + NODE_W / 2 + MARGIN);
    height = Math.max(height, p.y + NODE_H + MARGIN);
  });

  return { positions, width, height, nodeW: NODE_W, nodeH: NODE_H, levels };
}

export const WEEKLY_PROMPTS = [
  "What's one small thing you want to be true by next week?",
  "What mattered most to you this week?",
  "Who do you want to give more time to right now?",
  "What's one thing you'd regret not starting?",
  "What drained you this week — and what filled you up?",
  "If this week had a title, what would it be?",
  "What's one brave thing you could do this week?",
  "What are you quietly proud of lately?",
  "What would make next week feel well-spent?",
  "What's something you keep putting off that matters?",
  "Where did you feel most like yourself this week?",
  "What's one kindness you could offer — to someone, or to you?",
];
export function weekPromptIndex() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const wk = Math.floor((now - start) / (1000 * 60 * 60 * 24 * 7));
  return wk % WEEKLY_PROMPTS.length;
}

export const WRAPPED_THEMES = [
  { key: "ember",   label: "Ember",     grad: ["#2E2018", "#43301F", "#8A4A2C"], accent: "#E0A45C", text: "#F4ECDD", soft: "rgba(244,236,221,.62)" },
  { key: "midnight",label: "Midnight",  grad: ["#10131C", "#1B2440", "#2E4374"], accent: "#8FB4FF", text: "#EAF0FF", soft: "rgba(234,240,255,.58)" },
  { key: "rose",    label: "Rosewood",  grad: ["#2A151D", "#4A2435", "#8E4F5E"], accent: "#E9A6BC", text: "#F8E9EE", soft: "rgba(248,233,238,.6)" },
  { key: "forest",  label: "Forest",    grad: ["#13201A", "#1E3A2C", "#3E6B4F"], accent: "#9FD9A8", text: "#E8F4EC", soft: "rgba(232,244,236,.58)" },
  { key: "tide",    label: "Deep Tide", grad: ["#0E1A1F", "#163039", "#2E5868"], accent: "#7FD0E0", text: "#E2F2F6", soft: "rgba(226,242,246,.6)" },
  { key: "plum",    label: "Plum",      grad: ["#1C1426", "#34204A", "#5A3B7A"], accent: "#C9A6E9", text: "#F0E9F8", soft: "rgba(240,233,248,.58)" },
  { key: "sand",    label: "Sand",      grad: ["#4A3B2A", "#7A6347", "#C2A47E"], accent: "#FFF1D8", text: "#2E2018", soft: "rgba(46,32,24,.6)", lightText: true },
  { key: "mono",    label: "Ink",       grad: ["#1A1A18", "#2C2C28", "#4A4A45"], accent: "#D8D8D2", text: "#F2F2EE", soft: "rgba(242,242,238,.55)" },
  { key: "sunset",  label: "Sunset",    grad: ["#2A1620", "#6E2C3E", "#C25E4A"], accent: "#FFC98E", text: "#FCEBE0", soft: "rgba(252,235,224,.6)" },
  { key: "aurora",  label: "Aurora",    grad: ["#10201E", "#1B4038", "#3E7A6B"], accent: "#B9F0C8", text: "#E6F6EF", soft: "rgba(230,246,239,.58)" },
];

// Headline variants — {name} replaced. Two-line: [line1, line2(emphasis)]
export const WRAPPED_HEADLINES = [
  ["{name} year,", "in weeks."],
  ["The shape of", "{name} year."],
  ["{name} life,", "so far."],
  ["Every week", "counted."],
  ["This is", "{name} time."],
];
export const WRAPPED_CAPTIONS = [
  "like Spotify Wrapped, but for your life.",
  "every box is a week you've lived.",
  "a year, measured in weeks.",
  "time, made visible.",
  "the weeks that made this year.",
];

// Reflective quotes — optional, shown on the Wrapped card and shuffled.
export const WRAPPED_QUOTES = [
  "How we spend our days is how we spend our lives.",
  "Time is the coin of your life. Spend it wisely.",
  "Don't count the weeks — make the weeks count.",
  "The trouble is, you think you have time.",
  "It is not that we have a short life, but that we waste much of it.",
  "Yesterday is gone. Tomorrow is not yet. We have only today.",
  "Lost time is never found again.",
  "Begin doing what you want to do now. The clock is ticking.",
];

