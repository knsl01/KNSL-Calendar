// ============================================================
// KALA — Storage layer
// ------------------------------------------------------------
// One swappable persistence interface used by the whole app:
//   loadState() / saveState(state) / clearState()
//
// Behaviour:
//   - Signed in (Supabase user present) -> cloud sync via the
//     `states` table (one row per user, RLS-protected).
//   - Guest / cloud not configured       -> on-device storage
//     (window.storage in the artifact host, else localStorage).
//
// Nothing else in the app needs to know which path is active.
// ============================================================
import { supabase, cloudEnabled } from "./supabase";

const STORE_KEY = "kala-state-v1";

// ---------- local (guest) backend ----------
function localBackend() {
  if (typeof window === "undefined") return null;
  if (window.storage) return window.storage; // artifact host
  return {
    async get(k) {
      const v = window.localStorage.getItem(k);
      if (v == null) throw new Error("not found");
      return { key: k, value: v };
    },
    async set(k, v) {
      window.localStorage.setItem(k, v);
      return { key: k, value: v };
    },
    async delete(k) {
      window.localStorage.removeItem(k);
      return { key: k, deleted: true };
    },
  };
}

async function currentUser() {
  if (!cloudEnabled) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// ---------- public API ----------
export async function loadState() {
  const user = await currentUser();
  if (user) {
    try {
      const { data, error } = await supabase
        .from("states")
        .select("data")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.data ?? null;
    } catch (e) {
      console.error("KALA cloud load failed, falling back local", e);
    }
  }
  const store = localBackend();
  if (!store) return null;
  try {
    const res = await store.get(STORE_KEY);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null;
  }
}

export async function saveState(state) {
  const user = await currentUser();
  if (user) {
    try {
      const { error } = await supabase
        .from("states")
        .upsert(
          { user_id: user.id, data: state, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      return;
    } catch (e) {
      console.error("KALA cloud save failed, saving local", e);
    }
  }
  const store = localBackend();
  if (!store) return;
  try {
    await store.set(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("KALA save failed", e);
  }
}

export async function clearState() {
  const user = await currentUser();
  if (user) {
    try {
      await supabase.from("states").delete().eq("user_id", user.id);
    } catch (e) {
      console.error("KALA cloud clear failed", e);
    }
  }
  const store = localBackend();
  if (!store) return;
  try {
    await store.delete(STORE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- migration helper ----------
// When a guest signs in for the first time, copy their on-device
// data up to the cloud so nothing is lost.
export async function migrateLocalToCloud() {
  if (!cloudEnabled) return;
  const user = await currentUser();
  if (!user) return;
  const store = localBackend();
  if (!store) return;
  try {
    const res = await store.get(STORE_KEY);
    const local = res ? JSON.parse(res.value) : null;
    if (!local) return;
    const { data } = await supabase
      .from("states")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) {
      await supabase.from("states").insert({ user_id: user.id, data: local });
    }
  } catch {
    /* best-effort */
  }
}
