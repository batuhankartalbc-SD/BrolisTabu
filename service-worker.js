const CACHE_NAME = "brolis-tabu-v2";

// Bu dosyalar aynı origin'den gelir ve önbelleğe alınması garanti olmalıdır —
// yoksa çevrimdışı açılışta "siyah ekran" (uygulama kabuğu bile yüklenemez) oluşur.
const LOCAL_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./words.js",
  "./audio.js",
  "./manifest.json",
  "./icon.svg",
];

// Bunlar CDN'den gelir; ilk kurulumda ağ sorunu yaşanırsa önbelleğe alınamayabilir.
// "En iyi çaba" (best-effort) olarak eklenir — biri başarısız olursa yerel kabuğun
// önbelleğe alınmasını ENGELLEMEMELİDİR (cache.addAll atomiktir, tek hata tüm listeyi düşürür).
const CDN_SHELL = [
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Yerel kabuk: mutlaka başarılı olmalı (atomik addAll burada güvenlidir,
      // çünkü hepsi aynı origin ve her zaman erişilebilir olmalı).
      await cache.addAll(LOCAL_SHELL);

      // CDN dosyaları: her biri bağımsız denenir, biri başarısız olursa diğerini etkilemez.
      await Promise.all(
        CDN_SHELL.map((url) =>
          cache.add(url).catch(() => {
            /* CDN kaynağı şu an önbelleğe alınamadı — ilk çevrimiçi yüklemede fetch handler'ı bunu telafi edecek */
          })
        )
      );

      await self.skipWaiting();
    })().catch(() => {
      /* yerel kabuk bile önbelleğe alınamadıysa (ör. dosya yolları değişti) kurulumu sessizce bitir */
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);

      if (cached) {
        // Arka planda güncellemeyi dene (stale-while-revalidate); sonucu beklemeden
        // hemen önbellekteki sürümü döndür. Hata olursa sessizce yoksay.
        fetch(event.request)
          .then((response) => {
            if (response && response.status === 200 && (response.type === "basic" || response.type === "cors")) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
            }
          })
          .catch(() => {});
        return cached;
      }

      try {
        const response = await fetch(event.request);
        if (response && response.status === 200 && (response.type === "basic" || response.type === "cors")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      } catch (err) {
        // Çevrimdışıyız ve önbellekte de yok: en azından uygulama kabuğuna dön
        // ki kullanıcı siyah/boş bir ekran yerine tanıdık arayüzü görsün.
        const fallback = await caches.match("./index.html");
        return fallback || Response.error();
      }
    })()
  );
});
