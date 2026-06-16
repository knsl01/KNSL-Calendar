import React, { useState, useEffect, useRef, useMemo } from "react";
import { THEME_DEFS, buildPalette } from "@/lib/themes";
import { loadState, saveState, clearState, migrateLocalToCloud } from "@/lib/storage";
import { cloudEnabled } from "@/lib/supabase";
import { sendMagicLink, verifyEmailCode, getUser, onAuthChange, signOut } from "@/lib/auth";
import { WEEKS_PER_YEAR, weeksBetween, fmt, currentWeekKey } from "@/lib/helpers";
import {
  AREAS, PRIMARY_TABS, SECONDARY_TABS, LIFE_SEASONS, RELATIONS,
  WEEKLY_PROMPTS, weekPromptIndex,
  WRAPPED_THEMES, WRAPPED_HEADLINES, WRAPPED_CAPTIONS, WRAPPED_QUOTES,
} from "@/lib/constants";
import { I18N, tr } from "@/lib/i18n";

// ============ KALA — runtime palette ============
// `C` is the live palette, swapped at runtime by the ThemeProvider in App.
// It's module-scoped so every component in this file reads the current theme.
let C = buildPalette("warm", false);

const ThemeCtx = React.createContext({ theme: "warm", setTheme: () => {} });



// ---------- helpers ----------


// ---------- fake "AI" roadmap generator (local, deterministic-ish) ----------
// Smart offline roadmap generator — designed to rival an AI by combining
// multiple detected themes, parsing target ages, and spacing milestones sensibly.
const ROADMAP_THEMES = {
  law: {
    match: ["lawyer", "hukum", "law", "advokat", "notaris"],
    steps: [
      [0, "career", "Spesialisasi bidang hukum (corporate/litigasi)"],
      [0, "career", "Persiapan & ambil IELTS/TOEFL"],
      [1, "career", "Naik ke posisi Senior Associate"],
      [2, "career", "LLM / S2 hukum (dalam atau luar negeri)"],
      [4, "career", "Praktik hukum internasional"],
      [8, "legacy", "Dirikan firma / holding sendiri"],
    ],
  },
  startup: {
    match: ["startup", "founder", "bisnis", "company", "usaha", "wirausaha", "ceo"],
    steps: [
      [0, "career", "Validasi ide & riset pasar"],
      [0, "career", "Bangun MVP pertama"],
      [1, "wealth", "Pendanaan awal / bootstrap"],
      [2, "career", "Capai product–market fit"],
      [4, "legacy", "Scale tim & operasi"],
      [7, "wealth", "Ekspansi / pendanaan lanjutan"],
    ],
  },
  medical: {
    match: ["dokter", "doctor", "medical", "perawat", "kedokteran"],
    steps: [
      [0, "career", "Selesaikan pendidikan profesi"],
      [1, "career", "Internship & lisensi praktik"],
      [3, "career", "Ambil spesialisasi"],
      [7, "career", "Praktik mandiri / konsultan"],
      [10, "legacy", "Bangun klinik sendiri"],
    ],
  },
  finance: {
    match: ["nabung", "invest", "financial", "miliar", "kaya", "rich", "finansial", "uang", "duit", "saham"],
    steps: [
      [0, "wealth", "Bangun dana darurat 6 bulan"],
      [1, "wealth", "Mulai investasi rutin & otomatis"],
      [3, "wealth", "Diversifikasi aset (saham/properti)"],
      [6, "wealth", "Capai milestone finansial besar"],
      [10, "legacy", "Passive income stabil"],
    ],
  },
  study: {
    match: ["s2", "s3", "master", "phd", "beasiswa", "kuliah", "study", "sekolah", "llm"],
    steps: [
      [0, "career", "Riset program & syarat beasiswa"],
      [0, "career", "Persiapan bahasa & tes (IELTS/GRE)"],
      [1, "career", "Daftar & lamar beasiswa"],
      [2, "career", "Mulai studi lanjut"],
      [4, "career", "Lulus & terapkan ilmu di karier"],
    ],
  },
  abroad: {
    match: ["luar negeri", "abroad", "whv", "migrasi", "pindah negara", "overseas", "expat", "visa"],
    steps: [
      [0, "career", "Tentukan negara tujuan & syaratnya"],
      [0, "wealth", "Kumpulkan dana keberangkatan"],
      [1, "career", "Urus visa / work holiday"],
      [1, "career", "Berangkat & adaptasi"],
      [3, "wealth", "Stabil secara finansial di sana"],
    ],
  },
  health: {
    match: ["sehat", "fit", "olahraga", "gym", "berat badan", "diet", "lari", "marathon"],
    steps: [
      [0, "health", "Bangun rutinitas olahraga konsisten"],
      [0, "health", "Perbaiki pola makan & tidur"],
      [1, "health", "Capai target kebugaran pertama"],
      [3, "health", "Pertahankan gaya hidup sehat jangka panjang"],
    ],
  },
  family: {
    match: ["nikah", "menikah", "keluarga", "pasangan", "anak", "marry", "family", "rumah"],
    steps: [
      [0, "relationships", "Perkuat hubungan & komunikasi"],
      [1, "wealth", "Siapkan finansial untuk berkeluarga"],
      [2, "relationships", "Menikah / bangun rumah tangga"],
      [4, "relationships", "Bangun keluarga & rumah impian"],
    ],
  },
};

function parseTargetAge(goal) {
  // "sebelum umur 40", "by 35", "di usia 30"
  const m = goal.match(/(?:umur|usia|age|by)\s*(\d{2})/i) || goal.match(/(\d{2})\s*(?:tahun|th|yo)/i);
  return m ? +m[1] : null;
}

// ---- AI ROADMAP via Claude API (graceful fallback handled by caller) ----
async function generateRoadmapAI(goal, currentAge) {
  const year = new Date().getFullYear();
  const sys = `You are KALA's Life Architect. Turn a person's life ambition into a concrete, year-by-year roadmap.
Rules:
- Respond ONLY with a JSON array. No prose, no markdown code fences.
- 5 to 8 milestones, chronological order.
- Each item: {"yearOffset": <int 0-15 years from now>, "area": <"career"|"wealth"|"health"|"relationships"|"legacy">, "title": "<actionable milestone, max 8 words, SAME language as the user's input>"}.
- Be realistic and specific. If a target age is mentioned, pace milestones to reach it.
- The user is ${currentAge} years old. Current year is ${year}.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: sys,
      messages: [{ role: "user", content: goal }],
    }),
  });
  if (!res.ok) throw new Error("api " + res.status);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const clean = text.replace(/```json|```/g, "").trim();
  const arr = JSON.parse(clean);
  if (!Array.isArray(arr)) throw new Error("bad shape");
  const yr = new Date().getFullYear();
  const valid = new Set(["career", "wealth", "health", "relationships", "legacy"]);
  return arr.slice(0, 8).map((it, i) => {
    const off = Math.max(0, Math.min(15, parseInt(it.yearOffset) || 0));
    const area = valid.has(it.area) ? it.area : "career";
    return { id: Date.now() + i, year: yr + off, area,
      title: String(it.title || "").slice(0, 80), age: currentAge + off };
  });
}


function generateRoadmap(goal, currentAge) {
  const g = goal.toLowerCase();
  const startYear = new Date().getFullYear();
  const targetAge = parseTargetAge(g);

  // detect all matching themes (multi-domain)
  const hits = Object.values(ROADMAP_THEMES).filter((t) => t.match.some((w) => g.includes(w)));
  let raw = [];
  if (hits.length === 0) {
    raw = [
      [0, "career", "Bangun skill inti & portofolio"],
      [1, "career", "Naik level / peran lebih besar"],
      [2, "health", "Bangun kebiasaan sehat konsisten"],
      [4, "wealth", "Stabilitas finansial & investasi"],
      [7, "legacy", "Mulai bangun warisan / karya"],
    ];
  } else {
    // merge themes, dedupe by title, keep chronological
    const seen = new Set();
    hits.forEach((t) => t.steps.forEach((s) => {
      if (!seen.has(s[2])) { seen.add(s[2]); raw.push(s); }
    }));
    raw.sort((a, b) => a[0] - b[0]);
  }

  // if a target age is given, stretch/compress the final milestone toward it
  if (targetAge && targetAge > currentAge) {
    const span = targetAge - currentAge;
    const maxOffset = Math.max(...raw.map((s) => s[0])) || 1;
    raw = raw.map((s) => [Math.round((s[0] / maxOffset) * span), s[1], s[2]]);
    // ensure a capstone at the target age
    raw.push([span, "legacy", `Capai tujuan utama di usia ${targetAge}`]);
  }

  return raw.map((s, i) => ({
    id: Date.now() + i, year: startYear + s[0], area: s[1], title: s[2],
    age: currentAge + s[0],
  }));
}

// ================= PERSISTENCE =================


// ================= APP =================
export default function KalaApp() {
  const [stage, setStage] = useState("loading"); // loading | auth | welcome | onboard | reveal | app
  const [account, setAccount] = useState(null);   // { email } when signed in, null = guest
  const [theme, setThemeRaw] = useState("warm");
  const [dark, setDarkRaw] = useState(false);
  const [lang, setLang] = useState("en");          // en | id
  C = buildPalette(theme, dark);
  const setTheme = (t) => { if (THEME_DEFS[t]) { C = buildPalette(t, dark); setThemeRaw(t); } };
  const setDark = (d) => { C = buildPalette(theme, d); setDarkRaw(d); };

  const [profile, setProfile] = useState({
    name: "", birth: "", lifeExp: 73, focus: [], intention: "",
  });
  // Plans: each { id, name, steps:[] }. activePlan = id.
  const [plans, setPlans] = useState([{ id: 1, name: "Plan A", steps: [] }]);
  const [activePlan, setActivePlan] = useState(1);
  const [memories, setMemories] = useState([]);
  const [diary, setDiary] = useState([]);
  // weekly goals: { "2026-W24": [{id,title,area,done}] }
  const [weekly, setWeekly] = useState({});
  const [lastSeenWeek, setLastSeenWeek] = useState(null);
  const [people, setPeople] = useState([]); // [{id,name,relation,theirAge,theirLifeExp,perYear}]
  const [countdowns, setCountdowns] = useState([]); // [{id,title,date}]

  // load once on mount — and react to Supabase sign-in (magic-link return)
  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      // If returning from a magic link, a session now exists.
      const user = cloudEnabled ? await getUser() : null;
      if (user) {
        await migrateLocalToCloud();      // first sign-in: lift local data up
        if (active) setAccount({ email: user.email });
      }
      const saved = await loadState();
      if (!active) return;
      if (saved && saved.profile?.birth) {
        setProfile(saved.profile);
        setPlans(saved.plans?.length ? saved.plans : [{ id: 1, name: "Plan A", steps: [] }]);
        setActivePlan(saved.activePlan || saved.plans?.[0]?.id || 1);
        setMemories(saved.memories || []);
        setDiary(saved.diary || []);
        setWeekly(saved.weekly || {});
        setPeople(saved.people || []);
        setCountdowns(saved.countdowns || []);
        setLastSeenWeek(saved.lastSeenWeek || null);
        if (saved.theme) setTheme(saved.theme);
        if (saved.dark) setDark(saved.dark);
        if (saved.lang) setLang(saved.lang);
        if (saved.account) setAccount(saved.account);
        setStage("app"); // skip onboarding — welcome back
      } else if (user) {
        // Signed in but no saved life yet → start onboarding
        setStage("welcome");
      } else {
        setStage("auth");
      }
    };
    bootstrap();

    // React to auth changes (e.g. magic-link completes in this tab)
    const unsub = onAuthChange(async (user) => {
      if (!active || !user) return;
      await migrateLocalToCloud();
      setAccount({ email: user.email });
      const saved = await loadState();
      if (saved && saved.profile?.birth) {
        setProfile(saved.profile);
        setStage("app");
      } else {
        setStage((s) => (s === "auth" ? "welcome" : s));
      }
    });

    return () => { active = false; unsub(); };
  }, []);

  // autosave (debounced) whenever data changes while in app
  const saveTimer = useRef(null);
  useEffect(() => {
    if (stage !== "app") return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState({ profile, plans, activePlan, memories, diary, weekly, lastSeenWeek, people, countdowns, theme, dark, lang, account });
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [stage, profile, plans, activePlan, memories, diary, weekly, lastSeenWeek, people, countdowns, theme, dark, lang, account]);

  const resetAll = async () => {
    await clearState();
    setProfile({ name: "", birth: "", lifeExp: 73, focus: [], intention: "" });
    setPlans([{ id: 1, name: "Plan A", steps: [] }]);
    setActivePlan(1);
    setMemories([]); setDiary([]); setWeekly({}); setPeople([]); setCountdowns([]);
    setAccount(null);
    setStage("auth");
  };

  // ---- Public share route: #/share?n=Arya&b=1998-03-15&e=73 ----
  const sharePayload = useMemo(() => parseShareHash(), []);
  if (sharePayload) {
    return (
      <ThemeCtx.Provider value={{ theme, setTheme }}>
        <div style={{ background: C.bg, minHeight: "100vh", color: C.soil,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
          <FontLoader />
          <PublicShare payload={sharePayload} />
        </div>
      </ThemeCtx.Provider>
    );
  }

  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
    <div lang={lang === "id" ? "id" : "en"} style={{ background: C.bg, minHeight: "100vh", color: C.soil,
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", transition: "background .4s ease, color .4s ease" }}>
      <FontLoader />
      {stage === "loading" && <LoadingScreen />}
      {stage === "auth" && (
        <AuthScreen
          onGuest={() => setStage("welcome")}
          onSignedIn={(email) => { setAccount({ email }); setStage("welcome"); }}
        />
      )}
      {stage === "welcome" && <Welcome onNext={() => setStage("onboard")} />}
      {stage === "onboard" && (
        <Onboard
          profile={profile}
          setProfile={setProfile}
          onBack={() => setStage("welcome")}
          onDone={() => setStage("reveal")}
        />
      )}
      {stage === "reveal" && (
        <Reveal profile={profile} onDone={() => {
          setStage("app");
          saveState({ profile, plans, activePlan, memories, diary });
        }} />
      )}
      {stage === "app" && (
        <Main profile={profile} setProfile={setProfile}
          plans={plans} setPlans={setPlans} activePlan={activePlan} setActivePlan={setActivePlan}
          memories={memories} setMemories={setMemories}
          diary={diary} setDiary={setDiary}
          weekly={weekly} setWeekly={setWeekly}
          lastSeenWeek={lastSeenWeek} setLastSeenWeek={setLastSeenWeek}
          people={people} setPeople={setPeople}
          countdowns={countdowns} setCountdowns={setCountdowns}
          theme={theme} setTheme={setTheme} dark={dark} setDark={setDark} lang={lang} setLang={setLang}
          onReset={resetAll} />
      )}
    </div>
    </ThemeCtx.Provider>
  );
}

// Parse #/share?n=...&b=...&e=... → { name, birth, lifeExp } or null
function parseShareHash() {
  if (typeof window === "undefined") return null;
  const h = window.location.hash || "";
  if (!h.startsWith("#/share")) return null;
  const q = new URLSearchParams(h.split("?")[1] || "");
  const birth = q.get("b");
  if (!birth) return null;
  return {
    name: q.get("n") || "Someone",
    birth,
    lifeExp: parseInt(q.get("e")) || 73,
  };
}

// ============ KALA AMBIENT PLAYER ============
// Generative ambient music — warm drone + sparse piano notes (Ólafur Arnalds style)
// No external files needed. Runs entirely in the browser via Web Audio API.

// All scales are C-major-pentatonic (C D E G A) in different registers. Major
// pentatonic has no semitone clashes, so every note sits consonantly over the
// C drone — warm and calming rather than tense or melancholic.
const KALA_SCALES = {
  default:  [261.63, 293.66, 329.63, 392.00, 440.00, 523.25],          // C4 pentatonic
  reflect:  [196.00, 220.00, 261.63, 293.66, 329.63],                  // lower, warm
  wrapped:  [196.00, 261.63, 293.66, 329.63, 392.00],                  // mid, rounded
  simulate: [329.63, 392.00, 440.00, 523.25, 587.33, 659.25],          // airy, higher
};

function useKALAAudio() {
  const ctxRef = useRef(null);
  const masterRef = useRef(null);
  const reverbRef = useRef(null);
  const droneRef = useRef([]);
  const timerRef = useRef(null);
  const playingRef = useRef(false);
  const scaleRef = useRef("default");

  const getCtx = () => {
    if (!ctxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;
      // master gain → gentle low-pass → destination.
      // The filter rolls off harsh high harmonics so the pad feels soft.
      masterRef.current = ctx.createGain();
      masterRef.current.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      lp.Q.value = 0.4;
      masterRef.current.connect(lp);
      lp.connect(ctx.destination);
      // lightweight feedback-delay "reverb" (cheap, reliable)
      const delay = ctx.createDelay(2.0);
      delay.delayTime.value = 0.32;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      delay.connect(fb); fb.connect(delay);
      delay.connect(wet); wet.connect(masterRef.current);
      reverbRef.current = delay;
    }
    return ctxRef.current;
  };

  const startDrone = (ctx) => {
    [[130.81, 0], [130.81, 3], [65.41, -2]].forEach(([freq, detune]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.value = 0.05;
      osc.connect(g); g.connect(masterRef.current);
      osc.start();
      droneRef.current.push(osc);
    });
  };

  const playNote = (ctx, freq) => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";                   // purer & softer than triangle
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.14, now + 0.6);  // slow, gentle swell
    env.gain.exponentialRampToValueAtTime(0.0001, now + 5.5); // long, calm decay
    osc.connect(env);
    env.connect(masterRef.current);      // dry
    if (reverbRef.current) env.connect(reverbRef.current); // wet
    osc.start(now);
    osc.stop(now + 5.8);
  };

  const scheduleNotes = (firstImmediate) => {
    if (!playingRef.current) return;
    const ctx = getCtx();
    const scale = KALA_SCALES[scaleRef.current] || KALA_SCALES.default;
    if (firstImmediate || Math.random() > 0.45) {
      const freq = scale[Math.floor(Math.random() * scale.length)];
      const octave = Math.random() > 0.85 ? 2 : 1;
      playNote(ctx, freq * octave);
    }
    const delay = 4000 + Math.random() * 4500;
    timerRef.current = setTimeout(() => scheduleNotes(false), delay);
  };

  const play = (scaleName = "default") => {
    scaleRef.current = scaleName;
    if (playingRef.current) return;
    playingRef.current = true;
    const ctx = getCtx();
    // must resume inside the user gesture
    const begin = () => {
      masterRef.current.gain.cancelScheduledValues(ctx.currentTime);
      masterRef.current.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterRef.current.gain.exponentialRampToValueAtTime(0.42, ctx.currentTime + 3.5);
      if (droneRef.current.length === 0) startDrone(ctx);
      scheduleNotes(true); // play a note immediately so it's audible at once
    };
    if (ctx.state === "suspended") ctx.resume().then(begin);
    else begin();
  };

  const pause = () => {
    playingRef.current = false;
    clearTimeout(timerRef.current);
    if (masterRef.current && ctxRef.current) {
      const ctx = ctxRef.current;
      masterRef.current.gain.cancelScheduledValues(ctx.currentTime);
      masterRef.current.gain.setValueAtTime(masterRef.current.gain.value, ctx.currentTime);
      masterRef.current.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.6);
    }
  };

  const setScale = (name) => { scaleRef.current = name; };
  const isPlaying = () => playingRef.current;

  return { play, pause, setScale, isPlaying };
}

function KALAAudioButton({ audio }) {
  const [on, setOn] = useState(false);
  const toggle = () => {
    if (on) { audio.pause(); setOn(false); }
    else { audio.play(); setOn(true); }
  };
  return (
    <button onClick={toggle} className="kBtn" title={on ? "Pause ambient music" : "Play ambient music"}
      style={{ background: "transparent", border: `1px solid ${on ? C.clay : C.line}`,
        borderRadius: 99, padding: "5px 14px", fontFamily: "inherit", fontSize: 12.5,
        fontWeight: 600, cursor: "pointer", color: on ? C.clay : C.soilSoft,
        display: "flex", alignItems: "center", gap: 7, transition: "all .25s ease" }}>
      <span style={{ fontSize: 14 }}>{on ? "♫" : "♩"}</span>
      {on ? "Playing" : "Ambient"}
    </button>
  );
}

// ============ KALA AMBIENT PLAYER END ============

// ============ AUTH (UI ready; wire to Supabase later) ============
function AuthScreen({ onGuest, onSignedIn }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState("");
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  // Supabase email OTP length is configurable (6–10 digits), so accept any
  // length in that range rather than hard-coding 6 — otherwise an 8-digit
  // code from the email can't be entered.
  const codeValid = /^\d{6,10}$/.test(code.trim());

  const signIn = async () => {
    if (!valid) return;
    setErr("");
    // If cloud isn't configured yet, behave like a local sign-in (no email step).
    if (!cloudEnabled) {
      onSignedIn(email.trim());
      return;
    }
    // Email a sign-in code (plus a backup link). The code is what makes
    // sign-in work inside a home-screen PWA on iOS, where the link would
    // otherwise open in Safari and leave the installed app logged out.
    setSent(true);
    setCode("");
    const res = await sendMagicLink(email.trim());
    if (!res.ok) {
      setSent(false);
      setErr(res.error || "Couldn't send the code. Try again.");
    }
  };

  const verify = async () => {
    if (!codeValid || verifying) return;
    setErr("");
    setVerifying(true);
    const res = await verifyEmailCode(email.trim(), code);
    setVerifying(false);
    if (res.ok) {
      onSignedIn(email.trim());
    } else {
      setErr(res.error || "That code didn't work. Check it and try again.");
    }
  };

  return (
    <Center>
      <div style={{ maxWidth: 380, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Glyph />
        </div>
        <Eyebrow center>Welcome to KALA</Eyebrow>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
          fontSize: "clamp(28px,7vw,40px)", letterSpacing: "-.02em", margin: "12px 0 10px",
          lineHeight: 1.1 }}>
          Design your life,<br /><em style={{ fontStyle: "italic", color: C.clay }}>not just your week.</em>
        </h1>
        <p style={{ color: C.soilSoft, fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
          Save your plans across devices, or jump straight in as a guest.
        </p>

        {!sent ? (
          <>
            <div style={{ marginBottom: 10, textAlign: "left" }}>
              <Input type="email" placeholder="you@email.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") signIn(); }} />
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <Btn onClick={signIn} disabled={!valid}>Continue with email</Btn>
              <Btn variant="ghost" onClick={onGuest}>Continue as guest</Btn>
            </div>
            {err && <p style={{ fontSize: 12.5, color: C.clay, marginTop: 12 }}>{err}</p>}
            <p style={{ fontSize: 11.5, color: C.soilSoft, marginTop: 16, lineHeight: 1.5 }}>
              Guest data is saved on this device only. Sign in later from Settings to sync.
            </p>
          </>
        ) : (
          <div style={{ padding: "20px 0", textAlign: "left" }}>
            <p style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 18,
              color: C.soil, marginBottom: 10, textAlign: "center" }}>Check your inbox.</p>
            <p style={{ fontSize: 14, color: C.soilSoft, lineHeight: 1.6, marginBottom: 18,
              textAlign: "center" }}>
              We sent a sign-in code to <strong>{email}</strong>. Enter it below to sign in
              — no need to leave this app.
            </p>
            <div style={{ marginBottom: 10 }}>
              <Input type="text" inputMode="numeric" autoComplete="one-time-code"
                pattern="\d*" maxLength={10} placeholder="12345678" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
                style={{ textAlign: "center", letterSpacing: ".4em", fontSize: 20 }} />
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <Btn onClick={verify} disabled={!codeValid || verifying}>
                {verifying ? "Signing in…" : "Sign in"}
              </Btn>
            </div>
            {err && <p style={{ fontSize: 12.5, color: C.clay, marginTop: 12,
              textAlign: "center" }}>{err}</p>}
            <p style={{ fontSize: 12, color: C.soilSoft, marginTop: 16, lineHeight: 1.5,
              textAlign: "center" }}>
              Opening on a desktop browser? The link in the email works too.
            </p>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Btn variant="ghost" small onClick={() => { setSent(false); setCode(""); setErr(""); }}
                style={{ marginTop: 12 }}>Use a different email</Btn>
            </div>
          </div>
        )}

        <p style={{ fontSize: 11, color: C.soilSoft, marginTop: 30, letterSpacing: ".1em" }}>
          A PRODUCT BY KNSL
        </p>
      </div>
    </Center>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", flexDirection: "column", gap: 14 }}>
      <Glyph />
      <span style={{ fontSize: 12, letterSpacing: ".22em", color: C.soilSoft,
        fontWeight: 600 }}>KALA</span>
    </div>
  );
}

function FontLoader() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);

    const s = document.createElement("style");
    s.textContent = `
      @keyframes pop{to{opacity:1;transform:scale(1)}}
      @keyframes kFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      @keyframes kFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes kPulse{0%,100%{box-shadow:0 0 0 2px rgba(138,74,44,.3)}50%{box-shadow:0 0 0 5px rgba(138,74,44,.06)}}
      @keyframes kRingPulse{0%,100%{box-shadow:0 0 0 0 rgba(138,74,44,.45);opacity:1}50%{box-shadow:0 0 0 6px rgba(138,74,44,0);opacity:.7}}
      @keyframes kDraw{to{stroke-dashoffset:var(--target)}}
      @keyframes kGrow{from{width:0}}
      .kFadeUp{opacity:0;animation:kFadeUp .6s cubic-bezier(.22,.61,.36,1) forwards}
      .kView{animation:kFadeUp .5s cubic-bezier(.22,.61,.36,1)}
      .kCard{transition:transform .35s cubic-bezier(.22,.61,.36,1),box-shadow .35s ease}
      .kCard:hover{transform:translateY(-3px);box-shadow:0 26px 50px -30px rgba(46,32,24,.55)}
      .kRow{transition:transform .25s ease}
      .kRow:hover{transform:translateX(4px)}
      .kBtn{transition:transform .15s ease,opacity .2s ease,filter .2s ease}
      .kBtn:hover:not(:disabled){filter:brightness(1.06)}
      .kTab{transition:color .25s ease}
      .kCell{transition:background .4s ease,box-shadow .4s ease}
      /* keyboard focus visibility (a11y) */
      a:focus-visible, button:focus-visible, input:focus-visible,
      textarea:focus-visible, select:focus-visible, label:focus-visible,
      [tabindex]:focus-visible{
        outline:2.5px solid ${C.clay};outline-offset:2px;border-radius:8px
      }
      :focus:not(:focus-visible){outline:none}
      input[type=date]::-webkit-calendar-picker-indicator{
        cursor:pointer;opacity:.55;filter:sepia(.4) saturate(1.3) hue-rotate(-10deg)
      }
      input[type=date]::-webkit-calendar-picker-indicator:hover{opacity:.85}
      @media(prefers-reduced-motion:reduce){
        *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
      }
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}

// ---------- WELCOME ----------
function Welcome({ onNext }) {
  const [step, setStep] = useState(0);
  const lines = [
    {
      eyebrow: "Welcome to KALA",
      title: ["Take a breath.", "You're right on time."],
      body: "KALA isn't about doing more, or moving faster. It's a quiet space to notice the life you're actually living.",
      cta: "I'm ready",
    },
    {
      eyebrow: "A gentle idea",
      title: ["Your life is made", "of weeks."],
      body: "Not a calendar for today — a map of every week you'll ever live. Seeing them all at once can be grounding. Let's look together.",
      cta: "Show me",
    },
  ];
  const s = lines[step];
  return (
    <Center>
      <div key={step} className="kView" style={{ maxWidth: 460 }}>
        <Glyph />
        <div style={{ fontSize: 11, letterSpacing: ".26em", textTransform: "uppercase",
          color: C.clay, fontWeight: 600, marginTop: 22 }}>{s.eyebrow}</div>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
          fontSize: "clamp(32px,6.5vw,56px)", lineHeight: 1.07, letterSpacing: "-.02em",
          margin: "14px 0 18px" }}>
          {s.title[0]}<br /><em style={{ color: C.clay, fontStyle: "italic" }}>{s.title[1]}</em>
        </h1>
        <p style={{ color: C.soilSoft, fontSize: 17, lineHeight: 1.6, maxWidth: "27em",
          margin: "0 auto 32px" }}>{s.body}</p>
        <Btn onClick={() => step < lines.length - 1 ? setStep(step + 1) : onNext()}>{s.cta}</Btn>

        {/* step dots */}
        <div style={{ display: "flex", gap: 7, justifyContent: "center", marginTop: 28 }}>
          {lines.map((_, i) => (
            <span key={i} style={{ width: i === step ? 22 : 7, height: 7, borderRadius: 99,
              background: i === step ? C.clay : C.line, transition: "all .3s ease" }} />
          ))}
        </div>
        <p style={{ marginTop: 30, fontSize: 11, letterSpacing: ".24em",
          textTransform: "uppercase", color: C.soilSoft }}>
          KALA · A product by KNSL
        </p>
      </div>
    </Center>
  );
}

// ---------- BIRTH INPUT ----------
function Onboard({ profile, setProfile, onBack, onDone }) {
  const [step, setStep] = useState(1);
  const set = (patch) => setProfile({ ...profile, ...patch });

  const step1Valid = profile.birth && new Date(profile.birth) < new Date();
  const step2Valid = profile.focus.length > 0;

  const toggleFocus = (key) => {
    const has = profile.focus.includes(key);
    if (has) set({ focus: profile.focus.filter((f) => f !== key) });
    else if (profile.focus.length < 3) set({ focus: [...profile.focus, key] });
  };

  return (
    <Center>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* progress dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 26, justifyContent: "center" }}>
          {[1, 2, 3].map((s) => (
            <span key={s} style={{ height: 4, width: s === step ? 28 : 16, borderRadius: 99,
              background: s <= step ? C.clay : C.line, transition: "all .4s ease" }} />
          ))}
        </div>

        <div key={step} className="kView">
          {step === 1 && (
            <>
              <Eyebrow>Step 1 · You</Eyebrow>
              <H2>When did your story begin?</H2>
              <Label>Your name</Label>
              <Input value={profile.name} placeholder="e.g. Arya"
                onChange={(e) => set({ name: e.target.value })} />
              <Label style={{ marginTop: 20 }}>Date of birth</Label>
              <Input type="date" value={profile.birth}
                onChange={(e) => set({ birth: e.target.value })} />
              <Label style={{ marginTop: 20 }}>
                Life expectancy — <span style={{ color: C.clay }}>{profile.lifeExp} years</span>
              </Label>
              <input type="range" min="60" max="100" value={profile.lifeExp}
                onChange={(e) => set({ lifeExp: +e.target.value })}
                style={{ width: "100%", accentColor: C.clay, marginTop: 4 }} />
              <p style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 6 }}>
                Default based on average. You can change this anytime.
              </p>
              <Nav onBack={onBack} backLabel="Back"
                onNext={() => setStep(2)} nextLabel="Continue" nextDisabled={!step1Valid} />
            </>
          )}

          {step === 2 && (
            <>
              <Eyebrow>Step 2 · Focus</Eyebrow>
              <H2>What matters most to you right now?</H2>
              <p style={{ color: C.soilSoft, fontSize: 15, margin: "-8px 0 22px" }}>
                Pick up to three. KALA puts these front and center.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {AREAS.map((a) => {
                  const on = profile.focus.includes(a.key);
                  return (
                    <button key={a.key} className="kBtn" onClick={() => toggleFocus(a.key)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                        padding: "15px 18px", borderRadius: 14, cursor: "pointer",
                        border: `1.5px solid ${on ? a.color : C.line}`,
                        background: on ? a.color + "14" : C.paper,
                        fontFamily: "inherit", fontSize: 15.5, fontWeight: 600, color: C.soil,
                      }}>
                      <span style={{ width: 11, height: 11, borderRadius: 99, background: a.color,
                        opacity: on ? 1 : 0.3, flexShrink: 0 }} />
                      {a.label}
                      <span style={{ marginLeft: "auto", color: a.color, opacity: on ? 1 : 0,
                        transition: "opacity .2s", fontWeight: 700 }}>✓</span>
                    </button>
                  );
                })}
              </div>
              <Nav onBack={() => setStep(1)} backLabel="Back"
                onNext={() => setStep(3)} nextLabel="Continue" nextDisabled={!step2Valid} />
            </>
          )}

          {step === 3 && (
            <>
              <Eyebrow>Step 3 · Intention</Eyebrow>
              <H2>If KALA remembered one thing…</H2>
              <p style={{ color: C.soilSoft, fontSize: 15, margin: "-8px 0 22px" }}>
                What's one life you're trying to build? One sentence is enough — you can refine it later.
              </p>
              <textarea value={profile.intention}
                onChange={(e) => set({ intention: e.target.value })}
                placeholder="e.g. Jadi corporate lawyer internasional dan punya holding company sebelum 40."
                style={{
                  width: "100%", boxSizing: "border-box", minHeight: 96, padding: "14px 16px",
                  borderRadius: 12, border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
                  fontFamily: "inherit", fontSize: 15, resize: "vertical", outline: "none",
                }} />
              <p style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 10 }}>
                Optional — but this seeds your first roadmap.
              </p>
              <Nav onBack={() => setStep(2)} backLabel="Back"
                onNext={onDone} nextLabel="See my life" nextDisabled={false} />
            </>
          )}
        </div>
      </div>
    </Center>
  );
}

function H2({ children }) {
  return <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
    fontSize: "clamp(26px,5vw,38px)", letterSpacing: "-.015em", margin: "10px 0 24px",
    lineHeight: 1.12 }}>{children}</h2>;
}
function Nav({ onBack, backLabel, onNext, nextLabel, nextDisabled }) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
      <Btn variant="ghost" onClick={onBack}>{backLabel}</Btn>
      <Btn onClick={onNext} disabled={nextDisabled}>{nextLabel}</Btn>
    </div>
  );
}

// ---------- REVEAL (dramatic) ----------
function Reveal({ profile, onDone }) {
  const [phase, setPhase] = useState(0); // 0 grid building, 1 stats, 2 cta
  const birth = new Date(profile.birth);
  const now = new Date();
  const lived = Math.max(0, weeksBetween(birth, now));
  const total = profile.lifeExp * WEEKS_PER_YEAR;
  const remaining = Math.max(0, total - lived);
  const age = Math.floor((now - birth) / (1000 * 60 * 60 * 24 * 365.25));

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 2600);
    const t2 = setTimeout(() => setPhase(2), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center" }}>
      <p style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 20,
        color: C.soilSoft, marginBottom: 24,
        opacity: phase >= 1 ? 1 : 0.5, transition: "opacity .8s" }}>
        {phase === 0 ? "Every box is a week…" : `${profile.name || "This"} — here is your life.`}
      </p>

      <div style={{ width: "min(680px,92vw)" }}>
        <FullGrid lived={lived} total={total} milestoneWeeks={{}} building={true} />
      </div>

      <div style={{ opacity: phase >= 1 ? 1 : 0, transform: phase >= 1 ? "none" : "translateY(10px)",
        transition: "all .9s", marginTop: 34, display: "flex", gap: 40, flexWrap: "wrap", justifyContent: "center" }}>
        <Stat n={fmt(lived)} l="Weeks lived" />
        <Stat n={fmt(remaining)} l="Weeks remaining" accent />
        <Stat n={((lived / total) * 100).toFixed(1) + "%"} l="Life lived" />
        <Stat n={age} l="Years old" />
      </div>

      <div style={{ opacity: phase >= 2 ? 1 : 0, transition: "opacity .8s", marginTop: 40 }}>
        <Btn onClick={onDone}>This is just the beginning →</Btn>
      </div>
    </div>
  );
}

// ================= MAIN APP =================


function Main({ profile, setProfile, plans, setPlans, activePlan, setActivePlan,
  memories, setMemories, diary, setDiary, weekly, setWeekly,
  lastSeenWeek, setLastSeenWeek, people, setPeople, countdowns, setCountdowns,
  theme, setTheme, dark, setDark, lang, setLang, onReset }) {
  const [tab, setTab] = useState("life");
  const [drawer, setDrawer] = useState(false);
  const audio = useKALAAudio();

  // change ambient scale when tab changes
  useEffect(() => {
    const map = { reflect: "reflect", wrapped: "wrapped", simulate: "simulate" };
    audio.setScale(map[tab] || "default");
  }, [tab]);
  const wkNow = currentWeekKey();

  // ---- export / import all data (trust & portability) ----
  const exportData = () => {
    const payload = { _app: "KALA", _v: 1, exportedAt: new Date().toISOString(),
      profile, plans, activePlan, memories, diary, weekly, people, countdowns };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `kala-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const importData = (json) => {
    try {
      const d = JSON.parse(json);
      if (d.profile) setProfile(d.profile);
      if (d.plans) setPlans(d.plans);
      if (d.activePlan) setActivePlan(d.activePlan);
      if (d.memories) setMemories(d.memories);
      if (d.diary) setDiary(d.diary);
      if (d.weekly) setWeekly(d.weekly);
      if (d.people) setPeople(d.people);
      if (d.countdowns) setCountdowns(d.countdowns);
      return true;
    } catch { return false; }
  };

  // show weekly nudge if this is a new week (and we've seen at least one before)
  const [showNudge, setShowNudge] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (lastSeenWeek && lastSeenWeek !== wkNow) setShowNudge(true);
      // first ever visit: just record, no nudge
      if (!lastSeenWeek) setLastSeenWeek(wkNow);
    }, 900);
    return () => clearTimeout(t);
  }, []);
  const dismissNudge = () => { setShowNudge(false); setLastSeenWeek(wkNow); };

  const birth = new Date(profile.birth);
  const now = new Date();
  const lived = Math.max(0, weeksBetween(birth, now));
  const total = profile.lifeExp * WEEKS_PER_YEAR;
  const remaining = Math.max(0, total - lived);
  const age = Math.floor((now - birth) / (1000 * 60 * 60 * 24 * 365.25));
  const pct = ((lived / total) * 100).toFixed(1);

  const current = plans.find((p) => p.id === activePlan) || plans[0];
  const roadmap = current?.steps || [];

  // update steps of active plan
  const setRoadmap = (steps) => {
    setPlans(plans.map((p) => p.id === activePlan
      ? { ...p, steps: typeof steps === "function" ? steps(p.steps) : steps }
      : p));
  };
  // toggle milestone done
  const [celebrate, setCelebrate] = useState(null); // milestone just completed
  const toggleStep = (stepId) => {
    const target = roadmap.find((s) => s.id === stepId);
    const willBeDone = target && !target.done;
    setRoadmap((prev) => prev.map((s) => s.id === stepId ? { ...s, done: !s.done } : s));
    if (willBeDone && target) setCelebrate({ ...target, done: true });
  };
  // edit milestone fields
  const editStep = (stepId, patch) => {
    setRoadmap((prev) => prev.map((s) => s.id === stepId ? { ...s, ...patch } : s));
  };

  // weekly goals for current week
  const wk = currentWeekKey();
  const weekGoals = weekly[wk] || [];
  const setWeekGoals = (goals) => setWeekly({ ...weekly,
    [wk]: typeof goals === "function" ? goals(weekGoals) : goals });
  // "this week, one thing" ritual answer for current week
  const oneThing = weekly["one:" + wk] || "";
  const setOneThing = (v) => setWeekly({ ...weekly, ["one:" + wk]: v });

  const milestoneWeeks = useMemo(() => {
    const map = {};
    roadmap.forEach((r) => {
      const wk = lived + (r.year - now.getFullYear()) * WEEKS_PER_YEAR;
      map[wk] = r;
    });
    return map;
  }, [roadmap, lived]);

  const isSecondary = SECONDARY_TABS.some((t) => t.key === tab);
  const activeLabel = [...PRIMARY_TABS, ...SECONDARY_TABS].find((t) => t.key === tab)?.label;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 20px 80px" }}>
      {/* top bar */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0" }}>
        <button onClick={() => setDrawer(true)} className="kBtn"
          style={{ display: "flex", alignItems: "center", gap: 11, fontWeight: 700,
            letterSpacing: ".18em", background: "transparent", border: "none", cursor: "pointer",
            color: C.soil, fontFamily: "inherit", fontSize: 16, padding: 0 }}
          title="Open menu" aria-label="Open menu">
          <Glyph small /> KALA
          <span style={{ fontSize: 11, color: C.soilSoft, letterSpacing: 0, marginLeft: 2 }}>▾</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LiveClock lang={lang} />
          <KALAAudioButton audio={audio} />
          <div style={{ fontSize: 13, color: C.soilSoft }}>
            Hi, {profile.name || "friend"}
          </div>
        </div>
      </header>

      {/* primary tabs only */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28, borderBottom: `1px solid ${C.line}`,
        flexWrap: "wrap", alignItems: "center" }}>
        {PRIMARY_TABS.map((tb) => (
          <Tab key={tb.key} active={tab === tb.key} onClick={() => setTab(tb.key)}>{tr(tb.label, lang)}</Tab>
        ))}
        {/* if a secondary tab is active, show it as a pill so user isn't lost */}
        {isSecondary && (
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: C.clay, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6 }}>
            {activeLabel}
            <button onClick={() => setTab("life")} className="kBtn" style={{ background: "transparent",
              border: "none", color: C.soilSoft, cursor: "pointer", fontSize: 15, padding: 0 }}>×</button>
          </span>
        )}
      </div>

      <div key={tab} className="kView">
        {tab === "life" && (
          <LifeView
            profile={profile} lived={lived} total={total} remaining={remaining}
            age={age} pct={pct} milestoneWeeks={milestoneWeeks} roadmap={roadmap}
            planName={current?.name} plans={plans} activePlan={activePlan}
            setActivePlan={setActivePlan} goToPlans={() => setTab("architect")} lang={lang}
            memories={memories}
          />
        )}
        {tab === "reflect" && (
          <ReflectView profile={profile} roadmap={roadmap} age={age} planName={current?.name}
            weekGoals={weekGoals} setWeekGoals={setWeekGoals} toggleStep={toggleStep}
            oneThing={oneThing} setOneThing={setOneThing} lang={lang} />
        )}
        {tab === "architect" && (
          <ArchitectView age={age} roadmap={roadmap} setRoadmap={setRoadmap}
            seed={profile.intention} onApplied={() => setTab("life")}
            plans={plans} setPlans={setPlans} activePlan={activePlan} setActivePlan={setActivePlan}
            toggleStep={toggleStep} editStep={editStep} />
        )}
        {tab === "simulate" && (
          <SimulateView age={age} lifeExp={profile.lifeExp} />
        )}
        {tab === "calendar" && (
          <CalendarView countdowns={countdowns} memories={memories} lang={lang}
            goToCountdown={() => setTab("countdown")} />
        )}
        {tab === "countdown" && (
          <CountdownView countdowns={countdowns} setCountdowns={setCountdowns} lang={lang} />
        )}
        {tab === "people" && (
          <PeopleView people={people} setPeople={setPeople} lang={lang} />
        )}
        {tab === "memory" && (
          <MemoryView profile={profile} memories={memories} setMemories={setMemories} age={age} />
        )}
        {tab === "diary" && (
          <DiaryView profile={profile} diary={diary} setDiary={setDiary}
            memories={memories} setMemories={setMemories} />
        )}
        {tab === "wrapped" && (
          <WrappedView profile={profile} roadmap={roadmap} memories={memories}
            lived={lived} total={total} age={age} pct={pct} />
        )}
        {tab === "settings" && (
          <SettingsView profile={profile} setProfile={setProfile}
            exportData={exportData} importData={importData}
            theme={theme} setTheme={setTheme} dark={dark} setDark={setDark} lang={lang} setLang={setLang}
            onReset={onReset} />
        )}
      </div>

      {/* DRAWER */}
      {drawer && (
        <Drawer profile={profile} onClose={() => setDrawer(false)}
          tab={tab} setTab={(tk) => { setTab(tk); setDrawer(false); }}
          lang={lang} onReset={onReset} />
      )}

      {/* WEEKLY NUDGE */}
      {showNudge && (
        <WeeklyNudge profile={profile} lived={lived} total={total} pct={pct}
          roadmap={roadmap}
          onReflect={() => { dismissNudge(); setTab("reflect"); }}
          onClose={dismissNudge} />
      )}

      {celebrate && (
        <MilestoneConstellation milestone={celebrate}
          doneCount={roadmap.filter((s) => s.done).length}
          totalCount={roadmap.length}
          onClose={() => setCelebrate(null)} />
      )}
    </div>
  );
}

function Drawer({ profile, onClose, tab, setTab, lang, onReset }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(46,32,24,.34)", animation: "kFadeIn .25s ease",
      display: "flex", justifyContent: "flex-start" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(330px,86vw)", height: "100%", background: C.bg,
        borderRight: `1px solid ${C.line}`, padding: "26px 22px",
        boxShadow: "20px 0 60px -30px rgba(46,32,24,.5)",
        animation: "kSlideIn .32s cubic-bezier(.22,.61,.36,1)", overflowY: "auto",
      }}>
        <style>{`@keyframes kSlideIn{from{transform:translateX(-100%)}to{transform:none}}`}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, fontWeight: 700, letterSpacing: ".18em" }}>
            <Glyph small /> KALA
          </div>
          <button onClick={onClose} className="kBtn" style={{ background: "transparent", border: "none",
            fontSize: 22, color: C.soilSoft, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase",
          color: C.soilSoft, fontWeight: 600, marginBottom: 12 }}>{tr("Main", lang)}</div>
        {PRIMARY_TABS.map((tb) => (
          <DrawerItem key={tb.key} label={tr(tb.label, lang)} active={tab === tb.key} onClick={() => setTab(tb.key)} />
        ))}

        <div style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase",
          color: C.soilSoft, fontWeight: 600, margin: "22px 0 12px" }}>{tr("More", lang)}</div>
        {SECONDARY_TABS.map((tb) => (
          <DrawerItem key={tb.key} label={tr(tb.label, lang)} desc={tb.desc}
            active={tab === tb.key} onClick={() => setTab(tb.key)} />
        ))}

        <div style={{ marginTop: 30, paddingTop: 20, borderTop: `1px solid ${C.line}`,
          fontSize: 12, color: C.soilSoft, lineHeight: 1.6 }}>
          {profile.name || "You"} · born {profile.birth || "—"}<br />
          <span style={{ letterSpacing: ".1em" }}>A product by KNSL</span>
        </div>

        {/* start over */}
        <div style={{ marginTop: 18 }}>
          {!confirmReset ? (
            <button onClick={() => setConfirmReset(true)} className="kBtn"
              style={{ background: "transparent", border: `1px solid ${C.line}`, borderRadius: 99,
                padding: "8px 16px", fontSize: 12.5, fontFamily: "inherit", fontWeight: 600,
                color: C.soilSoft, cursor: "pointer" }}>
              Start over
            </button>
          ) : (
            <div style={{ background: C.paper, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "14px 14px" }}>
              <p style={{ fontSize: 12.5, color: C.soil, marginBottom: 10, lineHeight: 1.5 }}>
                This erases everything — plans, diary, memories. Are you sure?
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onReset} className="kBtn" style={{ background: C.clay,
                  border: "none", borderRadius: 99, padding: "7px 14px", fontSize: 12,
                  fontFamily: "inherit", fontWeight: 600, color: C.paper, cursor: "pointer" }}>
                  Yes, erase
                </button>
                <button onClick={() => setConfirmReset(false)} className="kBtn"
                  style={{ background: "transparent", border: `1px solid ${C.line}`,
                    borderRadius: 99, padding: "7px 14px", fontSize: 12, fontFamily: "inherit",
                    fontWeight: 600, color: C.soilSoft, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawerItem({ label, desc, active, onClick }) {
  return (
    <button onClick={onClick} className="kBtn" style={{
      display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 4,
      borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
      background: active ? C.paper : "transparent",
      boxShadow: active ? `inset 0 0 0 1px ${C.line}` : "none",
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: active ? C.clay : C.soil }}>{label}</div>
      {desc && <div style={{ fontSize: 12, color: C.soilSoft, marginTop: 2 }}>{desc}</div>}
    </button>
  );
}

// ---------- LIFE VIEW ----------
let kIntroPlayed = false; // play the dramatic intro once per session

function LifeView({ profile, lived, total, remaining, age, pct, milestoneWeeks, roadmap,
  planName, plans, activePlan, setActivePlan, goToPlans, lang, memories }) {
  // memories mapped to week index (by age at the memory)
  const memoryWeeks = useMemo(() => {
    const out = {};
    (memories || []).forEach((m) => {
      if (m.age != null) { const wk = Math.floor(m.age * 52); if (wk >= 0 && wk < total) out[wk] = m; }
    });
    return out;
  }, [memories, total]);
  // progress per area from REAL milestone completion
  const areaProgress = useMemo(() => {
    const out = {};
    AREAS.forEach((a) => {
      const ms = roadmap.filter((r) => r.area === a.key);
      const done = ms.filter((r) => r.done).length;
      out[a.key] = ms.length === 0 ? 0 : Math.round(100 * done / ms.length);
    });
    return out;
  }, [roadmap]);

  // ---- grid build (once) + zoom-to-now sequence (every visit) ----
  const [phase, setPhase] = useState(kIntroPlayed ? "done" : "build");
  const [zoomPhase, setZoomPhase] = useState("idle"); // idle | in | out
  const [showPointer, setShowPointer] = useState(false);
  const introRan = useRef(false);
  useEffect(() => {
    if (introRan.current) return;   // guard against double-invoke (StrictMode / re-render)
    introRan.current = true;

    // The dramatic build + zoom-to-now plays ONCE per app session (first open only).
    // Returning to the Life tab afterward shows the grid calmly, no zoom.
    if (kIntroPlayed) return;
    kIntroPlayed = true;

    let clears = [];
    clears.push(setTimeout(() => setPhase("done"), 1750));
    const base = 1900;                            // wait for grid to settle
    clears.push(setTimeout(() => { setZoomPhase("in"); setShowPointer(true); }, base));
    clears.push(setTimeout(() => { setZoomPhase("out"); }, base + 1900));     // hold ~1.9s
    clears.push(setTimeout(() => { setShowPointer(false); }, base + 1700));
    clears.push(setTimeout(() => { setZoomPhase("idle"); }, base + 3100));
    return () => clears.forEach(clearTimeout);
  }, []);

  const cols = 52;
  const rows = Math.ceil(total / cols);
  // zoom transform origin = the now cell's position (%)
  const nowCol = lived % cols, nowRow = Math.floor(lived / cols);
  const originX = ((nowCol + 0.5) / cols) * 100;
  const originY = ((nowRow + 0.5) / rows) * 100;
  const zoomScale = zoomPhase === "in" ? 6 : 1;

  return (
    <div>
      {/* stat row */}
      <div style={{ display: "flex", gap: 36, flexWrap: "wrap", marginBottom: 10 }}>
        <Stat n={fmt(lived)} l={tr("Weeks lived", lang)} />
        <Stat n={fmt(remaining)} l={tr("Weeks remaining", lang)} accent />
        <Stat n={pct + "%"} l={tr("Life lived", lang)} />
        <Stat n={age} l={tr("Years old", lang)} />
      </div>
      {/* gentle framing — these are possibilities, not verdicts */}
      <p style={{ fontSize: 12.5, color: C.soilSoft, marginBottom: 24, lineHeight: 1.5, fontStyle: "italic",
        fontFamily: "'Fraunces',serif" }}>
        {tr("These numbers assume a long life", lang)} — {tr("they're a gentle estimate, not a promise. The point isn't how much time is left, but how you choose to spend it.", lang)}
      </p>

      {/* plan switcher */}
      {plans && plans.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
            color: C.soilSoft, fontWeight: 600 }}>{tr("Active plan", lang)}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {plans.map((p) => (
              <button key={p.id} className="kBtn" onClick={() => setActivePlan(p.id)}
                style={{ padding: "6px 14px", borderRadius: 99, fontFamily: "inherit", fontSize: 13,
                  fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${p.id === activePlan ? C.clay : C.line}`,
                  background: p.id === activePlan ? C.clay : "transparent",
                  color: p.id === activePlan ? C.paper : C.soilSoft }}>
                {p.name}
              </button>
            ))}
          </div>
          <button onClick={goToPlans} className="kBtn" style={{ marginLeft: "auto", background: "transparent",
            border: "none", color: C.clay, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            Manage plans →
          </button>
        </div>
      )}

      {/* life grid card */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20 }}>{tr("Your life in weeks", lang)}</h3>
          <span style={{ fontSize: 12.5, color: C.soilSoft }}>
            {roadmap.length > 0 ? `${roadmap.length} milestones placed` : "Add goals in AI Architect →"}
          </span>
        </div>

        {/* life grid — zooms into the user's 'now' cell, holds, zooms out.
            The zoom wrapper clips (overflow hidden); the label lives OUTSIDE it so it never gets cut off. */}
        <div style={{ position: "relative" }}>
          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden" }}>
            <div style={{
              transform: `scale(${zoomScale})`,
              transformOrigin: `${originX}% ${originY}%`,
              transition: "transform 1.4s cubic-bezier(.5,0,.15,1)",
            }}>
              <div style={{ position: "relative" }}>
                <FullGrid lived={lived} total={total} milestoneWeeks={milestoneWeeks}
                  building={phase === "build"} memoryWeeks={memoryWeeks} showSeasons={true} />
                {/* ring pulse on the now cell, in grid coordinates so it scales too */}
                <div style={{
                  position: "absolute",
                  left: `${originX}%`, top: `${originY}%`,
                  width: 18, height: 18, marginLeft: -9, marginTop: -9,
                  borderRadius: 4, border: `1.5px solid ${C.clay}`,
                  opacity: zoomPhase === "in" ? 1 : 0,
                  transition: "opacity .5s ease",
                  animation: zoomPhase === "in" ? "kRingPulse 1.6s ease-in-out infinite" : "none",
                  pointerEvents: "none",
                }} />
              </div>
            </div>
          </div>

          {/* label — OUTSIDE the clipping wrapper, anchored to the now-cell screen position.
              Clamped so it never overflows the card edges. */}
          <div style={{
            position: "absolute",
            left: `${Math.min(Math.max(originX, 16), 84)}%`,
            top: `${originY}%`,
            transform: "translate(-50%, 30px)",
            opacity: showPointer ? 1 : 0,
            transition: "opacity .6s ease",
            pointerEvents: "none", zIndex: 20, textAlign: "center",
          }}>
            {/* small connector tick from the cell up to the pill */}
            <div style={{ width: 1.5, height: 16, background: C.clay, margin: "0 auto 7px",
              opacity: 0.6 }} />
            <div style={{ background: C.clay, color: "#FFFFFF", fontSize: 12.5, fontWeight: 700,
              padding: "8px 16px", borderRadius: 99, letterSpacing: ".03em", whiteSpace: "nowrap",
              boxShadow: "0 14px 30px -10px rgba(0,0,0,.45)", display: "inline-block" }}>
              You are here · week {fmt(lived + 1)}
            </div>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 12.5,
              color: C.soilSoft, marginTop: 7, whiteSpace: "nowrap" }}>
              one small square, fully yours
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 22, marginTop: 20, flexWrap: "wrap", fontSize: 12.5, color: C.soilSoft }}>
          <Legend c={C.past} t="Lived" />
          <Legend c={C.now} t="This week" ring />
          <Legend c="transparent" t="Ahead" border />
          {roadmap.length > 0 && <Legend c={C.amber} t="Milestone" star />}
          {Object.keys(memoryWeeks).length > 0 && <Legend c={C.rose} t="Memory" />}
        </div>

        {/* life seasons */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {LIFE_SEASONS.map((s) => {
            const isCurrent = age >= s.from && age < s.to;
            return (
              <span key={s.label} style={{ fontSize: 11.5, fontWeight: 600,
                padding: "4px 11px", borderRadius: 99,
                background: isCurrent ? C.clay : s.tint,
                color: isCurrent ? C.paper : C.soilSoft,
                border: `1px solid ${isCurrent ? C.clay : C.line}` }}>
                {s.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>{s.from}–{s.to === 200 ? "" : s.to}</span>
              </span>
            );
          })}
        </div>
      </Card>

      {/* area progress */}
      <Card style={{ marginTop: 18 }} delay={120}>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20, marginBottom: 18 }}>
          Life areas
        </h3>
        {AREAS.map((a, i) => (
          <div key={a.key} className="kRow" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{a.label}</span>
              <span style={{ color: C.soilSoft }}>{areaProgress[a.key] || 0}%</span>
            </div>
            <div style={{ height: 8, background: C.line, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: (areaProgress[a.key] || 0) + "%", height: "100%",
                background: a.color, borderRadius: 99,
                animation: "kGrow .9s cubic-bezier(.22,.61,.36,1) forwards",
                animationDelay: `${i * 80 + 250}ms` }} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// Canvas-based life grid — renders thousands of weeks cheaply on one <canvas>.


function FullGrid({ lived, total, milestoneWeeks, building, onHitNow, memoryWeeks, showSeasons }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(null);
  const breatheRef = useRef(null);
  const cols = 52;
  const rows = Math.ceil(total / cols);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const draw = (progress, breath = 0) => {
      const W = wrap.clientWidth;
      const gap = 2.5;
      const cell = (W - gap * (cols - 1)) / cols;
      const H = rows * cell + gap * (rows - 1);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // season background bands
      if (showSeasons && !building) {
        LIFE_SEASONS.forEach((s) => {
          const startW = s.from * 52, endW = Math.min(s.to * 52, total);
          if (startW >= total) return;
          const r0 = Math.floor(startW / cols), r1 = Math.ceil(endW / cols);
          const y0 = r0 * (cell + gap), y1 = r1 * (cell + gap);
          ctx.fillStyle = s.tint;
          ctx.fillRect(0, y0, W, y1 - y0);
        });
      }

      const rad = Math.max(1, cell * 0.16);
      const span = 0.55;
      for (let i = 0; i < total; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const x = c * (cell + gap), y = r * (cell + gap);
        const isLived = i < lived, isNow = i === lived;
        const ms = milestoneWeeks[i];
        const mem = memoryWeeks && memoryWeeks[i];

        let s = 1, a = 1;
        if (building) {
          const cellStart = (i / total) * (1 - span);
          const local = (progress - cellStart) / span;
          if (local <= 0) continue;
          const e = easeOut(Math.min(1, local));
          s = 0.6 + 0.4 * e; a = e;
        }
        // breathing on the now cell
        if (isNow && !building) s = 1 + breath * 0.18;

        const sz = cell * s, off = (cell - sz) / 2;
        ctx.globalAlpha = a;
        roundRect(ctx, x + off, y + off, sz, sz, rad);
        if (ms) { ctx.fillStyle = ms.done ? C.sage : C.amber; ctx.fill(); }
        else if (isLived) { ctx.fillStyle = C.past; ctx.fill(); }
        else if (isNow) { ctx.fillStyle = C.now; ctx.fill(); }
        else { ctx.fillStyle = C.bg; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.line; ctx.stroke(); }

        // glowing memory dot
        if (mem && !building) {
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.32, 0, Math.PI * 2);
          ctx.fillStyle = C.rose;
          ctx.shadowColor = C.rose; ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // soft halo on now cell while breathing
        if (isNow && !building && breath > 0.01) {
          ctx.globalAlpha = breath * 0.4;
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * (0.9 + breath * 0.5), 0, Math.PI * 2);
          ctx.strokeStyle = C.now; ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    if (building) {
      let start = null;
      const dur = 1700;
      const step = (ts) => {
        if (!start) start = ts;
        const p = Math.min(1, (ts - start) / dur);
        draw(p, 0);
        if (p < 1) rafRef.current = requestAnimationFrame(step);
        else startBreathing();
      };
      rafRef.current = requestAnimationFrame(step);
    } else {
      draw(1, 0);
      startBreathing();
    }

    function startBreathing() {
      cancelAnimationFrame(breatheRef.current);
      const t0 = performance.now();
      const loop = (ts) => {
        const t = (ts - t0) / 1000;
        const breath = (Math.sin(t * 1.1) + 1) / 2; // slow 0..1
        draw(1, breath);
        breatheRef.current = requestAnimationFrame(loop);
      };
      breatheRef.current = requestAnimationFrame(loop);
    }

    const onResize = () => draw(1, 0);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(breatheRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [lived, total, milestoneWeeks, building, memoryWeeks, showSeasons]);

  const handleClick = (e) => {
    const wrap = wrapRef.current;
    const W = wrap.clientWidth, gap = 2.5;
    const cell = (W - gap * (cols - 1)) / cols;
    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const c = Math.floor(px / (cell + gap)), r = Math.floor(py / (cell + gap));
    const idx = r * cols + c;
    if (milestoneWeeks[idx] && onHitNow) onHitNow(idx, milestoneWeeks[idx]);
  };

  return (
    <div ref={wrapRef} style={{ width: "100%", position: "relative" }} onClick={handleClick}>
      <canvas ref={canvasRef} role="img"
        aria-label={`Your life in weeks: ${fmt(lived)} of ${fmt(total)} weeks lived`}
        style={{ display: "block", width: "100%" }} />
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Pointer that curves from the user's actual "now" cell out to a label.
function NowPointer({ lived, total, visible, weekLabel }) {
  const ref = useRef(null);
  const [geo, setGeo] = useState(null);
  const cols = 52;
  const rows = Math.ceil(total / cols);

  useEffect(() => {
    const measure = () => {
      const wrap = ref.current;
      if (!wrap) return;
      const W = wrap.clientWidth, gap = 2.5;
      const cell = (W - gap * (cols - 1)) / cols;
      const H = rows * cell + gap * (rows - 1);
      const nowCol = lived % cols, nowRow = Math.floor(lived / cols);
      const cx = nowCol * (cell + gap) + cell / 2;
      const cy = nowRow * (cell + gap) + cell / 2;
      setGeo({ W, H, cell, cx, cy });
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 100); // after grid lays out
    return () => { window.removeEventListener("resize", measure); clearTimeout(t); };
  }, [lived, total]);

  // label placed below + to the right of the cell, with a curved connector
  const labelPos = useMemo(() => {
    if (!geo) return null;
    const belowRoom = geo.H - geo.cy;
    const goDown = belowRoom > 90;
    const lx = Math.min(Math.max(geo.cx + 30, 90), geo.W - 90);
    const ly = goDown ? geo.cy + 64 : geo.cy - 64;
    return { lx, ly, goDown };
  }, [geo]);

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none",
      opacity: visible ? 1 : 0, transition: "opacity .7s ease" }}>
      {geo && labelPos && (
        <>
          <svg width={geo.W} height={geo.H} style={{ position: "absolute", left: 0, top: 0,
            overflow: "visible" }}>
            {/* pulsing ring on the now cell */}
            <circle cx={geo.cx} cy={geo.cy} r={geo.cell * 0.9} fill="none"
              stroke={C.clay} strokeWidth="1.5" opacity="0.5">
              <animate attributeName="r" values={`${geo.cell * 0.7};${geo.cell * 1.5};${geo.cell * 0.7}`}
                dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2.4s" repeatCount="indefinite" />
            </circle>
            {/* curved connector from cell to label */}
            <path d={`M ${geo.cx} ${geo.cy}
              C ${geo.cx} ${(geo.cy + labelPos.ly) / 2},
                ${labelPos.lx} ${(geo.cy + labelPos.ly) / 2},
                ${labelPos.lx} ${labelPos.ly + (labelPos.goDown ? -14 : 14)}`}
              fill="none" stroke={C.clay} strokeWidth="1.5" opacity="0.7"
              strokeDasharray="200" strokeDashoffset={visible ? 0 : 200}
              style={{ transition: "stroke-dashoffset 1s ease .2s" }} />
            <circle cx={geo.cx} cy={geo.cy} r="3.5" fill={C.clay} />
          </svg>
          {/* the label itself */}
          <div style={{ position: "absolute", left: labelPos.lx, top: labelPos.ly,
            transform: "translate(-50%, -50%)", textAlign: "center" }}>
            <div style={{ background: C.soil, color: "#F4ECDD", fontSize: 12.5, fontWeight: 600,
              padding: "8px 15px", borderRadius: 99, letterSpacing: ".03em", whiteSpace: "nowrap",
              boxShadow: "0 12px 26px -10px rgba(46,32,24,.6)", display: "inline-block" }}>
              You are here · week {weekLabel}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- TIER 2: REFLECT VIEW ----------


function ReflectView({ profile, roadmap, age, weekGoals = [], setWeekGoals, toggleStep, oneThing, setOneThing, lang }) {
  const [newGoal, setNewGoal] = useState("");
  const [newArea, setNewArea] = useState("career");
  const [draft, setDraft] = useState(oneThing || "");

  // ---- REAL SCORES ----
  // Area score = 30 base + 70 * (done milestones / total milestones in area).
  // Weekly goal completion in that area adds up to +10 bonus.
  const scores = useMemo(() => {
    const out = {};
    AREAS.forEach((a) => {
      const ms = roadmap.filter((r) => r.area === a.key);
      const msDone = ms.filter((r) => r.done).length;
      const base = ms.length === 0 ? 25 : 30 + Math.round(70 * (msDone / ms.length));
      const wg = weekGoals.filter((g) => g.area === a.key);
      const wgDone = wg.filter((g) => g.done).length;
      const bonus = wg.length === 0 ? 0 : Math.round(10 * (wgDone / wg.length));
      out[a.key] = Math.min(100, base + bonus);
    });
    return out;
  }, [roadmap, weekGoals]);

  const overall = Math.round(
    AREAS.reduce((s, a) => s + (scores[a.key] || 0), 0) / AREAS.length
  );

  const week = {
    done: weekGoals.filter((g) => g.done).length,
    total: weekGoals.length,
  };
  const nextMs = roadmap.find((r) => !r.done);
  const msDoneCount = roadmap.filter((r) => r.done).length;

  const lowest = AREAS.reduce((lo, a) =>
    (scores[a.key] < scores[lo.key] ? a : lo), AREAS[0]);

  const reflection = buildReflection(profile.name, week, lowest, roadmap, nextMs, msDoneCount);

  const addGoal = () => {
    if (!newGoal.trim()) return;
    setWeekGoals([...weekGoals, { id: Date.now(), title: newGoal.trim(), area: newArea, done: false }]);
    setNewGoal("");
  };
  const toggleGoal = (id) => setWeekGoals(weekGoals.map((g) =>
    g.id === id ? { ...g, done: !g.done } : g));
  const removeGoal = (id) => setWeekGoals(weekGoals.filter((g) => g.id !== id));

  return (
    <div>
      {/* THIS WEEK, ONE THING — the weekly ritual (retention) */}
      <div className="kCard kFadeUp" style={cardStyle({
        background: `linear-gradient(160deg, ${C.paper}, ${C.card})`,
        border: `1px solid ${C.line}`, marginBottom: 18 })}>
        <Eyebrow>This week, one thing</Eyebrow>
        <p style={{ fontFamily: "'Fraunces',serif", fontSize: "clamp(19px,3.2vw,25px)",
          lineHeight: 1.3, margin: "12px 0 14px" }}>
          {WEEKLY_PROMPTS[weekPromptIndex()]}
        </p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setOneThing(draft)}
          placeholder="Just a sentence is enough…"
          style={{ width: "100%", boxSizing: "border-box", minHeight: 70, padding: "13px 15px",
            borderRadius: 12, border: `1px solid ${C.line}`, background: C.bg, color: C.soil,
            fontFamily: "'Fraunces',serif", fontSize: 16, lineHeight: 1.6, resize: "vertical",
            outline: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.soilSoft }}>
            {oneThing && draft === oneThing ? "Saved for this week ✓" : "A small weekly check-in with yourself."}
          </span>
          {draft !== oneThing && (
            <Btn small onClick={() => setOneThing(draft)}>Save</Btn>
          )}
        </div>
      </div>

      {/* Weekly reflection — the retention moment */}
      <div className="kCard kFadeUp" style={cardStyle({ animationDelay: "0ms" })}>
        <Eyebrow>This week · AI Reflection</Eyebrow>
        <p style={{ fontFamily: "'Fraunces',serif", fontSize: "clamp(20px,3.4vw,27px)",
          lineHeight: 1.32, letterSpacing: "-.01em", margin: "14px 0 4px" }}>
          {reflection.headline}
        </p>
        <p style={{ color: C.soilSoft, fontSize: 15.5, lineHeight: 1.65, marginTop: 10 }}>
          {reflection.body}
        </p>

        {/* week progress bars */}
        {week.total > 0 && (
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {weekGoals.map((g, i) => (
                <span key={g.id} style={{
                  width: 26, height: 6, borderRadius: 99,
                  background: g.done ? C.sage : C.line,
                  animation: "kGrow .5s ease forwards", animationDelay: `${i * 90 + 200}ms`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 13, color: C.soilSoft }}>
              {week.done} of {week.total} goals completed
            </span>
          </div>
        )}
      </div>

      {/* THIS WEEK'S GOALS — real tracking */}
      <div className="kCard kFadeUp" style={cardStyle({ marginTop: 18, animationDelay: "60ms" })}>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20, marginBottom: 4 }}>
          This week's goals
        </h3>
        <p style={{ color: C.soilSoft, fontSize: 13.5, marginBottom: 16 }}>
          Small steps you'll take this week. Check them off as you go — your Life Score follows.
        </p>

        {/* add goal */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: weekGoals.length ? 18 : 4 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Input placeholder="e.g. Latihan IELTS 3x, lari 2x…" value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }} />
          </div>
          <select value={newArea} onChange={(e) => setNewArea(e.target.value)}
            style={{ boxSizing: "border-box", padding: "13px 12px", borderRadius: 12,
              border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
              fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
            {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <Btn small onClick={addGoal} disabled={!newGoal.trim()}>Add</Btn>
        </div>

        {/* goal list */}
        {weekGoals.map((g) => {
          const a = AREAS.find((x) => x.key === g.area) || AREAS[0];
          return (
            <div key={g.id} className="kRow" style={{ display: "flex", alignItems: "center",
              gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <button onClick={() => toggleGoal(g.id)} className="kBtn" style={{
                width: 22, height: 22, borderRadius: 99, cursor: "pointer", flexShrink: 0,
                border: `2px solid ${g.done ? C.sage : C.line}`,
                background: g.done ? C.sage : "transparent",
                color: C.paper, fontSize: 13, fontWeight: 700, lineHeight: "18px",
                padding: 0, fontFamily: "inherit" }}>
                {g.done ? "✓" : ""}
              </button>
              <span style={{ flex: 1, fontSize: 14.5,
                textDecoration: g.done ? "line-through" : "none",
                color: g.done ? C.soilSoft : C.soil }}>{g.title}</span>
              <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase",
                color: a.color, fontWeight: 600 }}>{a.label}</span>
              <button onClick={() => removeGoal(g.id)} className="kBtn" style={{
                background: "transparent", border: "none", color: C.soilSoft, cursor: "pointer",
                fontSize: 16, opacity: 0.45, padding: "0 2px" }}>×</button>
            </div>
          );
        })}
        {weekGoals.length === 0 && (
          <p style={{ color: C.soilSoft, fontStyle: "italic", fontFamily: "'Fraunces',serif",
            fontSize: 15, marginTop: 10 }}>
            No goals yet this week. Add one small thing — momentum starts there.
          </p>
        )}
      </div>

      {/* NEXT MILESTONE quick action */}
      {nextMs && (
        <div className="kCard kFadeUp" style={cardStyle({ marginTop: 18, animationDelay: "90ms",
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" })}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Eyebrow>Next milestone</Eyebrow>
            <p style={{ fontFamily: "'Fraunces',serif", fontSize: 17, marginTop: 6 }}>
              {nextMs.title} <span style={{ color: C.soilSoft, fontSize: 13 }}>· {nextMs.year}</span>
            </p>
          </div>
          <Btn small onClick={() => toggleStep(nextMs.id)}>Mark as done ✓</Btn>
        </div>
      )}

      {/* Life Score — REAL */}
      <div className="kCard kFadeUp" style={cardStyle({ marginTop: 18, animationDelay: "120ms" })}>
        <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
          <ScoreRing value={overall} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <Eyebrow>Life Alignment</Eyebrow>
            <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 22,
              margin: "8px 0 6px" }}>
              How close is your week to your life?
            </h3>
            <p style={{ color: C.soilSoft, fontSize: 14.5, lineHeight: 1.6 }}>
              Computed from your real progress — milestones done and weekly goals checked.
              Not a grade. A compass.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 24, borderTop: `1px solid ${C.line}`, paddingTop: 22 }}>
          {AREAS.map((a, i) => {
            const ms = roadmap.filter((r) => r.area === a.key);
            const msDone = ms.filter((r) => r.done).length;
            return (
              <div key={a.key} className="kRow" style={{ marginBottom: 15 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{a.label}
                    {ms.length > 0 && <span style={{ color: C.soilSoft, fontWeight: 400,
                      fontSize: 11.5 }}> · {msDone}/{ms.length} milestones</span>}
                  </span>
                  <span style={{ color: C.soilSoft }}>{scores[a.key]}</span>
                </div>
                <div style={{ height: 8, background: C.line, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    width: scores[a.key] + "%", height: "100%", background: a.color, borderRadius: 99,
                    animation: "kGrow .9s cubic-bezier(.22,.61,.36,1) forwards",
                    animationDelay: `${i * 80 + 150}ms`,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: 14, fontSize: 13.5, color: C.soilSoft, lineHeight: 1.6 }}>
          <strong style={{ color: lowest.color }}>{lowest.label}</strong> has the most room to grow.
          Small, steady weeks move this the most.
        </p>
      </div>
    </div>
  );
}

function buildReflection(name, week, lowest, roadmap, nextMs, msDoneCount) {
  const who = name || "You";
  if (roadmap.length === 0 && week.total === 0) {
    return {
      headline: `${who} lived another week — but KALA doesn't know where you're headed yet.`,
      body: "Add a goal in Plans, or set a few small goals for this week below. Then these reflections become personal.",
    };
  }
  if (week.total === 0) {
    return {
      headline: `Your plan has ${roadmap.length} milestone${roadmap.length !== 1 ? "s" : ""} — now break this week down.`,
      body: nextMs
        ? `Your next milestone is "${nextMs.title}" (${nextMs.year}). What's one small thing you can do this week to move toward it? Add it below.`
        : `All ${msDoneCount} milestones are done — incredible. Time to design what's next.`,
    };
  }
  const pctDone = week.total ? week.done / week.total : 0;
  const headline =
    pctDone >= 1 ? `${who} completed all ${week.total} goals this week. Exceptional.` :
    pctDone >= 0.6 ? `${who} completed ${week.done} of ${week.total} goals — solid momentum.` :
    week.done > 0 ? `${who} completed ${week.done} of ${week.total} goals — progress is progress.` :
    `No goals checked yet this week — there's still time.`;
  const body = nextMs
    ? `Your next milestone is "${nextMs.title}" (${nextMs.year}). ${msDoneCount > 0 ? `You've already completed ${msDoneCount} milestone${msDoneCount !== 1 ? "s" : ""} on this plan. ` : ""}The ${lowest.label.toLowerCase()} area is the quietest — worth a small goal there next week.`
    : `All milestones on this plan are done. The ${lowest.label.toLowerCase()} area could use attention — or it's time for a new plan.`;
  return { headline, body };
}

// animated circular score ring
function ScoreRing({ value }) {
  const r = 52, c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf, start;
    const dur = 1100;
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
      <svg width="132" height="132" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="66" cy="66" r={r} fill="none" stroke={C.line} strokeWidth="10" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={C.clay} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={c}
          style={{ "--target": off, strokeDashoffset: c, animation: "kDraw 1.1s cubic-bezier(.22,.61,.36,1) forwards" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'Fraunces',serif", fontSize: 38, fontWeight: 600, lineHeight: 1, color: C.soil }}>{shown}</span>
        <span style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: C.soilSoft, marginTop: 4 }}>/ 100</span>
      </div>
    </div>
  );
}

// ---------- AI ARCHITECT ----------
function ArchitectView({ age, roadmap, setRoadmap, seed, onApplied,
  plans, setPlans, activePlan, setActivePlan, toggleStep, editStep }) {
  const [goal, setGoal] = useState(seed || "");
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState([]);
  const [mode, setMode] = useState("ai"); // ai | manual
  const [renaming, setRenaming] = useState(null);

  const current = plans.find((p) => p.id === activePlan) || plans[0];

  const [usedAI, setUsedAI] = useState(false);

  const run = async () => {
    if (!goal.trim()) return;
    setThinking(true);
    setDraft([]);
    setUsedAI(false);
    try {
      const steps = await generateRoadmapAI(goal, age);
      if (steps && steps.length) { setDraft(steps); setUsedAI(true); }
      else setDraft(generateRoadmap(goal, age));
    } catch (e) {
      // graceful fallback to offline generator
      setDraft(generateRoadmap(goal, age));
    }
    setThinking(false);
  };

  const apply = () => {
    // append generated steps to active plan
    setRoadmap((prev) => [...prev, ...draft].sort((a, b) => a.year - b.year));
    setDraft([]);
    onApplied();
  };

  // plan management
  const addPlan = () => {
    const letter = String.fromCharCode(65 + plans.length); // A, B, C...
    const id = Date.now();
    setPlans([...plans, { id, name: `Plan ${letter}`, steps: [] }]);
    setActivePlan(id);
  };
  const deletePlan = (id) => {
    if (plans.length === 1) return;
    const next = plans.filter((p) => p.id !== id);
    setPlans(next);
    if (activePlan === id) setActivePlan(next[0].id);
  };
  const renamePlan = (id, name) => setPlans(plans.map((p) => p.id === id ? { ...p, name } : p));

  const removeStep = (stepId) => setRoadmap((prev) => prev.filter((s) => s.id !== stepId));

  return (
    <div>
      {/* ---- PLAN MANAGER ---- */}
      <Card>
        <Eyebrow>Your Plans</Eyebrow>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(20px,3.6vw,26px)",
          letterSpacing: "-.01em", margin: "8px 0 6px" }}>
          Life rarely goes one way. Keep a few.
        </h3>
        <p style={{ color: C.soilSoft, fontSize: 14.5, marginBottom: 18 }}>
          Build Plan A. If it stops fitting, switch to B or C — your timeline follows the active plan.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {plans.map((p) => {
            const on = p.id === activePlan;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {renaming === p.id ? (
                  <input autoFocus defaultValue={p.name}
                    onBlur={(e) => { renamePlan(p.id, e.target.value || p.name); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ width: 110, padding: "7px 12px", borderRadius: 99, fontSize: 13,
                      fontFamily: "inherit", border: `1px solid ${C.clay}`, outline: "none",
                      background: C.paper, color: C.soil }} />
                ) : (
                  <button className="kBtn" onClick={() => setActivePlan(p.id)}
                    onDoubleClick={() => setRenaming(p.id)}
                    style={{ padding: "8px 16px", borderRadius: 99, fontFamily: "inherit", fontSize: 13.5,
                      fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? C.clay : C.line}`,
                      background: on ? C.clay : "transparent", color: on ? C.paper : C.soilSoft }}>
                    {p.name} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {p.steps.length}</span>
                  </button>
                )}
                {on && plans.length > 1 && (
                  <button onClick={() => deletePlan(p.id)} className="kBtn" title="Delete plan"
                    style={{ background: "transparent", border: "none", color: C.soilSoft,
                      cursor: "pointer", fontSize: 16, padding: "0 2px" }}>×</button>
                )}
              </div>
            );
          })}
          <button onClick={addPlan} className="kBtn" style={{ padding: "8px 14px", borderRadius: 99,
            border: `1px dashed ${C.line}`, background: "transparent", color: C.clay, fontFamily: "inherit",
            fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>+ New plan</button>
        </div>
        <p style={{ fontSize: 12, color: C.soilSoft, marginTop: 12 }}>
          Double-tap a plan name to rename it. Editing below affects <strong>{current?.name}</strong>.
        </p>
      </Card>

      {/* ---- BUILD: AI or MANUAL ---- */}
      <Card style={{ marginTop: 18 }} delay={60}>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <Pill active={mode === "ai"} onClick={() => setMode("ai")}>AI Architect</Pill>
          <Pill active={mode === "manual"} onClick={() => setMode("manual")}>Add manually</Pill>
        </div>

        {mode === "ai" ? (
          <>
            <p style={{ color: C.soilSoft, fontSize: 14.5, marginBottom: 14 }}>
              Describe your ambition in plain words — KALA maps it into milestones. Works fully offline.
            </p>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Jadi corporate lawyer internasional & punya holding company sebelum umur 40. Sambil rutin olahraga."
              style={{ width: "100%", boxSizing: "border-box", minHeight: 90, padding: "14px 16px",
                borderRadius: 12, border: `1px solid ${C.line}`, background: C.bg, color: C.soil,
                fontFamily: "inherit", fontSize: 15, resize: "vertical", outline: "none" }} />
            <div style={{ marginTop: 14 }}>
              <Btn onClick={run} disabled={!goal.trim() || thinking}>
                {thinking ? "Mapping your years…" : "Generate milestones"}
              </Btn>
            </div>
          </>
        ) : (
          <ManualGoal age={age} onAdd={(step) => {
            setRoadmap((prev) => [...prev, step].sort((a, b) => a.year - b.year));
          }} />
        )}
      </Card>

      {/* AI draft preview */}
      {draft.length > 0 && (
        <Card style={{ marginTop: 18 }} delay={60}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20 }}>Suggested milestones</h3>
              <span style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
                fontWeight: 600, padding: "3px 9px", borderRadius: 99,
                background: usedAI ? C.clay : C.line, color: usedAI ? C.paper : C.soilSoft }}>
                {usedAI ? "✦ AI" : "Offline"}
              </span>
            </div>
            <Btn small onClick={apply}>Add to {current?.name} →</Btn>
          </div>
          <Timeline steps={draft} />
        </Card>
      )}

      {/* CURRENT PLAN CONTENTS */}
      <Card style={{ marginTop: 18 }} delay={120}>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20, marginBottom: 16 }}>
          {current?.name} — {roadmap.length} milestone{roadmap.length !== 1 ? "s" : ""}
        </h3>
        {roadmap.length === 0 ? (
          <EmptyState
            title="A life takes shape one step at a time"
            body="Tell KALA where you want to go, and it'll map the milestones onto your weeks ahead. Generate with AI, or add one yourself."
          />
        ) : (
          <Timeline steps={roadmap} onRemove={removeStep} onToggle={toggleStep} onEdit={editStep} />
        )}
      </Card>
    </div>
  );
}

function ManualGoal({ age, onAdd }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear + 1);
  const [area, setArea] = useState("career");
  const [title, setTitle] = useState("");
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: 96 }}>
          <Label>Year</Label>
          <Input type="number" value={year} min={thisYear}
            onChange={(e) => setYear(+e.target.value)} />
        </div>
        <div style={{ minWidth: 130 }}>
          <Label>Area</Label>
          <select value={area} onChange={(e) => setArea(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "13px 12px", borderRadius: 12,
              border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
              fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
            {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Label>Milestone</Label>
          <Input placeholder="e.g. Pindah ke posisi manajer" value={title}
            onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <Btn onClick={() => {
          if (!title.trim()) return;
          onAdd({ id: Date.now(), year, area, title: title.trim(), age: age + (year - thisYear) });
          setTitle("");
        }} disabled={!title.trim()}>Add milestone</Btn>
      </div>
    </div>
  );
}

function Timeline({ steps, onRemove, onToggle, onEdit }) {
  const [editing, setEditing] = useState(null);
  return (
    <div style={{ position: "relative", paddingLeft: 8 }}>
      {steps.map((s, i) => {
        const area = AREAS.find((a) => a.key === s.area) || AREAS[0];
        const isEditing = editing === s.id;
        return (
          <div key={s.id} className="kRow kFadeUp" style={{ display: "flex", gap: 14,
            paddingBottom: i === steps.length - 1 ? 0 : 22, position: "relative", animationDelay: `${i * 60}ms` }}>
            {i !== steps.length - 1 && (
              <div style={{ position: "absolute", left: 6, top: 16, bottom: 0, width: 2, background: C.line }} />
            )}
            {onToggle && !isEditing ? (
              <button onClick={() => onToggle(s.id)} className="kBtn" title={s.done ? "Mark as not done" : "Mark as done"}
                style={{ width: 20, height: 20, borderRadius: 99, cursor: "pointer", flexShrink: 0,
                  marginTop: 1, zIndex: 1, padding: 0, fontFamily: "inherit",
                  border: `2px solid ${s.done ? C.sage : area.color}`,
                  background: s.done ? C.sage : C.paper,
                  color: C.paper, fontSize: 11, fontWeight: 700, lineHeight: "16px" }}>
                {s.done ? "✓" : ""}
              </button>
            ) : (
              <div style={{ width: 14, height: 14, borderRadius: 99, background: area.color,
                marginTop: 3, flexShrink: 0, zIndex: 1 }} />
            )}

            {isEditing ? (
              <EditRow step={s} onSave={(patch) => { onEdit(s.id, patch); setEditing(null); }}
                onCancel={() => setEditing(null)} />
            ) : (
              <>
                <div style={{ flex: 1, cursor: onEdit ? "pointer" : "default" }}
                  onClick={() => onEdit && setEditing(s.id)}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'Fraunces',serif", fontSize: 17, fontWeight: 600,
                      color: s.done ? C.soilSoft : C.soil }}>{s.year}</span>
                    <span style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase",
                      color: s.done ? C.sage : area.color, fontWeight: 600 }}>
                      {s.done ? "Done" : area.label}</span>
                    {s.age != null && <span style={{ fontSize: 12, color: C.soilSoft }}>· age {s.age}</span>}
                  </div>
                  <div style={{ fontSize: 15, marginTop: 2,
                    textDecoration: s.done ? "line-through" : "none",
                    color: s.done ? C.soilSoft : C.soil }}>{s.title}</div>
                </div>
                {onEdit && (
                  <button onClick={() => setEditing(s.id)} className="kBtn" title="Edit"
                    style={{ background: "transparent", border: "none", color: C.soilSoft,
                      cursor: "pointer", fontSize: 13, opacity: 0.6, padding: "0 2px",
                      height: "fit-content" }}>✎</button>
                )}
                {onRemove && (
                  <button onClick={() => onRemove(s.id)} className="kBtn" style={{ background: "transparent",
                    border: "none", color: C.soilSoft, cursor: "pointer", fontSize: 17, opacity: 0.5,
                    padding: "0 4px", height: "fit-content" }}>×</button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditRow({ step, onSave, onCancel }) {
  const [year, setYear] = useState(step.year);
  const [area, setArea] = useState(step.area);
  const [title, setTitle] = useState(step.title);
  return (
    <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input type="number" value={year} onChange={(e) => setYear(+e.target.value)}
          style={{ width: 80, boxSizing: "border-box", padding: "9px 10px", borderRadius: 9,
            border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
            fontFamily: "inherit", fontSize: 14, outline: "none" }} />
        <select value={area} onChange={(e) => setArea(e.target.value)}
          style={{ boxSizing: "border-box", padding: "9px 10px", borderRadius: 9,
            border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
            fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
          {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) onSave({ year, area, title: title.trim() }); }}
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
          border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
          fontFamily: "inherit", fontSize: 14.5, outline: "none", marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <Btn small onClick={() => title.trim() && onSave({ year, area, title: title.trim() })}>Save</Btn>
        <button onClick={onCancel} className="kBtn" style={{ background: "transparent",
          border: `1px solid ${C.line}`, borderRadius: 99, padding: "9px 16px", fontSize: 13.5,
          fontFamily: "inherit", fontWeight: 600, color: C.soilSoft, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// ============ TIER 3: SIMULATE ============
// Format rupiah ringkas
function rp(n) {
  if (n >= 1e9) return "Rp" + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(".0", "") + " M";
  if (n >= 1e6) return "Rp" + (n / 1e6).toFixed(0) + " jt";
  if (n >= 1e3) return "Rp" + (n / 1e3).toFixed(0) + "rb";
  return "Rp" + Math.round(n);
}

// Hitung pertumbuhan tabungan + bunga majemuk bulanan
function projectSavings({ monthly, annualReturn, target, maxMonths = 720 }) {
  const r = annualReturn / 100 / 12;
  let bal = 0;
  const yearly = [];
  let hitMonth = null;
  for (let m = 1; m <= maxMonths; m++) {
    bal = bal * (1 + r) + monthly;
    if (!hitMonth && bal >= target) hitMonth = m;
    if (m % 12 === 0) yearly.push({ year: m / 12, bal });
  }
  return { yearly, hitMonth, finalBal: bal };
}

// ---- ICS calendar export ----
function icsDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function downloadICS(events, filename) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KNSL//KALA//EN", "CALSCALE:GREGORIAN",
  ];
  events.forEach((ev, i) => {
    const end = new Date(ev.date); end.setDate(end.getDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:kala-${Date.now()}-${i}@knsl.tech`,
      `DTSTAMP:${icsDate(new Date())}T000000Z`,
      `DTSTART;VALUE=DATE:${icsDate(ev.date)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${ev.title}`,
      `DESCRIPTION:${ev.desc || "Placed on your life by KALA · kala.knsl.tech"}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function SimulateView({ age, lifeExp }) {
  const [mode, setMode] = useState("savings"); // savings | futures
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Pill active={mode === "savings"} onClick={() => setMode("savings")}>Financial</Pill>
        <Pill active={mode === "futures"} onClick={() => setMode("futures")}>Alternate Futures</Pill>
      </div>
      {mode === "savings" ? <SavingsSim age={age} /> : <AlternateFutures age={age} />}
    </div>
  );
}

// ---- Life Simulation Engine (financial) ----
function SavingsSim({ age }) {
  const [monthly, setMonthly] = useState(5_000_000);
  const [ret, setRet] = useState(7);
  const [target, setTarget] = useState(1_000_000_000);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    setTimeout(() => {
      setResult(projectSavings({ monthly, annualReturn: ret, target }));
      setBusy(false);
    }, 700);
  };

  const hitAge = result?.hitMonth ? age + result.hitMonth / 12 : null;

  return (
    <div>
      <Card>
        <Eyebrow>Life Simulation Engine</Eyebrow>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(22px,4vw,30px)",
          letterSpacing: "-.01em", margin: "8px 0 6px" }}>
          When will you reach your number?
        </h3>
        <p style={{ color: C.soilSoft, fontSize: 15, marginBottom: 22 }}>
          Adjust the numbers. KALA projects your path and places the milestone on your life.
        </p>

        <Field label="Save each month" value={rp(monthly)}>
          <input type="range" min="500000" max="50000000" step="500000" value={monthly}
            onChange={(e) => { setMonthly(+e.target.value); setResult(null); }}
            style={sliderStyle} />
        </Field>
        <Field label="Target amount" value={rp(target)}>
          <input type="range" min="100000000" max="10000000000" step="100000000" value={target}
            onChange={(e) => { setTarget(+e.target.value); setResult(null); }}
            style={sliderStyle} />
        </Field>
        <Field label="Expected annual return" value={ret + "% / year"}>
          <input type="range" min="0" max="15" step="0.5" value={ret}
            onChange={(e) => { setRet(+e.target.value); setResult(null); }}
            style={sliderStyle} />
          <p style={{ fontSize: 12, color: C.soilSoft, marginTop: 4 }}>
            0% = cash. ~4–7% = mixed investing. Higher carries more risk.
          </p>
        </Field>

        <div style={{ marginTop: 18 }}>
          <Btn onClick={run} disabled={busy}>{busy ? "Projecting…" : "Run simulation"}</Btn>
        </div>
      </Card>

      {result && (
        <Card style={{ marginTop: 18 }} delay={60}>
          {result.hitMonth ? (
            <div style={{ marginBottom: 22 }}>
              <Eyebrow>Result</Eyebrow>
              <p style={{ fontFamily: "'Fraunces',serif", fontSize: "clamp(22px,3.6vw,30px)",
                letterSpacing: "-.01em", margin: "8px 0 0", lineHeight: 1.25 }}>
                You hit <span style={{ color: C.clay }}>{rp(target)}</span> at{" "}
                <span style={{ color: C.clay }}>age {hitAge.toFixed(1)}</span>
                {" "}— in {(result.hitMonth / 12).toFixed(1)} years.
              </p>
            </div>
          ) : (
            <p style={{ fontFamily: "'Fraunces',serif", fontSize: 22, marginBottom: 20 }}>
              Not reached within 60 years. Try saving more or a higher return.
            </p>
          )}

          <SavingsChart yearly={result.yearly} target={target} />

          {/* milestone markers */}
          <div style={{ marginTop: 24, borderTop: `1px solid ${C.line}`, paddingTop: 18 }}>
            {[0.25, 0.5, 1].map((frac, i) => {
              const goal = target * frac;
              const hit = result.yearly.find((y) => y.bal >= goal);
              if (!hit) return null;
              return (
                <div key={i} className="kRow kFadeUp" style={{ display: "flex", justifyContent: "space-between",
                  padding: "9px 0", borderBottom: i < 2 ? `1px solid ${C.line}` : "none",
                  animationDelay: `${i * 90}ms`, fontSize: 14.5 }}>
                  <span style={{ color: C.soilSoft }}>Age {(age + hit.year).toFixed(0)}</span>
                  <span style={{ fontWeight: 600 }}>{rp(hit.bal)}</span>
                </div>
              );
            })}
          </div>

          {result.hitMonth && (
            <div style={{ marginTop: 22, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Btn small onClick={() => {
                const now = new Date();
                const events = [0.25, 0.5, 1].map((frac) => {
                  const goal = target * frac;
                  const hit = result.yearly.find((y) => y.bal >= goal);
                  if (!hit) return null;
                  const d = new Date(now); d.setFullYear(d.getFullYear() + hit.year);
                  return {
                    date: d,
                    title: `KALA milestone — ${rp(goal)} ${frac === 1 ? "🎉 (target!)" : "saved"}`,
                    desc: `Projected by KALA: saving ${rp(monthly)}/month at ${ret}%/yr. kala.knsl.tech`,
                  };
                }).filter(Boolean);
                downloadICS(events, "kala-milestones.ics");
              }}>
                Add to calendar (.ics)
              </Btn>
              <span style={{ fontSize: 12.5, color: C.soilSoft }}>
                Works with Apple, Google &amp; Outlook calendars — one click.
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function SavingsChart({ yearly, target }) {
  const max = Math.max(target, yearly[yearly.length - 1]?.bal || target);
  const show = yearly.filter((_, i) => i % Math.ceil(yearly.length / 24) === 0 || i === yearly.length - 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140,
        borderBottom: `1px solid ${C.line}`, paddingTop: 8 }}>
        {show.map((y, i) => {
          const h = (y.bal / max) * 100;
          const reached = y.bal >= target;
          return (
            <div key={i} title={`Year ${y.year}: ${rp(y.bal)}`}
              style={{ flex: 1, height: h + "%", minHeight: 2, borderRadius: "3px 3px 0 0",
                background: reached ? C.clay : C.past,
                transformOrigin: "bottom", animation: "kBarGrow .7s cubic-bezier(.22,.61,.36,1) forwards",
                animationDelay: `${i * 28}ms`, transform: "scaleY(0)" }} />
          );
        })}
      </div>
      <style>{`@keyframes kBarGrow{to{transform:scaleY(1)}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11.5, color: C.soilSoft }}>
        <span>Now</span><span>{show[show.length - 1]?.year} years</span>
      </div>
    </div>
  );
}

// ---- Alternate Futures ----
const FUTURE_PRESETS = [
  { id: "a", label: "Stay in Indonesia", income: 18_000_000, growth: 6, color: "#8A4A2C",
    notes: ["Stable career path", "Lower cost of living", "Family & network nearby"] },
  { id: "b", label: "WHV New Zealand", income: 42_000_000, growth: 4, color: "#5C6B47",
    notes: ["Higher earning, short term", "Global experience", "Currency advantage"] },
  { id: "c", label: "Master's in Netherlands", income: 30_000_000, growth: 9, color: "#4A6A7A",
    notes: ["Cost upfront, payoff later", "Strong long-term ceiling", "International doors open"] },
];

function AlternateFutures({ age }) {
  const years = 10;
  const projections = FUTURE_PRESETS.map((f) => {
    let income = f.income, total = 0;
    const path = [];
    for (let y = 1; y <= years; y++) {
      total += income * 12 * 0.25; // assume 25% saved
      income = income * (1 + f.growth / 100);
      path.push(total);
    }
    return { ...f, path, finalSaved: total, finalIncome: income };
  });
  const maxVal = Math.max(...projections.map((p) => p.finalSaved));

  return (
    <div>
      <Card>
        <Eyebrow>Alternate Futures</Eyebrow>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(22px,4vw,30px)",
          letterSpacing: "-.01em", margin: "8px 0 6px" }}>
          Three lives, side by side.
        </h3>
        <p style={{ color: C.soilSoft, fontSize: 15, marginBottom: 8 }}>
          A 10-year projection of where each path could take you — from age {age} to {age + years}.
        </p>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, marginTop: 16 }}>
        {projections.map((p, idx) => (
          <Card key={p.id} delay={idx * 90} style={{ borderTop: `3px solid ${p.color}` }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 600, marginBottom: 4 }}>
              Future {p.id.toUpperCase()}
            </div>
            <div style={{ fontSize: 14, color: p.color, fontWeight: 600, marginBottom: 16 }}>{p.label}</div>

            {/* mini growth bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 70, marginBottom: 16 }}>
              {p.path.map((v, i) => (
                <div key={i} style={{ flex: 1, height: (v / maxVal) * 100 + "%", minHeight: 2,
                  background: p.color, opacity: 0.35 + (i / p.path.length) * 0.65, borderRadius: "2px 2px 0 0",
                  transformOrigin: "bottom", animation: "kBarGrow .6s ease forwards",
                  animationDelay: `${idx * 90 + i * 30}ms`, transform: "scaleY(0)" }} />
              ))}
            </div>

            <Metric label="Saved in 10 yrs" value={rp(p.finalSaved)} accent={p.color} />
            <Metric label="Income by year 10" value={rp(p.finalIncome) + "/mo"} />

            <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              {p.notes.map((n, i) => (
                <div key={i} style={{ fontSize: 13, color: C.soilSoft, display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ color: p.color }}>•</span>{n}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 16, lineHeight: 1.6 }}>
        Projections assume 25% of income saved and steady growth. Real life varies — treat these as directional, not promises.
      </p>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: C.soilSoft }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 21, fontWeight: 600,
        color: accent || C.soil, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Field({ label, value, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.soilSoft }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.clay }}>{value}</span>
      </div>
      {children}
    </div>
  );
}

const sliderStyle = { width: "100%", accentColor: C.clay, cursor: "pointer" };

function Pill({ children, active, onClick }) {
  return (
    <button className="kBtn" onClick={onClick} style={{
      padding: "8px 18px", borderRadius: 99, fontFamily: "inherit", fontSize: 14, fontWeight: 600,
      cursor: "pointer", border: `1px solid ${active ? C.clay : C.line}`,
      background: active ? C.clay : "transparent", color: active ? C.paper : C.soilSoft,
    }}>{children}</button>
  );
}

// ============ TIER 4: MEMORY TIMELINE ============
function MemoryView({ profile, memories, setMemories, age }) {
  const [year, setYear] = useState("");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("career");

  const birthYear = profile.birth ? new Date(profile.birth).getFullYear() : 2000;
  const sorted = [...memories].sort((a, b) => a.year - b.year);

  const add = () => {
    if (!year || !title.trim()) return;
    setMemories([...memories, { id: Date.now(), year: +year, title: title.trim(), area }]);
    setYear(""); setTitle(""); setArea("career");
  };
  const remove = (id) => setMemories(memories.filter((m) => m.id !== id));

  return (
    <div>
      <Card>
        <Eyebrow>Memory Timeline</Eyebrow>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(22px,4vw,30px)",
          letterSpacing: "-.01em", margin: "8px 0 6px" }}>
          The Wikipedia of your life.
        </h3>
        <p style={{ color: C.soilSoft, fontSize: 15, marginBottom: 20 }}>
          Mark the moments that shaped you. They live on your timeline forever.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ width: 100 }}>
            <Label>Year</Label>
            <Input type="number" placeholder={birthYear + 18} value={year}
              onChange={(e) => setYear(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Label>What happened?</Label>
            <Input placeholder="e.g. Graduated, first job, moved abroad…" value={title}
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ minWidth: 130 }}>
            <Label>Area</Label>
            <select value={area} onChange={(e) => setArea(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "13px 12px", borderRadius: 12,
                border: `1px solid ${C.line}`, background: C.paper, color: C.soil,
                fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
              {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <Btn onClick={add} disabled={!year || !title.trim()}>Add</Btn>
        </div>
      </Card>

      <Card style={{ marginTop: 18 }} delay={60}>
        {sorted.length === 0 ? (
          <EmptyState
            title="Your story starts here"
            body="Mark the moments that shaped you — a first day, a goodbye, a turning point. They'll glow on your life grid."
          />
        ) : (
          <div style={{ position: "relative", paddingLeft: 6 }}>
            {sorted.map((m, i) => {
              const a = AREAS.find((x) => x.key === m.area) || AREAS[0];
              const memAge = m.year - birthYear;
              return (
                <div key={m.id} className="kRow kFadeUp" style={{ display: "flex", gap: 16,
                  paddingBottom: i === sorted.length - 1 ? 0 : 22, position: "relative",
                  animationDelay: `${i * 60}ms` }}>
                  {i !== sorted.length - 1 && (
                    <div style={{ position: "absolute", left: 6, top: 18, bottom: 0, width: 2, background: C.line }} />
                  )}
                  <div style={{ width: 14, height: 14, borderRadius: 99, background: a.color,
                    marginTop: 4, flexShrink: 0, zIndex: 1 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'Fraunces',serif", fontSize: 17, fontWeight: 600 }}>{m.year}</span>
                      <span style={{ fontSize: 12, color: C.soilSoft }}>· age {memAge}</span>
                      <span style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase",
                        color: a.color, fontWeight: 600 }}>{a.label}</span>
                    </div>
                    <div style={{ fontSize: 15, marginTop: 2 }}>{m.title}</div>
                  </div>
                  <button onClick={() => remove(m.id)} className="kBtn" style={{
                    background: "transparent", border: "none", color: C.soilSoft, cursor: "pointer",
                    fontSize: 18, opacity: 0.5, padding: "0 4px" }}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============ TIER 4: LIFE WRAPPED ============
// ============ WEEKLY NUDGE (visual, like a mini Wrapped) ============
// ============ MILESTONE CONSTELLATION (completion celebration) ============
function MilestoneConstellation({ milestone, doneCount, totalCount, onClose }) {
  const canvasRef = useRef(null);
  const area = AREAS.find((a) => a.key === milestone.area) || AREAS[0];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // generate stars (one per completed milestone, min 5)
    const n = Math.max(doneCount, 5);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.32;
    const stars = Array.from({ length: n }).map((_, i) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const jitter = 0.7 + Math.random() * 0.5;
      return { x: cx + Math.cos(ang) * R * jitter, y: cy + Math.sin(ang) * R * jitter,
        r: 1.5 + Math.random() * 2.5, tw: Math.random() * Math.PI * 2 };
    });

    let start = null;
    const dur = 2600;
    let raf;
    const draw = (ts) => {
      if (!start) start = ts;
      const t = (ts - start) / dur;
      const p = Math.min(1, t);
      ctx.clearRect(0, 0, W, H);

      // connecting lines (draw progressively)
      const linesToShow = Math.floor(p * stars.length);
      ctx.strokeStyle = area.color;
      ctx.globalAlpha = 0.35 * p;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < linesToShow && i < stars.length - 1; i++) {
        ctx.moveTo(stars[i].x, stars[i].y);
        ctx.lineTo(stars[i + 1].x, stars[i + 1].y);
      }
      ctx.stroke();

      // stars
      stars.forEach((s, i) => {
        const appear = Math.min(1, Math.max(0, (p * stars.length - i)));
        const tw = 0.6 + 0.4 * Math.sin(ts / 300 + s.tw);
        ctx.globalAlpha = appear * tw;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * appear, 0, Math.PI * 2);
        ctx.fillStyle = area.color;
        ctx.shadowColor = area.color; ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;

      if (t < 3) raf = requestAnimationFrame(draw); // keep twinkling a bit
    };
    raf = requestAnimationFrame(draw);
    const auto = setTimeout(onClose, 3600);
    return () => { cancelAnimationFrame(raf); clearTimeout(auto); };
  }, []);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70,
      background: "rgba(28,21,16,.78)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "kFadeIn .4s ease" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div style={{ position: "relative", textAlign: "center", padding: 30, maxWidth: 420 }}>
        <div style={{ fontSize: 12, letterSpacing: ".28em", textTransform: "uppercase",
          color: area.color, fontWeight: 700, marginBottom: 14 }}>Milestone reached</div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 32,
          lineHeight: 1.2, color: "#F4ECDD", letterSpacing: "-.01em", marginBottom: 14 }}>
          {milestone.title}
        </h2>
        <p style={{ color: "rgba(244,236,221,.75)", fontSize: 15, lineHeight: 1.6 }}>
          That's <strong style={{ color: area.color }}>{doneCount}</strong> of {totalCount} milestones
          on your path — each one a star in the life you're building.
        </p>
        <button onClick={onClose} className="kBtn" style={{ marginTop: 24, background: area.color,
          border: "none", borderRadius: 99, padding: "12px 28px", fontFamily: "inherit",
          fontSize: 14.5, fontWeight: 700, color: "#1C1510", cursor: "pointer" }}>
          Keep going
        </button>
      </div>
    </div>
  );
}

function WeeklyNudge({ profile, lived, total, pct, roadmap, onReflect, onClose }) {
  const nextMs = roadmap.find((r) => !r.done);
  const remaining = total - lived;
  const COLS = 14, ROWS = 7;
  const cells = COLS * ROWS;
  const startIdx = Math.max(0, lived - Math.floor(cells / 2));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60,
      background: "rgba(46,32,24,.55)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      animation: "kFadeIn .3s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(440px,94vw)", borderRadius: 24, overflow: "hidden",
        background: `linear-gradient(160deg, ${C.soil} 0%, #43301F 55%, ${C.clay} 145%)`,
        color: "#F4ECDD", boxShadow: "0 40px 80px -30px rgba(0,0,0,.6)",
        animation: "kNudgeIn .5s cubic-bezier(.22,.61,.36,1)", position: "relative" }}>
        <style>{`
          @keyframes kNudgeIn{from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:none}}
          @keyframes kCellPop{0%{transform:scale(.3);opacity:0}100%{transform:scale(1);opacity:1}}
          @keyframes kNowGlow{0%,100%{box-shadow:0 0 0 0 rgba(224,164,92,0)}50%{box-shadow:0 0 14px 3px rgba(224,164,92,.55)}}
        `}</style>

        <div style={{ padding: "32px 30px 26px" }}>
          <div style={{ fontSize: 11.5, letterSpacing: ".26em", textTransform: "uppercase",
            opacity: 0.7, fontWeight: 600 }}>A new week · KALA</div>
          <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 30,
            lineHeight: 1.12, letterSpacing: "-.01em", margin: "12px 0 6px" }}>
            Another square,<br /><em style={{ fontStyle: "italic", color: C.amber }}>filled in.</em>
          </h2>
          <p style={{ fontSize: 14, opacity: 0.82, lineHeight: 1.55, margin: "0 0 22px" }}>
            Welcome back{profile.name ? `, ${profile.name}` : ""}. You've lived{" "}
            <strong style={{ color: C.amber }}>{fmt(lived + 1)}</strong> weeks —{" "}
            {fmt(remaining)} still ahead.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS},1fr)`, gap: 4,
            marginBottom: 22 }}>
            {Array.from({ length: cells }).map((_, i) => {
              const idx = startIdx + i;
              const isLived = idx < lived;
              const isNow = idx === lived;
              return (
                <span key={i} style={{
                  aspectRatio: "1", borderRadius: 2.5,
                  background: isNow ? C.amber : isLived ? "rgba(244,236,221,.7)" : "rgba(244,236,221,.16)",
                  animation: isNow
                    ? "kCellPop .5s cubic-bezier(.22,.61,.36,1) forwards, kNowGlow 2s ease-in-out .6s infinite"
                    : "kCellPop .4s ease forwards",
                  animationDelay: isNow ? "700ms" : `${i * 12}ms`,
                  opacity: 0,
                }} />
              );
            })}
          </div>

          <div style={{ background: "rgba(244,236,221,.08)", borderRadius: 14,
            padding: "16px 16px", marginBottom: 22 }}>
            {nextMs ? (
              <>
                <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase",
                  opacity: 0.65, fontWeight: 600, marginBottom: 6 }}>What this week is for</div>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 17, lineHeight: 1.4 }}>
                  Moving toward "{nextMs.title}" <span style={{ opacity: 0.6, fontSize: 14 }}>· {nextMs.year}</span>
                </div>
              </>
            ) : (
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16, lineHeight: 1.45 }}>
                You have no active milestone yet. This is a good week to set one.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={onReflect} className="kBtn" style={{ background: C.amber,
              border: "none", borderRadius: 99, padding: "13px 22px", fontFamily: "inherit",
              fontSize: 14.5, fontWeight: 700, color: C.soil, cursor: "pointer", flex: 1 }}>
              Plan this week →
            </button>
            <button onClick={onClose} className="kBtn" style={{ background: "transparent",
              border: "1px solid rgba(244,236,221,.3)", borderRadius: 99, padding: "13px 20px",
              fontFamily: "inherit", fontSize: 14.5, fontWeight: 600, color: "#F4ECDD",
              cursor: "pointer" }}>
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



function WrappedView({ profile, roadmap, memories, lived, total, age, pct }) {
  const year = new Date().getFullYear();
  const focusArea = profile.focus?.[0]
    ? AREAS.find((a) => a.key === profile.focus[0])
    : AREAS[0];
  const milestonesAhead = roadmap.filter((r) => r.year > year).length;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [themeIdx, setThemeIdx] = useState(0);
  const [headIdx, setHeadIdx] = useState(0);
  const [capIdx, setCapIdx] = useState(0);
  const [quoteOn, setQuoteOn] = useState(false);
  const [quoteIdx, setQuoteIdx] = useState(0);

  // Pool of stats that can appear on the card. The card shows 4 at a time and
  // they can be shuffled — including "weeks lived so far" and "weeks left in life".
  const remaining = Math.max(0, total - lived);
  const STAT_POOL = [
    { n: "52", l: "weeks lived this year" },
    { n: fmt(lived), l: "weeks lived so far" },
    { n: fmt(remaining), l: "weeks left in life" },
    { n: pct + "%", l: "of life so far" },
    { n: fmt(age), l: "years on earth" },
    { n: fmt(memories.length), l: "memories marked" },
    { n: fmt(milestonesAhead), l: "milestones ahead" },
  ];
  // Default selection mirrors the original card (this year / % / memories / milestones).
  const [statIdx, setStatIdx] = useState([0, 3, 5, 6]);
  const stats = statIdx.map((i) => STAT_POOL[i]);

  const wt = WRAPPED_THEMES[themeIdx];
  const head = WRAPPED_HEADLINES[headIdx];
  const cap = WRAPPED_CAPTIONS[capIdx];
  const quote = WRAPPED_QUOTES[quoteIdx];
  const nm = profile.name || "Your";
  const line1 = head[0].replace("{name}", nm + "'s").replace("Your's", "Your");
  const line2 = head[1].replace("{name}", nm + "'s").replace("Your's", "Your");

  // Pick 4 distinct stats at random from the pool.
  const shuffleStats = () => {
    const idxs = [...Array(STAT_POOL.length).keys()];
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    setStatIdx(idxs.slice(0, 4).sort((a, b) => a - b));
  };
  const shuffleQuote = () => setQuoteIdx(Math.floor(Math.random() * WRAPPED_QUOTES.length));
  // Randomize everything at once for a fresh look.
  const shuffleAll = () => {
    setThemeIdx(Math.floor(Math.random() * WRAPPED_THEMES.length));
    setHeadIdx(Math.floor(Math.random() * WRAPPED_HEADLINES.length));
    setCapIdx(Math.floor(Math.random() * WRAPPED_CAPTIONS.length));
    shuffleStats();
    shuffleQuote();
  };

  const data = {
    name: nm, year, pct, age, lived,
    memories: memories.length, milestones: milestonesAhead,
    focus: focusArea.label, intention: profile.intention,
    line1, line2, caption: cap, theme: wt,
    stats, quote: quoteOn ? quote : null,
  };

  const doExport = async (share) => {
    setBusy(true); setNote("");
    try {
      const blob = await renderWrappedImage(data);
      const file = new File([blob], `kala-wrapped-${year}.png`, { type: "image/png" });
      if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "My KALA Wrapped",
          text: `My ${year} in weeks — designed with KALA.` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `kala-wrapped-${year}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        if (share) setNote("Sharing isn't available on this device — saved the image instead.");
      }
    } catch (e) { setNote("Couldn't generate the image. Try again."); console.error(e); }
    setBusy(false);
  };

  const tcol = wt.lightText ? wt.text : wt.text; // text on gradient
  const gradCss = `linear-gradient(155deg, ${wt.grad[0]} 0%, ${wt.grad[1]} 60%, ${wt.grad[2]} 140%)`;

  return (
    <div>
      {/* hero wrapped card (live preview, reflects chosen theme) */}
      <div className="kCard" style={{
        background: gradCss, color: wt.text, border: "none", borderRadius: 22, padding: "38px 30px",
        boxShadow: "0 28px 60px -34px rgba(0,0,0,.6)", overflow: "hidden", position: "relative",
      }}>
        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ fontSize: 12, letterSpacing: ".28em", textTransform: "uppercase",
            color: wt.soft, fontWeight: 600 }}>KALA Wrapped · {year}</div>
          <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
            fontSize: "clamp(30px,6vw,52px)", lineHeight: 1.05, letterSpacing: "-.02em",
            margin: "16px 0 8px" }}>
            {line1}<br /><em style={{ fontStyle: "italic", color: wt.accent }}>{line2}</em>
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
            gap: 20, marginTop: 30 }}>
            {stats.map((s, i) => (
              <WStat key={i} n={s.n} l={s.l} soft={wt.soft} />
            ))}
          </div>

          <div style={{ marginTop: 30, paddingTop: 22, borderTop: `1px solid ${wt.soft}` }}>
            <div style={{ fontSize: 13, color: wt.soft, marginBottom: 6 }}>Your focus this year</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 600, color: wt.accent }}>
              {focusArea.label}
            </div>
          </div>

          {profile.intention && (
            <p style={{ marginTop: 24, fontFamily: "'Fraunces',serif", fontStyle: "italic",
              fontSize: 18, lineHeight: 1.5, color: wt.text, opacity: 0.92 }}>
              "{profile.intention}"
            </p>
          )}
          {quoteOn && (
            <p style={{ marginTop: 20, paddingLeft: 14, borderLeft: `2px solid ${wt.accent}`,
              fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 17,
              lineHeight: 1.5, color: wt.accent }}>
              "{quote}"
            </p>
          )}
          <div style={{ marginTop: 22, fontSize: 12.5, color: wt.soft }}>{cap}</div>
        </div>

        <div style={{ position: "absolute", top: -10, right: -10, display: "grid",
          gridTemplateColumns: "repeat(8,10px)", gap: 4, opacity: 0.14 }}>
          {Array.from({ length: 64 }).map((_, i) => (
            <span key={i} style={{ width: 10, height: 10, borderRadius: 2,
              background: i % 3 === 0 ? wt.accent : wt.text }} />
          ))}
        </div>
      </div>

      {/* THEME PICKER — 10 options */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
          color: C.soilSoft, fontWeight: 600, marginBottom: 10 }}>Theme</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {WRAPPED_THEMES.map((t, i) => (
            <button key={t.key} onClick={() => setThemeIdx(i)} className="kBtn" title={t.label}
              style={{ width: 44, height: 44, borderRadius: 12, cursor: "pointer", padding: 0,
                border: `2px solid ${themeIdx === i ? C.clay : "transparent"}`,
                background: `linear-gradient(135deg, ${t.grad[0]}, ${t.grad[1]} 55%, ${t.grad[2]})`,
                position: "relative", outline: themeIdx === i ? `1px solid ${C.clay}` : "none" }}>
              <span style={{ position: "absolute", bottom: 4, right: 4, width: 8, height: 8,
                borderRadius: 99, background: t.accent }} />
            </button>
          ))}
        </div>
      </div>

      {/* TEXT VARIANTS */}
      <div style={{ marginTop: 18, display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
            color: C.soilSoft, fontWeight: 600, marginBottom: 8 }}>Headline</div>
          <Btn small variant="ghost" onClick={() => setHeadIdx((headIdx + 1) % WRAPPED_HEADLINES.length)}>
            Shuffle headline ↻
          </Btn>
        </div>
        <div>
          <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
            color: C.soilSoft, fontWeight: 600, marginBottom: 8 }}>Caption</div>
          <Btn small variant="ghost" onClick={() => setCapIdx((capIdx + 1) % WRAPPED_CAPTIONS.length)}>
            Shuffle caption ↻
          </Btn>
        </div>
        <div>
          <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
            color: C.soilSoft, fontWeight: 600, marginBottom: 8 }}>Stats</div>
          <Btn small variant="ghost" onClick={shuffleStats}>
            Shuffle stats ↻
          </Btn>
        </div>
        <div>
          <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
            color: C.soilSoft, fontWeight: 600, marginBottom: 8 }}>Quote</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small variant="ghost" onClick={() => setQuoteOn((v) => !v)}>
              {quoteOn ? "Quote on ✓" : "Add quote +"}
            </Btn>
            <Btn small variant="ghost" disabled={!quoteOn}
              onClick={() => setQuoteIdx((quoteIdx + 1) % WRAPPED_QUOTES.length)}>
              Shuffle quote ↻
            </Btn>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <Btn variant="ghost" onClick={shuffleAll}>Shuffle everything ↻</Btn>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
        <Btn onClick={() => doExport(true)} disabled={busy}>
          {busy ? "Creating image…" : "Share my Wrapped"}
        </Btn>
        <Btn variant="ghost" onClick={() => doExport(false)} disabled={busy}>Download image</Btn>
        <Btn variant="ghost" onClick={async () => {
          const url = buildShareURL(profile);
          try {
            if (navigator.share) await navigator.share({ title: "My life in weeks · KALA", url });
            else { await navigator.clipboard.writeText(url); setNote("Public link copied to clipboard."); }
          } catch { try { await navigator.clipboard.writeText(url); setNote("Public link copied."); } catch {} }
        }}>Copy public link</Btn>
      </div>
      {note && <p style={{ fontSize: 12.5, color: C.clay, marginTop: 10 }}>{note}</p>}
      <p style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 14, lineHeight: 1.6 }}>
        Pick a theme and shuffle the words, then export a ready-to-post image (1080×1920).
      </p>
    </div>
  );
}

// Render the Wrapped card to a portrait PNG (1080x1920) via canvas, themed.
function renderWrappedImage(d) {
  return new Promise((resolve, reject) => {
    const W = 1080, H = 1920;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d");
    const th = d.theme;

    // bg gradient from theme
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, th.grad[0]); g.addColorStop(0.6, th.grad[1]); g.addColorStop(1, th.grad[2]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    // faint grid texture top-right
    x.globalAlpha = 0.12;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 12; c++) {
      x.fillStyle = (r + c) % 3 === 0 ? th.accent : th.text;
      x.fillRect(W - 12 * 34 + c * 34, 40 + r * 34, 22, 22);
    }
    x.globalAlpha = 1;

    const PAD = 96;
    const accent = th.accent, cream = th.text, soft = th.soft;

    const draw = () => {
      x.fillStyle = soft; x.font = "600 26px 'Jakarta', sans-serif";
      x.fillText(`KALA WRAPPED · ${d.year}`.toUpperCase(), PAD, 200);

      // headline (two lines, variant)
      x.fillStyle = cream; x.font = "500 90px 'Fraunces', serif";
      x.fillText(d.line1, PAD, 320);
      x.fillStyle = accent; x.font = "italic 500 90px 'Fraunces', serif";
      x.fillText(d.line2, PAD, 425);

      const stats = (d.stats && d.stats.length
        ? d.stats.map((s) => [String(s.n), s.l])
        : [
            ["52", "weeks lived this year"],
            [d.pct + "%", "of life so far"],
            [String(d.memories), "memories marked"],
            [String(d.milestones), "milestones ahead"],
          ]);
      const colX = [PAD, W / 2 + 20];
      const rowY = [640, 860];
      stats.forEach((s, i) => {
        const cx = colX[i % 2], cy = rowY[Math.floor(i / 2)];
        x.fillStyle = cream; x.font = "600 88px 'Fraunces', serif";
        x.fillText(s[0], cx, cy);
        x.fillStyle = soft; x.font = "400 27px 'Jakarta', sans-serif";
        x.fillText(s[1], cx, cy + 44);
      });

      x.strokeStyle = soft; x.lineWidth = 2;
      x.beginPath(); x.moveTo(PAD, 1010); x.lineTo(W - PAD, 1010); x.stroke();

      x.fillStyle = soft; x.font = "400 28px 'Jakarta', sans-serif";
      x.fillText("Your focus this year", PAD, 1080);
      x.fillStyle = accent; x.font = "600 60px 'Fraunces', serif";
      x.fillText(d.focus, PAD, 1150);

      let capY = 1280;
      if (d.intention) {
        x.fillStyle = cream;
        x.font = "italic 500 40px 'Fraunces', serif";
        capY = wrapText(x, `"${d.intention}"`, PAD, 1280, W - PAD * 2, 56) + 70;
      }
      // optional reflective quote
      if (d.quote) {
        x.fillStyle = accent;
        x.font = "italic 500 38px 'Fraunces', serif";
        capY = wrapText(x, `"${d.quote}"`, PAD, Math.min(capY, H - 330), W - PAD * 2, 52) + 64;
      }
      // caption
      x.fillStyle = soft; x.font = "400 30px 'Jakarta', sans-serif";
      x.fillText(d.caption, PAD, Math.min(capY, H - 220));

      x.fillStyle = soft; x.font = "600 26px 'Jakarta', sans-serif";
      x.fillText("kala.knsl.tech · A product by KNSL", PAD, H - 110);

      cv.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
    };

    if (document.fonts && document.fonts.ready) {
      Promise.all([
        document.fonts.load("500 90px 'Fraunces'"),
        document.fonts.load("italic 500 90px 'Fraunces'"),
        document.fonts.load("600 88px 'Fraunces'"),
        document.fonts.load("600 26px 'Jakarta'"),
        document.fonts.load("400 27px 'Jakarta'"),
      ]).then(draw).catch(draw);
    } else { draw(); }
  });
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(" ");
  let line = "", yy = y;
  for (const w of words) {
    const test = line + w + " ";
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, yy); line = w + " "; yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line.trim(), x, yy);
  return yy; // return final y for caption placement
}

function WStat({ n, l, soft }) {
  return (
    <div>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 40, fontWeight: 600, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 12, color: soft || "rgba(255,255,255,.7)", marginTop: 6, lineHeight: 1.3 }}>{l}</div>
    </div>
  );
}

// ============ DIARY ============
function DiaryView({ profile, diary, setDiary, memories, setMemories }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");

  const sorted = [...diary].sort((a, b) => b.date.localeCompare(a.date));

  const save = () => {
    if (!text.trim()) return;
    setDiary([...diary, { id: Date.now(), date, text: text.trim() }]);
    setText(""); setDate(today);
  };
  const remove = (id) => setDiary(diary.filter((d) => d.id !== id));
  const pin = (entry) => {
    const year = +entry.date.slice(0, 4);
    const title = entry.text.length > 64 ? entry.text.slice(0, 61) + "…" : entry.text;
    setMemories([...memories, { id: Date.now(), year, title, area: "legacy" }]);
  };

  const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div>
      <Card>
        <Eyebrow>Diary</Eyebrow>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(22px,4vw,30px)",
          letterSpacing: "-.01em", margin: "8px 0 6px" }}>
          How was this week, {profile.name || "friend"}?
        </h3>
        <p style={{ color: C.soilSoft, fontSize: 15, marginBottom: 20 }}>
          Write freely. Small notes today become the story of your life later.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ width: 170 }}>
            <Label>Date</Label>
            <Input type="date" value={date} max={today}
              onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Hari ini aku…"
          style={{
            width: "100%", boxSizing: "border-box", minHeight: 120, padding: "14px 16px",
            borderRadius: 12, border: `1px solid ${C.line}`, background: C.bg, color: C.soil,
            fontFamily: "'Fraunces',serif", fontSize: 16.5, lineHeight: 1.6,
            resize: "vertical", outline: "none",
          }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 12, flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: C.soilSoft }}>
            {text.trim() ? text.trim().split(/\s+/).length + " words" : "Your page is waiting."}
          </span>
          <Btn onClick={save} disabled={!text.trim()}>Save entry</Btn>
        </div>
      </Card>

      {sorted.length > 0 && (
        <div style={{ marginTop: 18 }}>
          {sorted.map((d, i) => (
            <Card key={d.id} delay={i * 70} style={{ marginBottom: 14, padding: "22px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
                  color: C.clay, fontWeight: 600 }}>{fmtDate(d.date)}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => pin(d)} className="kBtn" title="Pin to Memory Timeline"
                    style={{ background: "transparent", border: `1px solid ${C.line}`, borderRadius: 99,
                      padding: "4px 12px", fontSize: 12, fontFamily: "inherit", fontWeight: 600,
                      color: C.soilSoft, cursor: "pointer" }}>
                    Pin to Memory
                  </button>
                  <button onClick={() => remove(d.id)} className="kBtn"
                    style={{ background: "transparent", border: "none", color: C.soilSoft,
                      cursor: "pointer", fontSize: 17, opacity: 0.5, padding: "0 4px" }}>×</button>
                </div>
              </div>
              <p style={{ fontFamily: "'Fraunces',serif", fontSize: 16.5, lineHeight: 1.65,
                whiteSpace: "pre-wrap" }}>{d.text}</p>
            </Card>
          ))}
        </div>
      )}

      {sorted.length === 0 && (
        <p style={{ textAlign: "center", color: C.soilSoft, padding: "34px 0",
          fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 17 }}>
          No entries yet. The first page is always the hardest — and the most important.
        </p>
      )}
    </div>
  );
}

// ============ SETTINGS ============


function PeopleView({ people, setPeople, lang }) {
  const [adding, setAdding] = useState(people.length === 0);

  const remove = (id) => setPeople(people.filter((p) => p.id !== id));

  return (
    <div>
      <Card>
        <Eyebrow>Time with</Eyebrow>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
          fontSize: "clamp(22px,4vw,30px)", lineHeight: 1.2, letterSpacing: "-.01em",
          margin: "10px 0 8px" }}>
          The people you love are<br /><em style={{ fontStyle: "italic", color: C.clay }}>also living in weeks.</em>
        </h2>
        <p style={{ color: C.soilSoft, fontSize: 15, lineHeight: 1.6 }}>
          KALA doesn't say this to sadden you — it says it so you'll pick up the phone.
          Add someone, and see the time you likely have left together.
        </p>
      </Card>

      {/* person cards */}
      {people.map((p, i) => (
        <PersonCard key={p.id} person={p} delay={i * 60} onRemove={() => remove(p.id)} />
      ))}

      {/* add form */}
      {adding ? (
        <AddPerson onAdd={(p) => { setPeople([...people, p]); setAdding(false); }}
          onCancel={people.length > 0 ? () => setAdding(false) : null} />
      ) : (
        <div style={{ marginTop: 16 }}>
          <Btn onClick={() => setAdding(true)}>+ Add someone</Btn>
        </div>
      )}

      {/* gentle care note */}
      {people.length > 0 && (
        <p style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 24, lineHeight: 1.6,
          textAlign: "center", maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
          These are rough estimates meant to inspire connection, not worry. If thinking about
          time with loved ones ever feels heavy, that's okay — be gentle with yourself, and
          reach out to someone you trust.
        </p>
      )}
    </div>
  );
}

function PersonCard({ person, onRemove, delay }) {
  const rel = RELATIONS.find((r) => r.key === person.relation) || RELATIONS[6];
  // weeks left = min(their remaining, your assumption) — here we use their life expectancy
  const theirWeeksLeft = Math.max(0, (person.theirLifeExp - person.theirAge) * 52);
  const meetsPerYear = person.perYear;
  const meetsLeft = Math.round((person.theirLifeExp - person.theirAge) * meetsPerYear);
  const yearsLeft = person.theirLifeExp - person.theirAge;

  // visual: dots representing remaining meetings (cap display at 200)
  const dotCount = Math.min(meetsLeft, 200);
  const capped = meetsLeft > 200;

  return (
    <div className="kCard kFadeUp" style={cardStyle({ marginTop: 16, animationDelay: `${delay}ms` })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 22, marginBottom: 4, color: rel.key === "partner" ? C.rose : C.clay }}>
            {rel.icon}
          </div>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 21 }}>{person.name}</h3>
          <div style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 2 }}>
            {rel.label} · {person.theirAge} years old · sees you ~{meetsPerYear}×/year
          </div>
        </div>
        <button onClick={onRemove} className="kBtn" style={{ background: "transparent", border: "none",
          color: C.soilSoft, cursor: "pointer", fontSize: 18, opacity: 0.4, padding: "0 4px" }}>×</button>
      </div>

      {/* the gut-punch number */}
      <div style={{ marginTop: 20, padding: "20px 0", borderTop: `1px solid ${C.line}`,
        borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 44,
            color: C.clay, lineHeight: 1 }}>{fmt(meetsLeft)}</span>
          <span style={{ fontSize: 15, color: C.soil }}>more times together,</span>
        </div>
        <p style={{ fontSize: 13.5, color: C.soilSoft, marginTop: 8, lineHeight: 1.5 }}>
          if you meet ~{meetsPerYear}× a year for the next {yearsLeft} years.
          That's about <strong style={{ color: C.soil }}>{fmt(Math.round(theirWeeksLeft))} weeks</strong> you
          may share — visible below.
        </p>
      </div>

      {/* dots */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 18 }}>
        {Array.from({ length: dotCount }).map((_, i) => (
          <span key={i} style={{ width: 11, height: 11, borderRadius: 99,
            background: rel.key === "partner" ? C.rose : C.clay,
            opacity: 0.25 + 0.75 * (1 - i / dotCount),
            animation: "kFadeUp .4s ease forwards", animationDelay: `${Math.min(i * 6, 600)}ms` }} />
        ))}
        {capped && <span style={{ fontSize: 12, color: C.soilSoft, alignSelf: "center",
          marginLeft: 4 }}>+{fmt(meetsLeft - 200)} more</span>}
      </div>

      <p style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 14,
        color: C.soilSoft, marginTop: 18, lineHeight: 1.5 }}>
        Each dot is one more time you could see {person.name.split(" ")[0]}. Make them count.
      </p>
    </div>
  );
}

function AddPerson({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("parent");
  const [theirAge, setTheirAge] = useState("");
  const [perYear, setPerYear] = useState(6);
  const rel = RELATIONS.find((r) => r.key === relation) || RELATIONS[6];
  const valid = name.trim() && theirAge && +theirAge > 0 && +theirAge < rel.defaultExp;

  const submit = () => {
    if (!valid) return;
    onAdd({ id: Date.now(), name: name.trim(), relation,
      theirAge: +theirAge, theirLifeExp: rel.defaultExp, perYear });
  };

  return (
    <div className="kCard kFadeUp" style={cardStyle({ marginTop: 16 })}>
      <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 19, marginBottom: 16 }}>
        Add someone you love
      </h3>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <Label>Their name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ibu, Dad, Sarah" />
        </div>
        <div>
          <Label>Relationship</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {RELATIONS.map((r) => (
              <button key={r.key} onClick={() => setRelation(r.key)} className="kBtn"
                style={{ padding: "8px 14px", borderRadius: 99, fontFamily: "inherit", fontSize: 13,
                  fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${relation === r.key ? C.clay : C.line}`,
                  background: relation === r.key ? C.clay : "transparent",
                  color: relation === r.key ? C.paper : C.soilSoft }}>
                {r.icon} {r.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <Label>Their age now</Label>
            <Input type="number" value={theirAge} min={0} max={rel.defaultExp - 1}
              onChange={(e) => setTheirAge(e.target.value)} placeholder="e.g. 58" />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <Label>Times you meet / year: {perYear}</Label>
            <input type="range" min={1} max={365} value={perYear}
              onChange={(e) => setPerYear(+e.target.value)}
              style={{ width: "100%", accentColor: C.clay, marginTop: 14 }} />
            <div style={{ fontSize: 11.5, color: C.soilSoft, marginTop: 2 }}>
              {perYear < 13 ? `about ${perYear}× a year` :
               perYear < 52 ? `a few times a month` :
               perYear < 200 ? `most weeks` : `almost daily`}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <Btn small onClick={submit} disabled={!valid}>See our time together</Btn>
        {onCancel && <Btn small variant="ghost" onClick={onCancel}>Cancel</Btn>}
      </div>
    </div>
  );
}

// ---------- LIVE CLOCK / DATE ----------
// A ticking "now" shared by the live date in the header, the countdowns,
// and the calendar's "today" highlight. Updates on an interval and cleans up.
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Quiet real-time date + clock for the top bar. Present but not loud:
// small, right-aligned, in the soft ink color so it informs without distracting.
function LiveClock({ lang }) {
  const now = useNow(1000);
  const locale = lang === "id" ? "id-ID" : "en-US";
  const dateStr = now.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const timeStr = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <div title={now.toLocaleString(locale)} aria-label={`${dateStr} ${timeStr}`}
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-end",
        lineHeight: 1.15, userSelect: "none" }}>
      <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, fontWeight: 600,
        letterSpacing: ".01em", color: C.soil }}>{timeStr}</span>
      <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
        color: C.soilSoft, marginTop: 1 }}>{dateStr}</span>
    </div>
  );
}

// ---------- DATE HELPERS (local-time, no timezone surprises) ----------
function parseLocalDate(str) {
  // "YYYY-MM-DD" → a Date at local midnight (avoids UTC off-by-one).
  const [y, m, d] = (str || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---------- COUNTDOWN VIEW ----------
function CountdownView({ countdowns, setCountdowns, lang }) {
  const [adding, setAdding] = useState(countdowns.length === 0);
  const remove = (id) => setCountdowns(countdowns.filter((c) => c.id !== id));
  // soonest first; past events sink to the bottom
  const sorted = useMemo(() => {
    const now = Date.now();
    return [...countdowns].sort((a, b) => {
      const ta = parseLocalDate(a.date)?.getTime() ?? 0;
      const tb = parseLocalDate(b.date)?.getTime() ?? 0;
      const pa = ta < now ? 1 : 0, pb = tb < now ? 1 : 0;
      return pa - pb || ta - tb;
    });
  }, [countdowns]);

  return (
    <div>
      <Card>
        <Eyebrow>Countdown</Eyebrow>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
          fontSize: "clamp(22px,4vw,30px)", lineHeight: 1.2, letterSpacing: "-.01em",
          margin: "10px 0 8px" }}>
          Got something planned?<br /><em style={{ fontStyle: "italic", color: C.clay }}>Watch it come closer.</em>
        </h2>
        <p style={{ color: C.soilSoft, fontSize: 15, lineHeight: 1.6 }}>
          A trip, a birthday, a deadline, a dream. Add a date and KALA counts down
          the days — so the things that matter stay in view.
        </p>
      </Card>

      {sorted.map((c, i) => (
        <CountdownCard key={c.id} item={c} delay={i * 60} lang={lang} onRemove={() => remove(c.id)} />
      ))}

      {adding ? (
        <AddCountdown lang={lang}
          onAdd={(c) => { setCountdowns([...countdowns, c]); setAdding(false); }}
          onCancel={countdowns.length > 0 ? () => setAdding(false) : null} />
      ) : (
        <div style={{ marginTop: 16 }}>
          <Btn onClick={() => setAdding(true)}>+ {tr("Add countdown", lang)}</Btn>
        </div>
      )}
    </div>
  );
}

function CountdownCard({ item, onRemove, delay, lang }) {
  const now = useNow(1000);
  const base = parseLocalDate(item.date);
  // target = end of the chosen day, so an event "today" still counts as today.
  const target = base ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999) : null;
  const ms = target ? target - now : 0;
  const past = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const secs = Math.floor((abs % 60000) / 1000);
  const isToday = !past && days === 0;
  const accent = past ? C.soilSoft : C.clay;
  const locale = lang === "id" ? "id-ID" : "en-US";
  const dateLabel = base ? base.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "—";

  const Part = ({ n, l }) => (
    <div style={{ textAlign: "center", minWidth: 52 }}>
      <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 26, lineHeight: 1, color: C.soil }}>
        {String(n).padStart(2, "0")}
      </div>
      <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: C.soilSoft, marginTop: 5 }}>{l}</div>
    </div>
  );

  return (
    <div className="kCard kFadeUp" style={cardStyle({ marginTop: 16, animationDelay: `${delay}ms`,
      opacity: past ? 0.72 : 1 })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 21, lineHeight: 1.2 }}>{item.title}</h3>
          <div style={{ fontSize: 12.5, color: C.soilSoft, marginTop: 4 }}>{dateLabel}</div>
        </div>
        <button onClick={onRemove} className="kBtn" style={{ background: "transparent", border: "none",
          color: C.soilSoft, cursor: "pointer", fontSize: 18, opacity: 0.4, padding: "0 4px" }}>×</button>
      </div>

      <div style={{ marginTop: 18, padding: "18px 0 4px", borderTop: `1px solid ${C.line}` }}>
        {isToday ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 40, color: C.clay, lineHeight: 1 }}>
              {tr("Today", lang)} ✦
            </span>
            <span style={{ fontSize: 14, color: C.soil }}>it's here.</span>
          </div>
        ) : past ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 34, color: accent, lineHeight: 1 }}>
              {fmt(days)}
            </span>
            <span style={{ fontSize: 14, color: C.soilSoft }}>{tr("days", lang)} ago</span>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 44, color: C.clay, lineHeight: 1 }}>
                {fmt(days)}
              </span>
              <span style={{ fontSize: 15, color: C.soil }}>{tr("days", lang)} to go</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Part n={hours} l="hrs" />
              <Part n={mins} l="min" />
              <Part n={secs} l="sec" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddCountdown({ onAdd, onCancel, lang }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const valid = title.trim() && date;
  const submit = () => {
    if (!valid) return;
    onAdd({ id: Date.now(), title: title.trim(), date });
  };
  return (
    <div className="kCard kFadeUp" style={cardStyle({ marginTop: 16 })}>
      <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 19, marginBottom: 16 }}>
        {tr("What are you counting down to?", lang)}
      </h3>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <Label>{tr("Title", lang)}</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="e.g. Wedding, Bali trip, Exam day" />
        </div>
        <div>
          <Label>{tr("Date", lang)}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <Btn small onClick={submit} disabled={!valid}>{tr("Add", lang)}</Btn>
        {onCancel && <Btn small variant="ghost" onClick={onCancel}>{tr("Cancel", lang)}</Btn>}
      </div>
    </div>
  );
}

// ---------- CALENDAR VIEW ----------
function CalendarView({ countdowns, lang, goToCountdown }) {
  const now = useNow(60000); // a minute is plenty for a calendar
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(() => dateKey(now));
  const locale = lang === "id" ? "id-ID" : "en-US";

  // countdowns grouped by their date key
  const byDate = useMemo(() => {
    const m = {};
    (countdowns || []).forEach((c) => { (m[c.date] ||= []).push(c); });
    return m;
  }, [countdowns]);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = cursor.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const weekdays = useMemo(() => {
    // localized short weekday names, Sun→Sat
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: "short" }));
  }, [locale]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const move = (delta) => setCursor(new Date(year, month + delta, 1));
  const goToday = () => { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(dateKey(now)); };

  const selectedEvents = byDate[selected] || [];
  const selDate = parseLocalDate(selected);

  const navBtn = (label, onClick, aria) => (
    <button onClick={onClick} className="kBtn" aria-label={aria} style={{ background: "transparent",
      border: `1px solid ${C.line}`, borderRadius: 99, width: 34, height: 34, cursor: "pointer",
      color: C.soil, fontSize: 16, fontFamily: "inherit", lineHeight: 1 }}>{label}</button>
  );

  return (
    <div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(20px,4vw,26px)",
            letterSpacing: "-.01em" }}>{monthLabel}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={goToday} className="kBtn" style={{ background: "transparent",
              border: `1px solid ${C.line}`, borderRadius: 99, padding: "6px 14px", cursor: "pointer",
              color: C.soilSoft, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" }}>
              {tr("Today", lang)}
            </button>
            {navBtn("‹", () => move(-1), "Previous month")}
            {navBtn("›", () => move(1), "Next month")}
          </div>
        </div>

        {/* weekday header */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 6 }}>
          {weekdays.map((w) => (
            <div key={w} style={{ textAlign: "center", fontSize: 10.5, letterSpacing: ".08em",
              textTransform: "uppercase", color: C.soilSoft, fontWeight: 600 }}>{w}</div>
          ))}
        </div>

        {/* day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={"e" + i} />;
            const key = dateKey(d);
            const today = isSameDay(d, now);
            const isSel = key === selected;
            const events = byDate[key] || [];
            return (
              <button key={key} onClick={() => setSelected(key)} className="kBtn"
                style={{ aspectRatio: "1 / 1", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                  border: `1px solid ${isSel ? C.clay : "transparent"}`,
                  background: today ? C.clay : isSel ? C.paper : "transparent",
                  boxShadow: isSel && !today ? `inset 0 0 0 1px ${C.line}` : "none" }}>
                <span style={{ fontSize: 13.5, fontWeight: today ? 700 : 500,
                  color: today ? C.paper : C.soil }}>{d.getDate()}</span>
                <span style={{ display: "flex", gap: 2, height: 5 }}>
                  {events.slice(0, 3).map((_, k) => (
                    <span key={k} style={{ width: 5, height: 5, borderRadius: 99,
                      background: today ? C.paper : C.clay, opacity: today ? 0.9 : 1 }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* selected day detail */}
      <Card style={{ marginTop: 18 }} delay={100}>
        <div style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase",
          color: C.soilSoft, fontWeight: 600, marginBottom: 6 }}>
          {selDate ? selDate.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }) : ""}
        </div>
        {selectedEvents.length > 0 ? (
          selectedEvents.map((c) => (
            <div key={c.id} className="kRow" style={{ display: "flex", alignItems: "center", gap: 12,
              padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: C.clay, flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: C.soil }}>{c.title}</span>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13.5, color: C.soilSoft, lineHeight: 1.6, margin: "4px 0 0" }}>
            {tr("Nothing on the calendar yet", lang)}.{" "}
            <button onClick={goToCountdown} className="kBtn" style={{ background: "transparent",
              border: "none", color: C.clay, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              fontSize: 13.5, padding: 0 }}>
              {tr("Add countdown", lang)} →
            </button>
          </p>
        )}
      </Card>
    </div>
  );
}

function SettingsView({ profile, setProfile, exportData, importData, theme, setTheme, dark, setDark, lang, setLang, onReset }) {
  const [name, setName] = useState(profile.name || "");
  const [birth, setBirth] = useState(profile.birth || "");
  const [lifeExp, setLifeExp] = useState(profile.lifeExp || 73);
  const [confirmReset, setConfirmReset] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [importNote, setImportNote] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const dirty = name !== profile.name || birth !== profile.birth || lifeExp !== profile.lifeExp;

  const save = () => setProfile({ ...profile, name: name.trim() || profile.name, birth, lifeExp });

  return (
    <div>
      {/* Profile */}
      <Card>
        <Eyebrow>Settings</Eyebrow>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: "clamp(22px,4vw,28px)",
          margin: "8px 0 18px" }}>Your profile</h3>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <Label>Date of birth</Label>
              <Input type="date" value={birth} max={today} onChange={(e) => setBirth(e.target.value)} />
            </div>
            <div style={{ width: 150 }}>
              <Label>Life expectancy</Label>
              <Input type="number" value={lifeExp} min={40} max={120}
                onChange={(e) => setLifeExp(+e.target.value)} />
            </div>
          </div>
        </div>
        {dirty && (
          <div style={{ marginTop: 16 }}>
            <Btn small onClick={save}>Save changes</Btn>
          </div>
        )}
      </Card>

      {/* Appearance — dark toggle + collapsible theme picker */}
      <Card style={{ marginTop: 18 }} delay={60}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20 }}>
            {tr("Appearance", lang)}
          </h3>
          {/* dark mode toggle */}
          <button onClick={() => setDark(!dark)} className="kBtn" title="Toggle dark mode"
            style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent",
              border: `1px solid ${C.line}`, borderRadius: 99, padding: "6px 12px",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: C.soilSoft, cursor: "pointer" }}>
            <span style={{ fontSize: 14 }}>{dark ? "☾" : "☀"}</span>
            {dark ? tr("Dark", lang) : tr("Light", lang)}
          </button>
        </div>

        {/* current theme summary row (tap to expand) */}
        <button onClick={() => setThemeOpen(!themeOpen)} className="kBtn"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, marginTop: 14,
            background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px",
            cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(THEME_DEFS[theme]?.swatch || []).map((c, i) => (
              <span key={i} style={{ width: 20, height: 20, borderRadius: 5, background: c,
                border: "1px solid rgba(0,0,0,.06)" }} />
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.soil }}>{THEME_DEFS[theme]?.label}</div>
            <div style={{ fontSize: 11.5, color: C.soilSoft }}>{THEME_DEFS[theme]?.mood}</div>
          </div>
          <span style={{ fontSize: 13, color: C.soilSoft, transform: themeOpen ? "rotate(180deg)" : "none",
            transition: "transform .25s ease" }}>⌄</span>
        </button>

        {/* expanded theme grid */}
        {themeOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
            gap: 10, marginTop: 12, animation: "kFadeUp .3s ease" }}>
            {Object.entries(THEME_DEFS).map(([key, th]) => (
              <ThemeCard key={key} active={theme === key} dark={dark}
                onClick={() => { setTheme(key); setThemeOpen(false); }}
                label={th.label} mood={th.mood} swatch={th.swatch} />
            ))}
          </div>
        )}
      </Card>

      {/* Language */}
      <Card style={{ marginTop: 18 }} delay={90}>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20, marginBottom: 14 }}>
          {tr("Language", lang)}
        </h3>
        <div style={{ display: "flex", gap: 10 }}>
          <ChoiceCard active={lang === "en"} onClick={() => setLang("en")}
            title="English" sub="Default" />
          <ChoiceCard active={lang === "id"} onClick={() => setLang("id")}
            title="Indonesia" sub="Bahasa" />
        </div>
      </Card>

      {/* Your data — export / backup / import */}
      <Card style={{ marginTop: 18 }} delay={110}>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20, marginBottom: 6 }}>
          {tr("Your data", lang)}
        </h3>
        <p style={{ fontSize: 13.5, color: C.soilSoft, marginBottom: 14, lineHeight: 1.6 }}>
          {tr("Your life is yours. Download a backup anytime, or restore from one.", lang)}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Btn small variant="ghost" onClick={exportData}>↓ {tr("Export backup", lang)}</Btn>
          <label className="kBtn" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center",
            gap: 6, padding: "9px 16px", borderRadius: 99, fontSize: 13.5, fontWeight: 600,
            border: `1px solid ${C.line}`, color: C.soilSoft, background: "transparent" }}>
            ↑ {tr("Import backup", lang)}
            <input type="file" accept="application/json" style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const ok = importData(String(reader.result));
                  setImportNote(ok ? tr("Backup restored.", lang) : tr("Couldn't read that file.", lang));
                };
                reader.readAsText(f);
              }} />
          </label>
          {importNote && <span style={{ fontSize: 12.5, color: C.clay }}>{importNote}</span>}
        </div>
      </Card>

      {/* Danger zone */}
      <Card style={{ marginTop: 18 }} delay={120}>
        <h3 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20, marginBottom: 6 }}>
          Start over
        </h3>
        <p style={{ fontSize: 13.5, color: C.soilSoft, marginBottom: 14, lineHeight: 1.6 }}>
          Erase everything — profile, plans, diary, memories — and begin fresh.
        </p>
        {!confirmReset ? (
          <Btn small variant="ghost" onClick={() => setConfirmReset(true)}>Reset KALA</Btn>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: C.soil }}>This can't be undone.</span>
            <Btn small onClick={onReset}>Yes, erase everything</Btn>
            <Btn small variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Btn>
          </div>
        )}
      </Card>

      <p style={{ textAlign: "center", fontSize: 12, color: C.soilSoft, marginTop: 24,
        letterSpacing: ".1em" }}>KALA · A product by KNSL</p>
    </div>
  );
}

function ChoiceCard({ active, onClick, title, sub, swatch }) {
  return (
    <button onClick={onClick} className="kBtn" style={{
      flex: 1, textAlign: "left", padding: "14px 16px", borderRadius: 14, cursor: "pointer",
      fontFamily: "inherit", background: active ? C.card : "transparent",
      border: `1.5px solid ${active ? C.clay : C.line}`, transition: "all .2s ease" }}>
      {swatch && (
        <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
          {swatch.map((c, i) => (
            <span key={i} style={{ width: 22, height: 22, borderRadius: 6, background: c,
              border: `1px solid ${C.line}` }} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700, color: active ? C.clay : C.soil }}>{title}</div>
      <div style={{ fontSize: 12, color: C.soilSoft, marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function buildShareURL(profile) {
  const base = typeof window !== "undefined"
    ? window.location.origin + window.location.pathname : "https://kala.knsl.tech/";
  const q = new URLSearchParams({
    n: profile.name || "",
    b: profile.birth || "",
    e: String(profile.lifeExp || 73),
  });
  return `${base}#/share?${q.toString()}`;
}

function ThemeCard({ active, onClick, label, mood, swatch }) {
  return (
    <button onClick={onClick} className="kBtn" style={{
      textAlign: "left", padding: "14px 14px", borderRadius: 14, cursor: "pointer",
      fontFamily: "inherit", background: active ? C.card : "transparent",
      border: `1.5px solid ${active ? C.clay : C.line}`, transition: "all .2s ease" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {swatch.map((c, i) => (
          <span key={i} style={{ width: 26, height: 26, borderRadius: 7, background: c,
            border: `1px solid rgba(0,0,0,.06)` }} />
        ))}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: active ? C.clay : C.soil }}>{label}</div>
      <div style={{ fontSize: 11.5, color: C.soilSoft, marginTop: 2 }}>{mood}</div>
    </button>
  );
}



// ============ PUBLIC SHARE PAGE (no login) ============
function PublicShare({ payload }) {
  const birth = new Date(payload.birth);
  const now = new Date();
  const lived = Math.max(0, weeksBetween(birth, now));
  const total = payload.lifeExp * WEEKS_PER_YEAR;
  const pct = ((lived / total) * 100).toFixed(1);
  const age = Math.floor((now - birth) / (1000 * 60 * 60 * 24 * 365.25));

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 80px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, fontWeight: 700,
          letterSpacing: ".18em", fontSize: 16 }}>
          <Glyph small /> KALA
        </div>
        <a href={typeof window !== "undefined" ? window.location.pathname : "/"}
          style={{ fontSize: 13, color: C.clay, fontWeight: 600, textDecoration: "none" }}>
          Make yours →
        </a>
      </header>

      <div style={{ textAlign: "center", padding: "30px 0 10px" }}>
        <Eyebrow center>A life in weeks</Eyebrow>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500,
          fontSize: "clamp(28px,6vw,44px)", letterSpacing: "-.02em", margin: "10px 0 6px" }}>
          {payload.name}'s life,<br /><em style={{ fontStyle: "italic", color: C.clay }}>so far.</em>
        </h1>
      </div>

      <div style={{ display: "flex", gap: 30, justifyContent: "center", flexWrap: "wrap",
        margin: "20px 0 26px" }}>
        <Stat n={fmt(lived)} l="Weeks lived" />
        <Stat n={pct + "%"} l="Life lived" accent />
        <Stat n={age} l="Years old" />
      </div>

      <Card>
        <FullGrid lived={lived} total={total} milestoneWeeks={{}} />
        <div style={{ display: "flex", gap: 22, marginTop: 18, flexWrap: "wrap",
          fontSize: 12.5, color: C.soilSoft, justifyContent: "center" }}>
          <Legend c={C.past} t="Lived" />
          <Legend c={C.now} t="This week" ring />
          <Legend c="transparent" t="Ahead" border />
        </div>
      </Card>

      <div style={{ textAlign: "center", marginTop: 28 }}>
        <p style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 17,
          color: C.soilSoft, marginBottom: 18 }}>
          "Every box is a week. Most are still yours."
        </p>
        <a href={typeof window !== "undefined" ? window.location.pathname : "/"}
          style={{ display: "inline-block", background: C.clay, color: C.paper,
            padding: "13px 26px", borderRadius: 99, fontWeight: 600, fontSize: 15,
            textDecoration: "none" }}>
          See your own life in weeks →
        </a>
        <p style={{ fontSize: 12, color: C.soilSoft, marginTop: 20, letterSpacing: ".1em" }}>
          KALA · A product by KNSL
        </p>
      </div>
    </div>
  );
}

// ============ UI PRIMITIVES ============
function Center({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center" }}>
      {children}
    </div>
  );
}
function cardStyle(extra = {}) {
  return { background: C.paper, border: `1px solid ${C.line}`, borderRadius: 18,
    padding: "26px 26px", boxShadow: "0 18px 40px -32px rgba(46,32,24,.5)", ...extra };
}
function useInView(once = true) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // if already near viewport on mount, show immediately (no flash)
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { setInView(true); if (once) obs.unobserve(e.target); }
        else if (!once) setInView(false);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [once]);
  return [ref, inView];
}

function Card({ children, style, delay = 0 }) {
  const [ref, inView] = useInView(true);
  return (
    <div ref={ref} className="kCard" style={{
      ...cardStyle(),
      opacity: inView ? 1 : 0,
      transform: inView ? "translateY(0)" : "translateY(22px)",
      transition: `opacity .7s cubic-bezier(.22,.61,.36,1) ${delay}ms, transform .7s cubic-bezier(.22,.61,.36,1) ${delay}ms`,
      ...style,
    }}>
      {children}
    </div>
  );
}
function Stat({ n, l, accent }) {
  return (
    <div>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 30, fontWeight: 600,
        letterSpacing: "-.01em", lineHeight: 1, color: accent ? C.clay : C.soil }}>{n}</div>
      <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
        color: C.soilSoft, marginTop: 6 }}>{l}</div>
    </div>
  );
}
function Btn({ children, onClick, disabled, variant, small }) {
  const ghost = variant === "ghost";
  return (
    <button className="kBtn" onClick={onClick} disabled={disabled}
      style={{
        background: ghost ? "transparent" : C.clay,
        color: ghost ? C.soil : C.paper,
        border: ghost ? `1px solid ${C.line}` : "none",
        padding: small ? "9px 16px" : "13px 24px",
        borderRadius: 99, fontFamily: "inherit", fontSize: small ? 13.5 : 15,
        fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1, flexShrink: 0,
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}>
      {children}
    </button>
  );
}
function Tab({ children, active, onClick }) {
  return (
    <button className="kTab" onClick={onClick} style={{
      background: "transparent", border: "none", padding: "12px 4px", marginRight: 18,
      fontFamily: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer",
      color: active ? C.clay : C.soilSoft,
      borderBottom: active ? `2px solid ${C.clay}` : "2px solid transparent",
      marginBottom: -1,
    }}>{children}</button>
  );
}
function Label({ children, style }) {
  return <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em",
    color: C.soilSoft, marginBottom: 7, textAlign: "left", ...style }}>{children}</div>;
}
function Input({ style, ...p }) {
  return <input {...p} style={{
    width: "100%", boxSizing: "border-box", display: "block",
    padding: "13px 15px", borderRadius: 12, border: `1px solid ${C.line}`,
    background: C.paper, color: C.soil, fontFamily: "inherit", fontSize: 15,
    outline: "none", colorScheme: "light", ...style,
  }}
  onFocus={(e) => (e.target.style.borderColor = C.clay)}
  onBlur={(e) => (e.target.style.borderColor = C.line)} />;
}
function Eyebrow({ children, center }) {
  return <div style={{ fontSize: 11, letterSpacing: ".26em", textTransform: "uppercase",
    color: C.clay, fontWeight: 600, textAlign: center ? "center" : "left" }}>{children}</div>;
}
function Legend({ c, t, ring, border, star }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 12, height: 12, borderRadius: 2, background: c,
        border: border ? `1px solid ${C.line}` : "none",
        boxShadow: ring ? `0 0 0 2px rgba(138,74,44,.3)` : star ? `0 0 0 2px rgba(184,110,46,.25)` : "none" }} />
      {t}
    </div>
  );
}
// Living empty state — a small animated grid + warm invitation
function EmptyState({ title, body, action }) {
  return (
    <div style={{ textAlign: "center", padding: "34px 20px" }}>
      <div style={{ display: "inline-grid", gridTemplateColumns: "repeat(3,14px)", gap: 5,
        marginBottom: 20 }}>
        {[0,0,0, 0,1,2, 2,2,2].map((v, i) => (
          <span key={i} style={{ width: 14, height: 14, borderRadius: 3,
            background: v === 0 ? C.past : v === 1 ? C.clay : "transparent",
            border: v === 2 ? `1px solid ${C.line}` : "none",
            opacity: 0,
            animation: "kFadeUp .5s ease forwards",
            animationDelay: `${i * 70}ms`,
            boxShadow: v === 1 ? `0 0 0 3px ${C.clay}22` : "none" }} />
        ))}
      </div>
      <h4 style={{ fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 20,
        color: C.soil, marginBottom: 8 }}>{title}</h4>
      <p style={{ fontSize: 14, color: C.soilSoft, lineHeight: 1.6, maxWidth: 340,
        margin: "0 auto 18px" }}>{body}</p>
      {action}
    </div>
  );
}

function Glyph({ small }) {
  const sz = small ? 5 : 7;
  const gap = small ? 2.5 : 3.5;
  const cells = [0,0,0, 0,1,2, 2,2,2]; // 0 past,1 now,2 future
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(3,${sz}px)`,
      gridTemplateRows: `repeat(3,${sz}px)`, gap }}>
      {cells.map((v, i) => (
        <span key={i} style={{ width: sz, height: sz, borderRadius: 1,
          background: v === 0 ? C.past : v === 1 ? C.clay : "transparent",
          border: v === 2 ? `1px solid ${C.line}` : "none",
          boxShadow: v === 1 ? `0 0 0 2px rgba(138,74,44,.2)` : "none" }} />
      ))}
    </div>
  );
}
