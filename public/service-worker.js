// KALA service worker — offline shell + web push for the weekly nudge.
// Versioned cache so old assets are cleaned up on deploy.
const CACHE = "kala-v1";
const SHELL = ["/", "/index.html", "/icon.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation (always fresh app), cache fallback offline.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// ---- Web Push: the weekly nudge ("a new week has begun") ----
self.addEventListener("push", (event) => {
  let data = { title: "A new week in KALA", body: "Another square, filled in. Take a moment to design it." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.png",
      badge: "/icon.png",
      // weekly nudge by default; Future Me letters pass their own tag
      tag: data.tag || "kala-weekly-nudge",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});
