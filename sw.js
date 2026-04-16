/* ===========================================
   OCRLearning — sw.js  (Service Worker)
   Cache-first for app shell & CDN assets.
   Network-only for Mistral API calls.
   =========================================== */
'use strict';

const CACHE   = 'ocrl-v1';
const SHELL   = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  /* CDN — cached on first visit */
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js',
  'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js',
];

/* ── Install : pre-cache app shell ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate : delete old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  /* Mistral API — always network (no caching of OCR responses) */
  if (url.includes('api.mistral.ai')) {
    e.respondWith(fetch(e.request));
    return;
  }

  /* Google Fonts — network-first, cache fallback */
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  /* Everything else — cache-first, network fallback */
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      });
    })
  );
});
