const { useState, useEffect, useRef, useMemo, useCallback } = React;
const h = React.createElement;

const STORAGE_KEY = "netflix-tabu-state-v1";

// Takım rengi (skor rozetindeki nokta) ve flama (banner) varyantı — ikisi de
// aynı vintage palete karşılık gelir: bordo, orman yeşili, lacivert-gri, hardal.
const TEAM_COLORS = ["#8C2A2A", "#3E6B45", "#4A5A72", "#B08A3E"];
const BANNER_VARIANTS = ["banner-burgundy", "banner-forest", "banner-navy", "banner-mustard"];
const EMOJI_OPTIONS = ["🦁", "🐯", "🐸", "🦄", "🐙", "🦊", "🐼", "🐵", "🦉", "🐢", "🐧", "🦈", "🐺", "🐰", "🐲", "🦖"];

const DURATION_OPTIONS = [30, 45, 60, 90, 120];
const DIFFICULTY_OPTIONS = [
  { key: "easy", label: "Kolay", forbiddenCount: 3 },
  { key: "medium", label: "Orta", forbiddenCount: 5 },
  { key: "hard", label: "Zor", forbiddenCount: 7 },
];
const TARGET_SCORE_OPTIONS = [30, 50, 75, 100];
const MIN_DURATION = 30;
const MIN_TARGET_SCORE = 5;
const SPAM_GUARD_MS = 220; // insan-üstü hızda art arda tıklamaya karşı asgari süre

// Ses/titreşim tercihleri — playSound/vibrate saf fonksiyonlar olduğu için (App
// state'ine doğrudan erişimleri yok), tercihler burada global bir bayrakta tutulur
// ve App içinde ayarlar her değiştiğinde senkronize edilir.
window.__tabuPrefs = window.__tabuPrefs || { sound: true, haptics: true };

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getFilteredPool(categories) {
  if (!categories || categories.length === 0) return window.WORDS_POOL;
  const filtered = window.WORDS_POOL.filter((w) => categories.includes(w.category));
  return filtered.length > 0 ? filtered : window.WORDS_POOL;
}

// Son görülen kaç kelimenin "tekrar etmesin" listesinde tutulacağı. 560 kelimelik
// havuzun yaklaşık yarısı kadar — dar bir kategori seçiliyse zaten aşağıdaki
// buildFreshDeck bu sınırı otomatik olarak göz ardı eder (bkz. fresh.length === 0).
const RECENT_WORDS_LIMIT = 300;

// Yeni deste kurarken, o an seçili kategorilerde yakın zamanda görülmemiş
// kelimeleri önce, görülmüş olanları sonra sıralar. Böylece aynı kategoriyle
// art arda birkaç oyun oynansa bile kelimeler mümkün olduğunca geç tekrar eder.
// Seçili kategorideki TÜM kelimeler zaten "görülmüş" ise (çok dar bir kategori
// seçiliyse), deste boş kalmasın diye tüm havuzdan sıradan bir karışım döner.
function buildFreshDeck(pool, recentIds) {
  if (!recentIds || recentIds.length === 0) return shuffle(pool);
  const recentSet = new Set(recentIds);
  const fresh = [];
  const seen = [];
  pool.forEach((w) => (recentSet.has(w.id) ? seen.push(w) : fresh.push(w)));
  if (fresh.length === 0) return shuffle(pool);
  return [...shuffle(fresh), ...shuffle(seen)];
}

function playSound(name) {
  if (window.__tabuPrefs && window.__tabuPrefs.sound === false) return;
  if (window.TabuAudio && typeof window.TabuAudio[name] === "function") {
    try {
      window.TabuAudio[name]();
    } catch (e) {
      /* ses çalınamadı — sessizce yoksay */
    }
  }
}

// Titreşim (haptik) geri bildirim — gürültülü/kalabalık ortamlarda ses duyulmasa
// bile Doğru/Tabu/Pas gibi aksiyonların hissedilmesini sağlar. Desteklenmeyen
// cihazlarda (örn. iOS Safari) navigator.vibrate yoktur — sessizce yoksayılır.
function vibrate(pattern) {
  if (window.__tabuPrefs && window.__tabuPrefs.haptics === false) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {
    /* titreşim desteklenmiyor — sessizce yoksay */
  }
}

function computeGameStats(wordLog, teams) {
  const byTeam = {};
  teams.forEach((t) => {
    byTeam[t.name] = { correct: 0, tabu: 0, passed: 0, total: 0 };
  });
  wordLog.forEach((entry) => {
    const bucket = byTeam[entry.team];
    if (!bucket) return;
    bucket.total += 1;
    if (entry.result === "correct") bucket.correct += 1;
    else if (entry.result === "tabu") bucket.tabu += 1;
    else bucket.passed += 1;
  });

  const correctEntries = wordLog.filter((e) => e.result === "correct");
  const fastest = correctEntries.length
    ? correctEntries.reduce((a, b) => (a.durationMs < b.durationMs ? a : b))
    : null;
  const slowest = wordLog.length
    ? wordLog.reduce((a, b) => (a.durationMs > b.durationMs ? a : b))
    : null;

  const struggleByWord = {};
  wordLog.forEach((entry) => {
    if (entry.result === "tabu" || entry.result === "pass") {
      if (!struggleByWord[entry.wordId]) {
        struggleByWord[entry.wordId] = { word: entry.word, teams: new Set(), count: 0 };
      }
      struggleByWord[entry.wordId].teams.add(entry.team);
      struggleByWord[entry.wordId].count += 1;
    }
  });
  const struggleList = Object.values(struggleByWord)
    .map((s) => ({ word: s.word, teamCount: s.teams.size, count: s.count }))
    .sort((a, b) => b.teamCount - a.teamCount || b.count - a.count);
  const sharedStruggles = struggleList.filter((s) => s.teamCount >= 2).slice(0, 5);

  return {
    byTeam,
    fastest,
    slowest,
    zorluKelimeler: sharedStruggles.length > 0 ? sharedStruggles : struggleList.slice(0, 5),
    zorluKelimelerShared: sharedStruggles.length > 0,
  };
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function persist(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    /* localStorage unavailable — ignore */
  }
}

function defaultTeams() {
  return [
    { id: 1, name: "Takım 1", score: 0, emoji: EMOJI_OPTIONS[0] },
    { id: 2, name: "Takım 2", score: 0, emoji: EMOJI_OPTIONS[1] },
  ];
}

function defaultSettings() {
  return {
    duration: 60,
    difficulty: "medium",
    passLimit: 3, // null = sınırsız
    targetScore: 50,
    categories: window.WORD_CATEGORIES.map((c) => c.key),
    soundEnabled: true,
    hapticsEnabled: true,
  };
}

function defaultAllTime() {
  return { gamesPlayed: 0, bestScore: 0, bestTeamName: "" };
}

// ---------------------------------------------------------------------------
// Ekranın uykuya geçip kilitlenmesini engeller (Wake Lock API). Bir takım zor
// bir kelimede uzun süre ekrana dokunmadan takılırsa, ekran kararıp kilitlenip
// turu yarıda kesebilir — bu hook oyun aktifken ekranı uyanık tutar. Desteklenmeyen
// tarayıcılarda (örn. eski iOS Safari) sessizce hiçbir şey yapmaz.
function useWakeLock(active) {
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return undefined;
    let cancelled = false;
    const requestLock = () => {
      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          if (cancelled) {
            sentinel.release().catch(() => {});
            return;
          }
          sentinelRef.current = sentinel;
        })
        .catch(() => {
          /* izin verilmedi ya da desteklenmiyor — sessizce yoksay */
        });
    };
    requestLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) requestLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
      }
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// İkon sistemi — emoji yerine tek renkli (currentColor) inline SVG'ler.
// Emoji yalnızca takım avatarlarında kullanılır; bütün UI kontrolleri burada
// tanımlı vektör ikonlarla gösterilir (platformdan platforma renkli/tutarsız
// emoji görünümünü engeller, bronz/parşömen paletiyle birebir uyumlu kalır).
// ---------------------------------------------------------------------------
function Icon({ name, size = 20, className, style }) {
  const base = { width: size, height: size, viewBox: "0 0 24 24", className, style, "aria-hidden": "true", focusable: "false" };
  switch (name) {
    case "pause":
      return h(
        "svg",
        { ...base, fill: "currentColor" },
        h("rect", { x: 6, y: 4, width: 4, height: 16, rx: 1 }),
        h("rect", { x: 14, y: 4, width: 4, height: 16, rx: 1 })
      );
    case "play":
      return h("svg", { ...base, fill: "currentColor" }, h("path", { d: "M7 4l13 8-13 8z" }));
    case "stop":
      return h("svg", { ...base, fill: "currentColor" }, h("rect", { x: 6, y: 6, width: 12, height: 12, rx: 2 }));
    case "undo":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M7 7L3.3 10.5 7 14" }),
        h("path", { d: "M3.3 10.5H14a6 6 0 1 1-5.6 8.2" })
      );
    case "history":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
        h("circle", { cx: 12, cy: 12, r: 8, fill: "none" }),
        h("path", { d: "M12 8v4l3 2" })
      );
    case "help":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" },
        h("circle", { cx: 12, cy: 12, r: 9, fill: "none" }),
        h("path", { d: "M9.3 9a2.6 2.6 0 1 1 3.6 2.4c-.85.4-1.1.95-1.1 1.8" }),
        h("circle", { cx: 12, cy: 17.2, r: 1.1, fill: "currentColor", stroke: "none" })
      );
    case "trophy":
      return h(
        "svg",
        { ...base, fill: "currentColor" },
        h("path", { d: "M7 4h10v3.2a5 5 0 0 1-10 0V4z" }),
        h("path", { d: "M7 5H4.2a3.2 3.2 0 0 0 3.4 4.2M17 5h2.8a3.2 3.2 0 0 1-3.4 4.2", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
        h("rect", { x: 10.3, y: 12.6, width: 3.4, height: 4.2 }),
        h("rect", { x: 7.6, y: 17.4, width: 8.8, height: 2.3, rx: 1 })
      );
    case "check":
      return h("svg", { ...base, fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M4 12.5l5 5L20 6" }));
    case "x":
      return h("svg", { ...base, fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" }, h("path", { d: "M5 5l14 14M19 5L5 19" }));
    case "arrowRight":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M4 12h14M13 6l6 6-6 6" })
      );
    case "download":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M12 3v12M7 11l5 5 5-5" }),
        h("path", { d: "M4 20h16", strokeWidth: 2 })
      );
    case "refresh":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M4 12a8 8 0 0 1 13.9-5.4M20 12a8 8 0 0 1-13.9 5.4" }),
        h("path", { d: "M18.3 2.8v4.6h-4.6M5.7 21.2v-4.6h4.6" })
      );
    case "speakerOn":
      return h(
        "svg",
        { ...base, fill: "currentColor" },
        h("path", { d: "M4 9v6h4l5 4V5L8 9H4z" }),
        h("path", { d: "M16 9a4 4 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" })
      );
    case "speakerOff":
      return h(
        "svg",
        { ...base, fill: "currentColor" },
        h("path", { d: "M4 9v6h4l5 4V5L8 9H4z" }),
        h("path", { d: "M16 9.3l5.4 5.4M21.4 9.3l-5.4 5.4", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" })
      );
    case "vibrate":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
        h("rect", { x: 8, y: 4, width: 8, height: 16, rx: 2 }),
        h("path", { d: "M3.5 9v6M20.5 9v6", strokeWidth: 2.1 })
      );
    case "share":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 1.8 },
        h("circle", { cx: 6, cy: 12, r: 2.3 }),
        h("circle", { cx: 17.5, cy: 5.8, r: 2.3 }),
        h("circle", { cx: 17.5, cy: 18.2, r: 2.3 }),
        h("path", { d: "M8.1 10.8l7.3-4.2M8.1 13.2l7.3 4.2" })
      );
    case "fire":
      return h(
        "svg",
        { ...base, fill: "currentColor" },
        h("path", { d: "M12 2.5c1 2.4-.4 3.7-1.3 4.8-1 1.2-1.7 2.3-1.7 3.9a3 3 0 0 0 3 3c-.7-1.2-.4-2 .2-2.8.4 1 1.1 1.5 1.8 2a2.6 2.6 0 0 0 1-2c1 .8 1.5 1.8 1.5 3a4.5 4.5 0 0 1-9 0c0-3.2 2-4.6 3.2-6.2 1-1.4 1.7-2.7 1.3-5.7z" })
      );
    case "edit":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round", strokeLinecap: "round" },
        h("path", { d: "M4 20l.9-3.6L15.4 6l3.6 3.6L8.6 20.1 4 20z" }),
        h("path", { d: "M13.2 7.8l3.6 3.6" })
      );
    case "people":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
        h("circle", { cx: 9, cy: 8, r: 3 }),
        h("path", { d: "M3.5 19c.6-3.4 3-5 5.5-5s4.9 1.6 5.5 5" }),
        h("circle", { cx: 17, cy: 8.5, r: 2.4 }),
        h("path", { d: "M15 13.3c1.7.3 3.6 1.6 4 4.7" })
      );
    case "star":
      return h(
        "svg",
        { ...base, fill: "currentColor" },
        h("path", { d: "M12 2.5l2.5 6.3 6.5.4-5 4.3 1.6 6.5L12 16.7l-5.6 3.3 1.6-6.5-5-4.3 6.5-.4z" })
      );
    case "hourglass":
      return h(
        "svg",
        { ...base, fill: "none", stroke: "currentColor" },
        h("path", { d: "M6 3h12M6 21h12", strokeWidth: 2, strokeLinecap: "round" }),
        h("path", {
          d: "M7.2 3c0 5.2 3.8 6.7 4.8 8-1 1.3-4.8 2.8-4.8 8M16.8 3c0 5.2-3.8 6.7-4.8 8 1 1.3 4.8 2.8 4.8 8",
          strokeWidth: 1.6,
          strokeLinejoin: "round",
        }),
        h("path", { d: "M9 5.4c.6 1.6 1.9 2.5 3 3.2 1.1-.7 2.4-1.6 3-3.2", fill: "currentColor", stroke: "none", opacity: 0.55 }),
        h("path", { d: "M9 18.6c.6-1.6 1.9-2.5 3-3.2 1.1.7 2.4 1.6 3 3.2", fill: "currentColor", stroke: "none", opacity: 0.85 })
      );
    case "plus":
      return h("svg", { ...base, fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" }, h("path", { d: "M12 5v14M5 12h14" }));
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Nasıl Oynanır? — kısa kural özeti (eski oyun kullanım kitapçığı hissi)
// ---------------------------------------------------------------------------
function HowToPlayModal({ onClose }) {
  const rules = [
    "Sırası gelen takımdan bir oyuncu ekrana bakar ve üstteki kelimeyi anlatır.",
    "Kelimenin kendisini ya da altındaki yasaklı kelimeleri söylemek yasaktır.",
    "Diğer oyuncular doğru tahmin ederse Doğru, yasaklı kelime söylenirse Tabu, anlatan takılırsa Pas tuşuna basılır.",
    "Doğru bilinen kelime +1, Tabu -1 puan getirir. Süre bitince sıra diğer takıma geçer.",
    "Ayarlarda belirlenen hedef puana ilk ulaşan takım oyunu kazanır.",
  ];
  return h(
    "div",
    { className: "modal-overlay", onClick: onClose },
    h(
      "div",
      { className: "modal-card", onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "modal-titlebar" },
        h("span", { className: "modal-title" }, "Nasıl Oynanır?"),
        h("button", { onClick: onClose, className: "modal-close", "aria-label": "Kapat" }, h(Icon, { name: "x", size: 18 }))
      ),
      h(
        "div",
        { className: "modal-body" },
        rules.map((rule, idx) =>
          h(
            "div",
            { key: idx, className: "rule-row" },
            h("span", { className: "rule-number" }, `${idx + 1}.`),
            h("span", { className: "text-sm" }, rule)
          )
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Marka logosu — küçük uygulama kimliği
// ---------------------------------------------------------------------------
function AppLogo() {
  return h(
    "div",
    { className: "app-logo" },
    h("span", { className: "app-logo-mark" }, "T"),
    h("span", { className: "app-logo-word" }, "BROLIS TABU")
  );
}

// ---------------------------------------------------------------------------
// Profil (Kim Oynuyor?) Ekranı
// ---------------------------------------------------------------------------
function ProfilesScreen({ teams, setTeams, onContinue, reserveBottomForBanner }) {
  const [showHelp, setShowHelp] = useState(false);

  const addTeam = () => {
    if (teams.length >= 4) return;
    const nextId = Math.max(0, ...teams.map((t) => t.id)) + 1;
    setTeams([
      ...teams,
      { id: nextId, name: `Takım ${teams.length + 1}`, score: 0, emoji: EMOJI_OPTIONS[teams.length % EMOJI_OPTIONS.length] },
    ]);
  };

  const removeTeam = (id) => {
    if (teams.length <= 2) return;
    setTeams(teams.filter((t) => t.id !== id));
  };

  const renameTeam = (id, name) => {
    setTeams(teams.map((t) => (t.id === id ? { ...t, name } : t)));
  };

  const cycleEmoji = (id) => {
    setTeams(
      teams.map((t) => {
        if (t.id !== id) return t;
        const idx = EMOJI_OPTIONS.indexOf(t.emoji);
        const next = EMOJI_OPTIONS[(idx + 1) % EMOJI_OPTIONS.length];
        return { ...t, emoji: next };
      })
    );
  };

  const canContinue = teams.length >= 2 && teams.every((t) => t.name.trim().length > 0);

  return h(
    "div",
    {
      className: "app-screen flex flex-col items-center px-4 pb-4 fade-in",
      style: {
        // Sol üstteki sabit "Yardım" düğmesi ~47px'te bitiyor (bkz. GameScreen'deki
        // aynı hesap); burada tek bir sabit düğme olduğu için GameScreen'in 76px'i
        // yerine daha dar ama yine de güvenli bir pay yeterli — ekranın geri kalanı
        // (takım kartları + buton) zaten telefon boyuna sığdırılmak zorunda.
        paddingTop: "calc(env(safe-area-inset-top) + 60px)",
        // InstallBanner yalnızca "profiles" fazında ve position:fixed;bottom:0
        // olarak belirir; ekranın alt kenarındaki gerçek son eleman ("DEVAM ET"
        // düğmesi) altında ekstra pay bırakmazsak, kaydırılabilir içerik en alta
        // getirildiğinde bile düğme banner'ın arkasında kalabilir.
        paddingBottom: reserveBottomForBanner ? "calc(env(safe-area-inset-bottom) + 76px)" : undefined,
      },
    },
    h(
      "button",
      { className: "history-btn", style: { right: "auto", left: "max(14px, env(safe-area-inset-left))" }, onClick: () => setShowHelp(true) },
      h(Icon, { name: "help", size: 15 }),
      "Yardım"
    ),
    h(AppLogo),
    h(
      "div",
      { className: "plaque mb-2" },
      h("h1", { className: "font-display plaque-text text-3xl sm:text-4xl" }, "KİM OYNUYOR?")
    ),
    h(
      "p",
      { className: "text-gray-400 mb-3 text-sm sm:text-base text-center", style: { maxWidth: "26rem" } },
      "2 ile 4 arasında takım oluştur ve isimlerini düzenle"
    ),
    h(
      "div",
      { className: "grid grid-cols-2 gap-3 sm:gap-4", style: { width: "100%", maxWidth: "26rem" } },
      teams.map((team, idx) =>
        h(
          "div",
          { key: team.id, className: "profile-tile relative" },
          teams.length > 2 &&
            h(
              "button",
              { onClick: () => removeTeam(team.id), className: "team-remove-btn", title: "Takımı kaldır", "aria-label": "Takımı kaldır" },
              h(Icon, { name: "x", size: 12 })
            ),
          h(
            "div",
            { className: `banner-card ${BANNER_VARIANTS[idx % BANNER_VARIANTS.length]}` },
            h(
              "div",
              {
                className: "avatar-frame",
                onClick: () => cycleEmoji(team.id),
                role: "button",
                tabIndex: 0,
                title: "Değiştirmek için dokun",
                "aria-label": "Takım simgesini değiştir",
              },
              team.emoji || team.name.trim().charAt(0).toUpperCase() || "?"
            ),
            h(
              "div",
              { className: "banner-team-name" },
              h("input", {
                value: team.name,
                onChange: (e) => renameTeam(team.id, e.target.value.slice(0, 18)),
                placeholder: "Takım adı",
              }),
              h(Icon, { name: "edit", size: 12, style: { opacity: 0.75, flex: "0 0 auto" } })
            )
          )
        )
      ),
      teams.length < 4 &&
        h(
          "button",
          { onClick: addTeam, className: "add-team-slot" },
          h(Icon, { name: "plus", size: 28 }),
          h("span", { className: "text-sm" }, "Takım Ekle")
        )
    ),
    h("p", { className: "text-gray-500 text-xs mt-2 text-center" }, "İpucu: simgeyi değiştirmek için üzerine dokun"),
    h(
      "button",
      {
        disabled: !canContinue,
        onClick: onContinue,
        className: "btn btn-primary btn-large mt-3 disabled:cursor-not-allowed",
      },
      "DEVAM ET"
    ),
    showHelp && h(HowToPlayModal, { onClose: () => setShowHelp(false) })
  );
}

// ---------------------------------------------------------------------------
// Kategori Seçim Şeridi (Netflix tarzı, kaydırma butonlu)
// ---------------------------------------------------------------------------
function CategoryRow({ categories, activeKeys, onToggle }) {
  const scrollRef = useRef(null);

  const scrollBy = (dir) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir * 180, behavior: "smooth" });
    }
  };

  return h(
    "div",
    { className: "category-scroll-wrapper" },
    h(
      "button",
      { type: "button", onClick: () => scrollBy(-1), className: "category-scroll-btn", "aria-label": "Sola kaydır" },
      "‹"
    ),
    h(
      "div",
      { className: "category-row scrollbar-none", ref: scrollRef },
      categories.map((cat) => {
        const active = activeKeys.includes(cat.key);
        return h(
          "button",
          {
            key: cat.key,
            type: "button",
            onClick: () => onToggle(cat.key),
            className: `category-tile ${active ? "active" : "inactive"}`,
          },
          active && h("span", { className: "check-badge" }, h(Icon, { name: "check", size: 10 })),
          cat.icon && h("span", { className: "category-tile-icon" }, cat.icon),
          h("span", { className: "category-tile-label" }, cat.label)
        );
      })
    ),
    h(
      "button",
      { type: "button", onClick: () => scrollBy(1), className: "category-scroll-btn", "aria-label": "Sağa kaydır" },
      "›"
    )
  );
}

// ---------------------------------------------------------------------------
// Ayarlar Ekranı
// ---------------------------------------------------------------------------
function SettingsScreen({ settings, setSettings, onBack, onStart }) {
  const [customDuration, setCustomDuration] = useState(
    DURATION_OPTIONS.includes(settings.duration) ? "" : String(settings.duration)
  );
  const [customTarget, setCustomTarget] = useState(
    TARGET_SCORE_OPTIONS.includes(settings.targetScore) ? "" : String(settings.targetScore)
  );
  const [customPass, setCustomPass] = useState(
    settings.passLimit === null ? "" : String(settings.passLimit)
  );
  const [unlimitedPass, setUnlimitedPass] = useState(settings.passLimit === null);

  const update = (patch) => setSettings({ ...settings, ...patch });

  const applyCustomDuration = (val) => {
    setCustomDuration(val);
    const n = parseInt(val, 10);
    if (n > 0) update({ duration: n });
  };

  // Alan boş bırakılır ya da 0/negatif bir değer yazılırsa, odak alandan ayrılınca
  // makul bir asgari süreye (30sn) sabitlenir — geçersiz/eksik bir süreyle oyunun
  // başlamasını engeller.
  const finalizeDuration = () => {
    const n = parseInt(customDuration, 10);
    const safe = !customDuration || isNaN(n) || n <= 0 ? MIN_DURATION : n;
    setCustomDuration(String(safe));
    update({ duration: safe });
  };

  const applyCustomTarget = (val) => {
    setCustomTarget(val);
    const n = parseInt(val, 10);
    if (n > 0) update({ targetScore: n });
  };

  const finalizeTarget = () => {
    const n = parseInt(customTarget, 10);
    const safe = !customTarget || isNaN(n) || n <= 0 ? MIN_TARGET_SCORE : n;
    setCustomTarget(String(safe));
    update({ targetScore: safe });
  };

  const applyCustomPass = (val) => {
    setCustomPass(val);
    const n = parseInt(val, 10);
    if (n >= 0) update({ passLimit: n });
  };

  const finalizePass = () => {
    if (unlimitedPass) return;
    const n = parseInt(customPass, 10);
    // Pas hakkı 0 geçerli bir değerdir (Pas butonu tamamen deaktif olur); yalnızca
    // boş/negatif/geçersiz girdi düzeltilir.
    const safe = !customPass || isNaN(n) || n < 0 ? 0 : n;
    setCustomPass(String(safe));
    update({ passLimit: safe });
  };

  const toggleUnlimited = () => {
    const next = !unlimitedPass;
    setUnlimitedPass(next);
    update({ passLimit: next ? null : parseInt(customPass || "3", 10) });
  };

  const toggleCategory = (key) => {
    const current = settings.categories || [];
    if (current.includes(key)) {
      if (current.length > 1) update({ categories: current.filter((c) => c !== key) });
    } else {
      update({ categories: [...current, key] });
    }
  };

  const selectAllCategories = () => update({ categories: window.WORD_CATEGORIES.map((c) => c.key) });
  const clearAllCategories = () => update({ categories: [] });

  const durationSection = h(
    "section",
    { key: "duration" },
    h("h2", { className: "section-label mb-3" }, "Tur Süresi (saniye)"),
    h(
      "div",
      { className: "flex flex-wrap gap-3" },
      DURATION_OPTIONS.map((d) =>
        h(
          "button",
          {
            key: d,
            onClick: () => {
              update({ duration: d });
              setCustomDuration("");
            },
            className: `option-chip ${settings.duration === d && customDuration === "" ? "active" : ""}`,
          },
          `${d}s`
        )
      ),
      h("input", {
        key: "custom-duration",
        type: "number",
        min: "5",
        placeholder: "Özel",
        value: customDuration,
        onChange: (e) => applyCustomDuration(e.target.value),
        onBlur: finalizeDuration,
        className: "field-input",
      })
    )
  );

  const difficultySection = h(
    "section",
    { key: "difficulty" },
    h("h2", { className: "section-label mb-3" }, "Zorluk Seviyesi"),
    h(
      "div",
      { className: "flex flex-wrap gap-3" },
      DIFFICULTY_OPTIONS.map((opt) =>
        h(
          "button",
          {
            key: opt.key,
            onClick: () => update({ difficulty: opt.key }),
            className: `option-chip ${settings.difficulty === opt.key ? "active" : ""}`,
          },
          `${opt.label} (${opt.forbiddenCount} kelime)`
        )
      )
    )
  );

  const passSection = h(
    "section",
    { key: "pass" },
    h("h2", { className: "section-label mb-3" }, "Pas Hakkı"),
    h(
      "div",
      { className: "flex flex-wrap items-center gap-3" },
      h(
        "button",
        { key: "unlimited", onClick: toggleUnlimited, className: `option-chip ${unlimitedPass ? "active" : ""}` },
        "Sınırsız"
      ),
      h("input", {
        key: "custom-pass",
        type: "number",
        min: "0",
        disabled: unlimitedPass,
        placeholder: "Adet",
        value: customPass,
        onChange: (e) => applyCustomPass(e.target.value),
        onBlur: finalizePass,
        className: "field-input disabled:opacity-40",
      })
    )
  );

  const targetSection = h(
    "section",
    { key: "target" },
    h("h2", { className: "section-label mb-3" }, "Hedef Puan (Kazanma Skoru)"),
    h(
      "div",
      { className: "flex flex-wrap gap-3" },
      TARGET_SCORE_OPTIONS.map((s) =>
        h(
          "button",
          {
            key: s,
            onClick: () => {
              update({ targetScore: s });
              setCustomTarget("");
            },
            className: `option-chip ${settings.targetScore === s && customTarget === "" ? "active" : ""}`,
          },
          String(s)
        )
      ),
      h("input", {
        key: "custom-target",
        type: "number",
        min: "1",
        placeholder: "Özel",
        value: customTarget,
        onChange: (e) => applyCustomTarget(e.target.value),
        onBlur: finalizeTarget,
        className: "field-input",
      })
    )
  );

  const feedbackSection = h(
    "section",
    { key: "feedback" },
    h("h2", { className: "section-label mb-3" }, "Geri Bildirim"),
    h(
      "div",
      { className: "flex flex-wrap gap-3" },
      h(
        "button",
        {
          onClick: () => update({ soundEnabled: settings.soundEnabled === false }),
          className: `toggle-chip ${settings.soundEnabled === false ? "" : "active"}`,
        },
        h(Icon, { name: settings.soundEnabled === false ? "speakerOff" : "speakerOn", size: 16 }),
        settings.soundEnabled === false ? "Ses Kapalı" : "Ses Açık"
      ),
      h(
        "button",
        {
          onClick: () => update({ hapticsEnabled: settings.hapticsEnabled === false }),
          className: `toggle-chip ${settings.hapticsEnabled === false ? "" : "active"}`,
        },
        h(Icon, { name: "vibrate", size: 16 }),
        settings.hapticsEnabled === false ? "Titreşim Kapalı" : "Titreşim Açık"
      )
    )
  );

  const categorySection = h(
    "section",
    { key: "categories" },
    h(
      "div",
      { className: "flex items-center justify-between mb-3" },
      h("h2", { className: "section-label" }, "Kategoriler"),
      h(
        "div",
        { className: "flex gap-3" },
        h("button", { onClick: selectAllCategories, className: "text-xs parchment-link" }, "Tümünü Seç"),
        h("button", { onClick: clearAllCategories, className: "text-xs parchment-link" }, "Tümünü Kaldır")
      )
    ),
    h(CategoryRow, {
      categories: window.WORD_CATEGORIES,
      activeKeys: settings.categories || [],
      onToggle: toggleCategory,
    })
  );

  return h(
    "div",
    {
      className: "app-screen flex flex-col items-center px-4 py-6 fade-in",
      // UpdateBanner (swUpdateAvailable) hiçbir phase koşuluna bağlı değildir,
      // "setup" fazındayken de üstte sabit belirebilir; diğer ekranlardaki
      // (ProfilesScreen/StatsDashboardScreen) aynı üst boşluk deseniyle
      // tutarlı şekilde bu ekranda da yer açıyoruz.
      style: { paddingTop: "calc(env(safe-area-inset-top) + 84px)" },
    },
    h(
      "div",
      { className: "plaque mb-4" },
      h("h1", { className: "font-display plaque-text text-2xl sm:text-3xl" }, "OYUN AYARLARI")
    ),
    h(
      "div",
      { className: "parchment flex-1 overflow-y-auto scrollbar-none space-y-6 p-6", style: { width: "100%", maxWidth: "34rem" } },
      durationSection,
      difficultySection,
      passSection,
      targetSection,
      feedbackSection,
      categorySection
    ),
    h(
      "div",
      { className: "flex gap-4 py-4 pb-safe" },
      h("button", { onClick: onBack, className: "btn btn-secondary" }, "GERİ"),
      h("button", { onClick: onStart, className: "btn btn-primary" }, "OYUNU BAŞLAT")
    )
  );
}

// ---------------------------------------------------------------------------
// Skor Tablosu (üstte her zaman görünür)
// Performans: React.memo ile sarmalanır — sayaç her saniye tetiklendiğinde
// GameScreen yeniden render olsa da, teams/currentTeamId değişmediği sürece
// bu alt ağaç yeniden çizilmez.
// ---------------------------------------------------------------------------
const ScoreBar = React.memo(function ScoreBar({ teams, currentTeamId }) {
  return h(
    "div",
    { className: "score-bar-row" },
    teams.map((team, idx) =>
      h(
        "div",
        {
          key: team.id,
          className: `score-chip flex items-center gap-2 px-3 py-1.5 rounded-full ${team.id === currentTeamId ? "active" : ""}`,
        },
        h("span", { className: "w-2.5 h-2.5 rounded-full", style: { backgroundColor: TEAM_COLORS[idx % TEAM_COLORS.length] } }),
        h("span", { className: "text-sm text-gray-200 font-medium" }, team.name),
        h("span", { className: "text-sm font-bold text-white" }, String(team.score))
      )
    )
  );
});

// ---------------------------------------------------------------------------
// Hazır Ekranı (sıradaki takım). İlk turda hangi takımın başlayacağı rastgele
// seçilir; announceRandom true iken takım isimleri arasında kısa bir "kura
// çekme" animasyonu oynatılıp gerçek başlangıç takımında durulur.
// ---------------------------------------------------------------------------
function ReadyScreen({ team, onStart, teams, announceRandom, onAnnounceDone }) {
  const [displayName, setDisplayName] = useState(team.name);
  const [announcing, setAnnouncing] = useState(!!announceRandom);

  useEffect(() => {
    if (!announceRandom) {
      setDisplayName(team.name);
      setAnnouncing(false);
      return undefined;
    }
    setAnnouncing(true);
    let ticks = 0;
    const totalTicks = 14;
    const interval = setInterval(() => {
      ticks += 1;
      setDisplayName(teams[ticks % teams.length].name);
      if (ticks >= totalTicks) {
        clearInterval(interval);
        setDisplayName(team.name);
        setAnnouncing(false);
        if (onAnnounceDone) onAnnounceDone();
      }
    }, 90);
    return () => clearInterval(interval);
    // team/teams kasıtlı olarak izlenmiyor: animasyon yalnızca announceRandom
    // true olduğunda bir kez tetiklenmeli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announceRandom]);

  return h(
    "div",
    { className: "app-screen flex flex-col fade-in" },
    h(
      "div",
      { className: "history-btn", style: { right: "auto", left: "max(14px, env(safe-area-inset-left))", cursor: "default" } },
      h(Icon, { name: "people", size: 15 })
    ),
    h(ScoreBar, { teams, currentTeamId: team.id }),
    h(
      "div",
      { className: "flex-1 flex flex-col items-center justify-center px-4 text-center" },
      h("div", { className: "plaque plaque-small mb-6" }, h("span", { className: "plaque-text text-sm" }, announcing ? "KİM BAŞLAYACAK?" : "ŞİMDİ OYNATILIYOR")),
      h(
        "div",
        { className: `plaque plaque-forest mb-8 ${announcing ? "flash-text" : ""}` },
        h("h1", { className: "font-display plaque-text text-4xl sm:text-6xl" }, displayName)
      ),
      !announcing &&
        h(
          React.Fragment,
          null,
          h(Icon, { name: "hourglass", size: 84, className: "mb-8", style: { color: "var(--bronze-300)", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.5))" } }),
          h(
            "button",
            { onClick: onStart, className: "btn btn-primary btn-large" },
            h(Icon, { name: "play", size: 18 }),
            "BAŞLA"
          )
        )
    )
  );
}

// ---------------------------------------------------------------------------
// Oyun Ekranı
// ---------------------------------------------------------------------------
function PauseOverlay({ onResume, onEndGame }) {
  return h(
    "div",
    { className: "blackout" },
    h(
      "div",
      { className: "text-center px-6 fade-in" },
      h("div", { className: "plaque mb-8" }, h("h1", { className: "font-display plaque-text text-4xl sm:text-6xl tracking-widest" }, "DURAKLATILDI")),
      h(
        "div",
        { className: "flex flex-col items-center gap-3" },
        h("button", { onClick: onResume, className: "btn btn-primary btn-large" }, h(Icon, { name: "play", size: 16 }), "Devam Et"),
        h("button", { onClick: onEndGame, className: "btn btn-secondary" }, h(Icon, { name: "stop", size: 14 }), "Oyunu Bitir")
      )
    )
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return h(
    "div",
    { className: "modal-overlay", onClick: onCancel },
    h(
      "div",
      { className: "modal-card", onClick: (e) => e.stopPropagation(), style: { maxWidth: "360px" } },
      h("div", { className: "modal-titlebar" }, h("span", { className: "modal-title" }, title)),
      h("div", { className: "modal-body text-center" }, h("p", { className: "text-sm" }, message)),
      h(
        "div",
        { className: "modal-footer" },
        h("button", { onClick: onCancel, className: "btn btn-secondary" }, cancelLabel || "Vazgeç"),
        h("button", { onClick: onConfirm, className: "btn btn-danger" }, confirmLabel || "Onayla")
      )
    )
  );
}

// Performans: kelime kartı yalnızca `card`/`forbiddenCount` değiştiğinde yeniden
// çizilir. GameScreen çağrısında `key: card.id` verilir; bu, sayaç her saniye
// GameScreen'i render ederken kartın gereksiz yere yeniden hesaplanmasını
// engellerken, kelime gerçekten değiştiğinde DOM düğümünün yeniden monte
// edilip pop-in animasyonunun her yeni kelimede tekrar oynamasını sağlar.
const WordCard = React.memo(function WordCard({ card, forbiddenCount }) {
  return h(
    "div",
    { key: card.id, className: "word-card pop-in relative w-full max-w-md p-6 sm:p-8" },
    h("span", { className: "rivet rivet-tl" }),
    h("span", { className: "rivet rivet-tr" }),
    h("span", { className: "rivet rivet-bl" }),
    h("span", { className: "rivet rivet-br" }),
    h("h2", { className: "font-display text-4xl sm:text-5xl text-center mb-6 uppercase" }, card.word),
    h(
      "div",
      { className: "space-y-2" },
      card.forbidden.slice(0, forbiddenCount).map((w) =>
        h(
          "div",
          { key: w, className: "forbidden-row flex items-center gap-3 py-2 px-2" },
          h(Icon, { name: "x", size: 13, style: { color: "var(--burgundy-500)", flex: "0 0 auto" } }),
          h("span", { className: "text-gray-300 text-lg" }, w)
        )
      )
    )
  );
});

// ---------------------------------------------------------------------------
// Dairesel geri sayım — bronz halka + yeşil/amber/bordo ilerleme yayı.
// ---------------------------------------------------------------------------
function CircularTimer({ timeLeft, duration, urgent, warning }) {
  const size = 104;
  const stroke = 7;
  const r = (size - stroke) / 2 - 4;
  const circumference = 2 * Math.PI * r;
  const pct = duration > 0 ? Math.max(0, Math.min(1, timeLeft / duration)) : 0;
  const offset = circumference * (1 - pct);
  const center = size / 2;
  const cls = urgent ? "urgent" : warning ? "warning" : "";

  return h(
    "div",
    { className: `circular-timer ${cls}`, style: { width: size, height: size } },
    h(
      "svg",
      { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      h("circle", { className: "circular-timer-bezel", cx: center, cy: center, r: r + 4, strokeWidth: 3 }),
      h("circle", { className: "circular-timer-track", cx: center, cy: center, r, strokeWidth: stroke, fill: "none" }),
      h("circle", {
        className: "circular-timer-fill",
        cx: center,
        cy: center,
        r,
        strokeWidth: stroke,
        fill: "none",
        strokeDasharray: circumference,
        strokeDashoffset: offset,
        transform: `rotate(-90 ${center} ${center})`,
      })
    ),
    h(
      "div",
      { className: "circular-timer-value" },
      h("span", { className: "circular-timer-number" }, String(Math.max(0, timeLeft))),
      h("span", { className: "circular-timer-unit" }, "sn")
    )
  );
}

function EmptyDeckFallback({ onEndGame }) {
  return h(
    "div",
    { className: "app-screen flex flex-col items-center justify-center px-4 text-center fade-in" },
    h("div", { className: "plaque mb-6" }, h("h1", { className: "font-display plaque-text text-2xl sm:text-3xl" }, "Kelime Havuzu Bulunamadı")),
    h(
      "p",
      { className: "text-gray-400 mb-8 max-w-sm" },
      "Seçili kategoriler için kelime yüklenemedi. Bu genelde words.js dosyasının yüklenememesinden kaynaklanır — sayfayı yenilemeyi deneyin."
    ),
    h("button", { onClick: onEndGame, className: "btn btn-danger" }, "Oyunu Bitir")
  );
}

function GameScreen({
  teams,
  currentTeam,
  settings,
  deck,
  cardIndex,
  timeLeft,
  passesLeft,
  isPaused,
  canUndo,
  onCorrect,
  onTabu,
  onPass,
  onUndo,
  onTogglePause,
  onEndGame,
}) {
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  if (!deck || deck.length === 0) {
    return h(EmptyDeckFallback, { onEndGame });
  }

  const forbiddenCount = DIFFICULTY_OPTIONS.find((d) => d.key === settings.difficulty).forbiddenCount;
  const card = deck[cardIndex % deck.length];
  const urgentAt = Math.min(5, Math.ceil(settings.duration * 0.1));
  const warningAt = Math.min(10, Math.ceil(settings.duration * 0.2));
  const urgent = timeLeft <= urgentAt;
  const warning = !urgent && timeLeft <= warningAt;
  const passDisabled = settings.passLimit !== null && passesLeft <= 0;

  return h(
    "div",
    { className: "app-screen flex flex-col" },
    h(
      "div",
      { className: "game-controls" },
      h("button", { onClick: onTogglePause, className: "game-control-btn", "aria-label": "Duraklat" }, h(Icon, { name: "pause", size: 16 })),
      h(
        "button",
        { onClick: onUndo, disabled: !canUndo, className: "game-control-btn", "aria-label": "Son işlemi geri al", title: "Geri Al" },
        h(Icon, { name: "undo", size: 17 })
      ),
      h("button", { onClick: () => setShowEndConfirm(true), className: "game-control-btn", "aria-label": "Bitir" }, h(Icon, { name: "stop", size: 14 }))
    ),
    h(ScoreBar, { teams, currentTeamId: currentTeam.id }),
    h(
      "div",
      { className: "px-4 sm:px-8 mt-1 flex flex-col items-center" },
      h("p", { className: "text-center text-gray-400 text-xs uppercase tracking-widest mb-1" }, `${currentTeam.name} oynuyor`),
      h(CircularTimer, { timeLeft, duration: settings.duration, urgent, warning })
    ),
    h(
      "div",
      { className: "game-card-area px-4" },
      h(WordCard, { key: card.id, card, forbiddenCount })
    ),
    h(
      "div",
      { className: "grid grid-cols-3 gap-3 sm:gap-4 px-4 sm:px-8 pb-5 pb-safe max-w-2xl mx-auto w-full" },
      h("button", { onClick: onTabu, className: "btn btn-danger btn-large flex-col" }, h(Icon, { name: "x", size: 20 }), "Tabu"),
      h(
        "button",
        { onClick: onPass, disabled: passDisabled, className: "btn btn-metal btn-large flex-col" },
        h(Icon, { name: "arrowRight", size: 20 }),
        `Pas${settings.passLimit !== null ? ` (${passesLeft})` : ""}`
      ),
      h("button", { onClick: onCorrect, className: "btn btn-primary btn-large flex-col" }, h(Icon, { name: "check", size: 20 }), "Doğru")
    ),
    isPaused && h(PauseOverlay, { onResume: onTogglePause, onEndGame }),
    showEndConfirm &&
      h(ConfirmDialog, {
        title: "Oyunu Bitir",
        message: "Oyunu şimdi bitirmek istediğine emin misin? Mevcut skorlara göre bir kazanan belirlenecek.",
        confirmLabel: "Evet, Bitir",
        cancelLabel: "Vazgeç",
        onConfirm: () => {
          setShowEndConfirm(false);
          onEndGame();
        },
        onCancel: () => setShowEndConfirm(false),
      })
  );
}

// ---------------------------------------------------------------------------
// Süre Doldu Ekranı
// ---------------------------------------------------------------------------
function RoundEndScreen({ team, stats, nextTeam, onNext }) {
  return h(
    "div",
    { className: "blackout" },
    h(
      "div",
      { className: "text-center px-6 fade-in", style: { width: "100%", maxWidth: "26rem" } },
      h(
        "div",
        { className: "flex items-center justify-center gap-3 mb-8" },
        h(Icon, { name: "star", size: 18, className: "laurel-deco" }),
        h("div", { className: "plaque" }, h("h1", { className: "font-display plaque-text text-4xl sm:text-6xl tracking-widest" }, "SÜRE DOLDU!")),
        h(Icon, { name: "star", size: 18, className: "laurel-deco" })
      ),
      h("p", { className: "text-gray-300 mb-6 text-lg" }, `${team.name} turu bitti`),
      h(
        "div",
        { className: "flex gap-3 mb-8" },
        h(
          "div",
          { className: "score-tile score-tile-correct" },
          h(Icon, { name: "check", size: 18, style: { color: "#fff" } }),
          h("span", { className: "score-tile-label" }, "Doğru"),
          h("span", { className: "score-tile-value" }, String(stats.correct))
        ),
        h(
          "div",
          { className: "score-tile score-tile-tabu" },
          h(Icon, { name: "x", size: 18, style: { color: "#fff" } }),
          h("span", { className: "score-tile-label" }, "Tabu"),
          h("span", { className: "score-tile-value" }, String(stats.tabu))
        ),
        h(
          "div",
          { className: "score-tile score-tile-pass" },
          h(Icon, { name: "arrowRight", size: 18, style: { color: "#fff" } }),
          h("span", { className: "score-tile-label" }, "Pas"),
          h("span", { className: "score-tile-value" }, String(stats.passed))
        )
      ),
      h("button", { onClick: onNext, className: "btn btn-primary btn-large btn-full" }, `SONRAKİ TUR — ${nextTeam.name}`)
    )
  );
}

// ---------------------------------------------------------------------------
// Maç Sonu İstatistik Dashboard'u
// ---------------------------------------------------------------------------
const CONFETTI_COLORS = ["#D1AC62", "#3E6B45", "#8C2A2A", "#E1C48A", "#4A5A72", "#EAD3A3"];

function StatTile({ label, value }) {
  return h("div", { className: "stat-tile" }, h("p", { className: "stat-tile-label" }, label), h("p", { className: "stat-tile-value" }, value));
}

function StatusLegend() {
  return h(
    "div",
    { className: "status-legend" },
    h("span", { className: "legend-item" }, h("span", { className: "legend-dot", style: { backgroundColor: "var(--forest-500)" } }), "Doğru"),
    h("span", { className: "legend-item" }, h("span", { className: "legend-dot", style: { backgroundColor: "var(--burgundy-500)" } }), "Tabu"),
    h("span", { className: "legend-item" }, h("span", { className: "legend-dot", style: { backgroundColor: "var(--metal-500)" } }), "Pas")
  );
}

function TeamPerfBar({ team, stats }) {
  const total = stats.total || 1;
  const correctPct = (stats.correct / total) * 100;
  const tabuPct = (stats.tabu / total) * 100;
  const passPct = (stats.passed / total) * 100;
  return h(
    "div",
    { className: "team-perf-row" },
    h("p", { className: "team-perf-name" }, team.name),
    h(
      "div",
      { className: "team-perf-bar" },
      correctPct > 0 && h("span", { className: "team-perf-seg", style: { width: `${correctPct}%`, backgroundColor: "var(--forest-500)" } }),
      tabuPct > 0 && h("span", { className: "team-perf-seg", style: { width: `${tabuPct}%`, backgroundColor: "var(--burgundy-500)" } }),
      passPct > 0 && h("span", { className: "team-perf-seg", style: { width: `${passPct}%`, backgroundColor: "var(--metal-500)" } })
    ),
    h(
      "p",
      { className: "team-perf-summary" },
      stats.total > 0
        ? `Doğru %${Math.round(correctPct)} · Tabu %${Math.round(tabuPct)} · Pas %${Math.round(passPct)}`
        : "Bu takım için veri yok"
    )
  );
}

function StatsDashboardScreen({ teams, winner, wordLog, allTime, onRestart }) {
  const sorted = teams.slice().sort((a, b) => b.score - a.score);
  const stats = useMemo(() => computeGameStats(wordLog, teams), [wordLog, teams]);
  const [shareState, setShareState] = useState("idle"); // idle | copied

  const confetti = useMemo(
    () =>
      Array.from({ length: 70 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 2,
        duration: 2.5 + Math.random() * 2.5,
        size: 6 + Math.random() * 7,
      })),
    []
  );

  const handleShare = async () => {
    const text = `${winner.name} Brolis Tabu'da ${winner.score} puanla birinci oldu! 🏆`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Brolis Tabu", text });
      } catch (e) {
        /* kullanıcı paylaşımı iptal etti — sessizce yoksay */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    } catch (e) {
      /* pano erişimi yok — sessizce yoksay */
    }
  };

  return h(
    "div",
    {
      className: "app-screen flex flex-col items-center px-4 py-6 relative",
      style: { paddingTop: "calc(env(safe-area-inset-top) + 84px)" },
    },
    h(
      "div",
      { className: "confetti-layer" },
      confetti.map((c) =>
        h("span", {
          key: c.id,
          className: "confetti-piece",
          style: {
            left: `${c.left}%`,
            backgroundColor: c.color,
            width: `${c.size}px`,
            height: `${c.size * 1.6}px`,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
          },
        })
      )
    ),
    h(Icon, { name: "trophy", size: 62, className: "trophy-glow mb-3" }),
    h("p", { className: "text-gray-400 uppercase tracking-widest mb-2" }, "Kazanan"),
    h("div", { className: "plaque plaque-forest mb-2" }, h("h1", { className: "font-display plaque-text text-3xl sm:text-4xl" }, winner.name)),
    allTime.gamesPlayed > 0 &&
      h("p", { className: "all-time-tag mb-3" }, `Rekor: ${allTime.bestScore} puan (${allTime.bestTeamName}) · toplam ${allTime.gamesPlayed}. oyun`),

    h(
      "div",
      { className: "w-full max-w-2xl flex-1 overflow-y-auto scrollbar-none" },
      h(
        "div",
        { className: "grid grid-cols-2 gap-3 sm:gap-4 mb-4" },
        h(StatTile, {
          label: "En hızlı doğru bilinen kelime",
          value: stats.fastest ? `${stats.fastest.word} · ${(stats.fastest.durationMs / 1000).toFixed(1)}sn` : "Veri yok",
        }),
        h(StatTile, {
          label: "En uzun süren kelime",
          value: stats.slowest ? `${stats.slowest.word} · ${(stats.slowest.durationMs / 1000).toFixed(1)}sn` : "Veri yok",
        })
      ),
      h(
        "div",
        { className: "dashboard-card" },
        h("h3", { className: "dashboard-card-title" }, "Takım Performansları"),
        h(StatusLegend, null),
        teams.map((t) => h(TeamPerfBar, { key: t.id, team: t, stats: stats.byTeam[t.name] || { correct: 0, tabu: 0, passed: 0, total: 0 } }))
      ),
      h(
        "div",
        { className: "dashboard-card" },
        h("h3", { className: "dashboard-card-title flex items-center gap-2" }, h(Icon, { name: "fire", size: 16, style: { color: "var(--burgundy-500)" } }), "Zorlu Kelimeler"),
        stats.zorluKelimeler.length === 0
          ? h("p", { className: "text-gray-400 text-sm" }, "Bu oyunda öne çıkan zorlu bir kelime olmadı.")
          : stats.zorluKelimeler.map((s, idx) =>
              h(
                "div",
                { key: s.word, className: "struggle-row" },
                h("span", { className: "struggle-rank" }, `#${idx + 1}`),
                h("span", { className: "struggle-word" }, s.word),
                h("span", { className: "struggle-badge" }, stats.zorluKelimelerShared ? `${s.teamCount} takım zorlandı` : `${s.count} kez zorlandı`)
              )
            )
      ),
      h(
        "div",
        { className: "w-full max-w-sm mx-auto space-y-2 my-6" },
        sorted.map((t, idx) =>
          h(
            "div",
            { key: t.id, className: "flex items-center justify-between px-4 py-3 rounded bg-black/40 border border-gray-700" },
            h("span", { className: "text-gray-200" }, `${idx + 1}. ${t.emoji ? t.emoji + " " : ""}${t.name}`),
            h("span", { className: "font-bold text-white" }, String(t.score))
          )
        )
      )
    ),

    h(
      "div",
      { className: "flex gap-3 py-3 pb-safe" },
      h("button", { onClick: handleShare, className: "btn btn-secondary" }, h(Icon, { name: "share", size: 15 }), shareState === "copied" ? "Kopyalandı" : "Paylaş"),
      h("button", { onClick: onRestart, className: "btn btn-primary btn-large" }, "YENİDEN OYNA")
    )
  );
}

// ---------------------------------------------------------------------------
// Tur Geçmişi
// ---------------------------------------------------------------------------
function HistoryButton({ onClick }) {
  return h("button", { onClick, className: "history-btn" }, h(Icon, { name: "history", size: 15 }), "Geçmiş");
}

function HistoryPanel({ history, onClose }) {
  return h(
    "div",
    { className: "modal-overlay", onClick: onClose },
    h(
      "div",
      { className: "modal-card", onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "modal-titlebar" },
        h("span", { className: "modal-title" }, "Tur Geçmişi"),
        h("button", { onClick: onClose, className: "modal-close", "aria-label": "Kapat" }, h(Icon, { name: "x", size: 18 }))
      ),
      h(
        "div",
        { className: "modal-body" },
        history.length === 0
          ? h("p", { className: "text-sm" }, "Henüz tamamlanmış bir tur yok.")
          : history
              .slice()
              .reverse()
              .map((r) =>
                h(
                  "div",
                  { key: r.id, className: "history-row" },
                  h("span", null, `#${r.id} ${r.teamName}`),
                  h("span", null, `✓${r.correct}  ✕${r.tabu}  →${r.passed}  (net ${r.net >= 0 ? "+" : ""}${r.net})`)
                )
              )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Uygulama içi bildirim bantları (PWA kurulum teşviki / yeni sürüm)
// ---------------------------------------------------------------------------
function InstallBanner({ variant, onInstallClick, onDismiss }) {
  return h(
    "div",
    { className: "install-banner pb-safe" },
    h(
      "span",
      { className: "install-banner-text" },
      variant === "ios" ? "Ana ekrana eklemek için Paylaş → Ana Ekrana Ekle'ye dokun" : "Daha hızlı erişim için uygulamayı ana ekranına yükle"
    ),
    variant !== "ios" &&
      h("button", { className: "install-banner-btn", onClick: onInstallClick }, h(Icon, { name: "download", size: 14 }), "Yükle"),
    h("button", { className: "install-banner-close", onClick: onDismiss, "aria-label": "Kapat" }, h(Icon, { name: "x", size: 15 }))
  );
}

function UpdateBanner({ onReload }) {
  return h(
    "div",
    { className: "update-banner" },
    h("span", null, "Yeni sürüm hazır"),
    h("button", { className: "update-banner-btn", onClick: onReload }, h(Icon, { name: "refresh", size: 13 }), "Yenile")
  );
}

// ---------------------------------------------------------------------------
// Ana Uygulama
// ---------------------------------------------------------------------------
function App() {
  const persisted = useMemo(loadPersisted, []);

  // NOT: localStorage'dan gelen takımların puanı her zaman 0'a sıfırlanır.
  // Puan yalnızca aktif bir oyun oturumunda anlamlıdır; bir önceki oyundan kalan
  // puanla (sayfa yenilenince ya da "Yeniden Oyna" tıklanmadan yeniden açılınca)
  // yeni oyunun sıfırdan değil "ekstra puandan" başlamasının kök nedeni buydu.
  const [teams, setTeams] = useState(() => {
    const base = persisted?.teams || defaultTeams();
    return base.map((t, idx) => ({ ...t, score: 0, emoji: t.emoji || EMOJI_OPTIONS[idx % EMOJI_OPTIONS.length] }));
  });
  const [settings, setSettings] = useState(() => ({ ...defaultSettings(), ...(persisted?.settings || {}) }));
  const [allTime, setAllTime] = useState(() => ({ ...defaultAllTime(), ...(persisted?.allTime || {}) }));
  const [phase, setPhase] = useState("profiles"); // profiles | setup | ready | playing | roundEnd | gameOver

  const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
  const [recentWordIds, setRecentWordIds] = useState(() => persisted?.recentWordIds || []);
  const [deck, setDeck] = useState(() => buildFreshDeck(getFilteredPool(settings.categories), persisted?.recentWordIds || []));
  const [cardIndex, setCardIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(settings.duration);
  const [passesLeft, setPassesLeft] = useState(settings.passLimit);
  const [roundStats, setRoundStats] = useState({ correct: 0, tabu: 0, passed: 0 });
  const [roundHistory, setRoundHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [winner, setWinner] = useState(null);
  const [wordLog, setWordLog] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [flash, setFlash] = useState(null); // { type: 'correct' | 'tabu', seq } | null
  const [randomPickPending, setRandomPickPending] = useState(false);

  const [installEvent, setInstallEvent] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return localStorage.getItem("tabu-install-dismissed") === "1";
    } catch (e) {
      return false;
    }
  });
  const [isIosTip, setIsIosTip] = useState(false);
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false);

  const timerRef = useRef(null);
  const cardStartRef = useRef(Date.now());
  const lastActionAtRef = useRef(0);
  const undoSnapshotRef = useRef(null);
  const flashTimeoutRef = useRef(null);
  const flashSeqRef = useRef(0);

  // Oyun aktifken ekranın kararıp kilitlenmesini engelle.
  useWakeLock(phase === "ready" || phase === "playing" || phase === "roundEnd" || phase === "gameOver");

  // Ses/titreşim tercihlerini global bayrağa senkronize et.
  useEffect(() => {
    window.__tabuPrefs = {
      sound: settings.soundEnabled !== false,
      haptics: settings.hapticsEnabled !== false,
    };
  }, [settings.soundEnabled, settings.hapticsEnabled]);

  // PWA "Ana Ekrana Ekle" istemini yakala (index.html'deki erken script tarafından
  // window.__installPromptEvent üzerinde tutulur) ve iOS için elle ekleme ipucu göster.
  useEffect(() => {
    if (window.__installPromptEvent) setInstallEvent(window.__installPromptEvent);
    const onCaptured = () => setInstallEvent(window.__installPromptEvent);
    const onInstalled = () => {
      setInstallEvent(null);
      setInstallDismissed(true);
    };
    window.addEventListener("bip-captured", onCaptured);
    window.addEventListener("appinstalled", onInstalled);

    const ua = window.navigator.userAgent || "";
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isStandalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    if (isIos && !isStandalone) setIsIosTip(true);

    return () => {
      window.removeEventListener("bip-captured", onCaptured);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Servis çalışanı arka planda yeni bir sürüm indirdiğinde (index.html'deki
  // kayıt betiği tarafından tetiklenir) kullanıcıya yenileme banner'ı göster.
  useEffect(() => {
    const handler = () => setSwUpdateAvailable(true);
    window.addEventListener("sw-update-available", handler);
    return () => window.removeEventListener("sw-update-available", handler);
  }, []);

  useEffect(() => {
    // Puan hiç kaydedilmez — yalnızca isim/id/emoji kalıcı olsun, bir sonraki
    // açılışta her zaman 0'dan başlansın (ayrıca bkz. teams state'in ilk yüklenme
    // mantığı). allTime ise tüm zamanların rekorunu takip eder, sıfırlanmaz.
    persist({
      teams: teams.map((t) => ({ id: t.id, name: t.name, emoji: t.emoji })),
      settings,
      allTime,
      recentWordIds,
    });
  }, [teams, settings, allTime, recentWordIds]);

  // Zamanlayıcı
  useEffect(() => {
    if (phase !== "playing" || isPaused) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        const next = t - 1;
        if (next > 0 && next <= 5) playSound("tick");
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, isPaused]);

  useEffect(() => {
    if (phase === "playing" && timeLeft <= 0) {
      clearInterval(timerRef.current);
      playSound("buzzer");
      vibrate([60, 50, 60, 50, 90]);
      setRoundHistory((h) => [
        ...h,
        {
          id: h.length + 1,
          teamName: currentTeam.name,
          correct: roundStats.correct,
          tabu: roundStats.tabu,
          passed: roundStats.passed,
          net: roundStats.correct - roundStats.tabu,
        },
      ]);
      setPhase("roundEnd");
    }
  }, [timeLeft, phase]);

  const currentTeam = teams[currentTeamIndex];

  const advanceCard = useCallback(() => {
    setCardIndex((idx) => {
      const next = idx + 1;
      if (next >= deck.length) {
        setDeck(buildFreshDeck(getFilteredPool(settings.categories), recentWordIds));
        return 0;
      }
      return next;
    });
  }, [deck.length, settings.categories, recentWordIds]);

  const recordGameOver = (winnerTeam) => {
    setAllTime((prev) => {
      const gamesPlayed = prev.gamesPlayed + 1;
      if (winnerTeam.score > prev.bestScore) {
        return { gamesPlayed, bestScore: winnerTeam.score, bestTeamName: winnerTeam.name };
      }
      return { ...prev, gamesPlayed };
    });
  };

  const updateScoreAndCheckWin = (delta) => {
    setTeams((prev) => {
      const updated = prev.map((t) =>
        t.id === currentTeam.id ? { ...t, score: t.score + delta } : t
      );
      const reachedTarget = updated.find((t) => t.score >= settings.targetScore);
      if (reachedTarget) {
        clearInterval(timerRef.current);
        setWinner(reachedTarget);
        recordGameOver(reachedTarget);
        vibrate([40, 30, 40, 30, 40, 30, 120]);
        setPhase("gameOver");
      }
      return updated;
    });
  };

  const logCurrentCard = (result) => {
    const card = deck[cardIndex % deck.length];
    const durationMs = Date.now() - cardStartRef.current;
    cardStartRef.current = Date.now();
    setWordLog((log) => [
      ...log,
      { wordId: card.id, word: card.word, team: currentTeam.name, result, durationMs },
    ]);
    // Kelimeyi "yakın zamanda görülenler" listesine ekler (en sona, en taze
    // olacak şekilde) — bir sonraki deste kurulurken bu kelime geriye atılır.
    setRecentWordIds((ids) => {
      const withoutCard = ids.includes(card.id) ? ids.filter((id) => id !== card.id) : ids;
      const next = [...withoutCard, card.id];
      return next.length > RECENT_WORDS_LIMIT ? next.slice(next.length - RECENT_WORDS_LIMIT) : next;
    });
  };

  // İnsan-üstü hızda art arda tıklamaya (spam-click) karşı koruma: aynı kelime
  // için iki kez puan/log kaydı oluşmasını ya da deck'in iki kez atlanmasını önler.
  const canAct = () => {
    const now = Date.now();
    if (now - lastActionAtRef.current < SPAM_GUARD_MS) return false;
    lastActionAtRef.current = now;
    return true;
  };

  const triggerFlash = (type) => {
    flashSeqRef.current += 1;
    const seq = flashSeqRef.current;
    setFlash({ type, seq });
    clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setFlash((f) => (f && f.seq === seq ? null : f));
    }, 380);
  };

  const captureUndoSnapshot = (scoreDelta) => {
    undoSnapshotRef.current = {
      deck,
      cardIndex,
      roundStats: { ...roundStats },
      passesLeft,
      teamId: currentTeam.id,
      scoreDelta,
      wordLogLen: wordLog.length,
    };
    setCanUndo(true);
  };

  const handleCorrect = () => {
    if (isPaused || !canAct()) return;
    captureUndoSnapshot(1);
    playSound("correct");
    vibrate(25);
    triggerFlash("correct");
    logCurrentCard("correct");
    setRoundStats((s) => ({ ...s, correct: s.correct + 1 }));
    updateScoreAndCheckWin(1);
    advanceCard();
  };

  const handleTabu = () => {
    if (isPaused || !canAct()) return;
    captureUndoSnapshot(-1);
    playSound("tabu");
    vibrate([30, 40, 30]);
    triggerFlash("tabu");
    logCurrentCard("tabu");
    setRoundStats((s) => ({ ...s, tabu: s.tabu + 1 }));
    updateScoreAndCheckWin(-1);
    advanceCard();
  };

  const handlePass = () => {
    if (isPaused || !canAct()) return;
    if (settings.passLimit !== null && passesLeft <= 0) return;
    captureUndoSnapshot(0);
    vibrate(10);
    triggerFlash("pass");
    logCurrentCard("pass");
    setRoundStats((s) => ({ ...s, passed: s.passed + 1 }));
    if (settings.passLimit !== null) setPassesLeft((p) => p - 1);
    advanceCard();
  };

  const handleUndo = () => {
    const snap = undoSnapshotRef.current;
    if (!snap || isPaused || phase !== "playing") return;
    if (snap.scoreDelta) {
      setTeams((prev) => prev.map((t) => (t.id === snap.teamId ? { ...t, score: t.score - snap.scoreDelta } : t)));
    }
    setRoundStats(snap.roundStats);
    setPassesLeft(snap.passesLeft);
    setDeck(snap.deck);
    setCardIndex(snap.cardIndex);
    setWordLog((log) => log.slice(0, snap.wordLogLen));
    undoSnapshotRef.current = null;
    setCanUndo(false);
    vibrate(15);
  };

  const startRound = () => {
    playSound("taDum");
    cardStartRef.current = Date.now();
    setIsPaused(false);
    setTimeLeft(settings.duration);
    setPassesLeft(settings.passLimit);
    setRoundStats({ correct: 0, tabu: 0, passed: 0 });
    undoSnapshotRef.current = null;
    setCanUndo(false);
    setPhase("playing");
  };

  const goNextTeam = () => {
    // Süre dolduğunda ekranda kalan (henüz cevaplanmamış) kelime atlanmazsa bir
    // sonraki takım turuna aynı kelimeyle başlar. Takım değişmeden önce bir
    // adım ilerletmek bu tekrarı önler.
    advanceCard();
    setCurrentTeamIndex((idx) => (idx + 1) % teams.length);
    setPhase("ready");
  };

  const goToReady = () => {
    setDeck(buildFreshDeck(getFilteredPool(settings.categories), recentWordIds));
    setCardIndex(0);
    setCurrentTeamIndex(Math.floor(Math.random() * teams.length));
    setRandomPickPending(true);
    setPhase("ready");
  };

  const togglePause = () => setIsPaused((p) => !p);

  const endGameNow = () => {
    clearInterval(timerRef.current);
    const top = teams.slice().sort((a, b) => b.score - a.score)[0];
    setIsPaused(false);
    setWinner(top);
    recordGameOver(top);
    setPhase("gameOver");
  };

  const restartGame = () => {
    setTeams((prev) => prev.map((t) => ({ ...t, score: 0 })));
    setCurrentTeamIndex(0);
    setDeck(buildFreshDeck(getFilteredPool(settings.categories), recentWordIds));
    setCardIndex(0);
    setRoundHistory([]);
    setWordLog([]);
    setWinner(null);
    setIsPaused(false);
    undoSnapshotRef.current = null;
    setCanUndo(false);
    setFlash(null);
    setPhase("profiles");
  };

  const dismissInstall = () => {
    setInstallDismissed(true);
    try {
      localStorage.setItem("tabu-install-dismissed", "1");
    } catch (e) {
      /* localStorage yok — sessizce yoksay */
    }
  };

  const handleInstallClick = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      await installEvent.userChoice;
    } catch (e) {
      /* seçim tamamlanmadı — sessizce yoksay */
    }
    setInstallEvent(null);
  };

  // screen switch'inden ÖNCE hesaplanıyor (salt layout amaçlı, oyun state/akış
  // mantığını etkilemez) — ProfilesScreen'e alt boşluk açması gerekip
  // gerekmediğini bildirebilmek için InstallBanner'ın gösterilip
  // gösterilmeyeceğini önceden bilmemiz gerekiyor.
  const showInstallBanner = !installDismissed && phase === "profiles" && (installEvent || isIosTip);

  const screen = (() => {
    switch (phase) {
      case "profiles":
        return h(ProfilesScreen, {
          teams,
          setTeams,
          onContinue: () => setPhase("setup"),
          reserveBottomForBanner: showInstallBanner,
        });
      case "setup":
        return h(SettingsScreen, {
          settings,
          setSettings,
          onBack: () => setPhase("profiles"),
          onStart: goToReady,
        });
      case "ready":
        return h(ReadyScreen, {
          team: currentTeam,
          teams,
          onStart: startRound,
          announceRandom: randomPickPending,
          onAnnounceDone: () => setRandomPickPending(false),
        });
      case "playing":
        return h(GameScreen, {
          teams,
          currentTeam,
          settings,
          deck,
          cardIndex,
          timeLeft,
          passesLeft,
          isPaused,
          canUndo,
          onCorrect: handleCorrect,
          onTabu: handleTabu,
          onPass: handlePass,
          onUndo: handleUndo,
          onTogglePause: togglePause,
          onEndGame: endGameNow,
        });
      case "roundEnd":
        return h(RoundEndScreen, {
          team: currentTeam,
          stats: roundStats,
          nextTeam: teams[(currentTeamIndex + 1) % teams.length],
          onNext: goNextTeam,
        });
      case "gameOver":
        return h(StatsDashboardScreen, { teams, winner, wordLog, allTime, onRestart: restartGame });
      default:
        return null;
    }
  })();

  const historyEnabled = phase !== "profiles" && phase !== "setup";

  return h(
    React.Fragment,
    null,
    screen,
    historyEnabled && h(HistoryButton, { onClick: () => setShowHistory(true) }),
    showHistory && h(HistoryPanel, { history: roundHistory, onClose: () => setShowHistory(false) }),
    flash && h("div", { key: flash.seq, className: `action-flash ${flash.type}` }),
    swUpdateAvailable && h(UpdateBanner, { onReload: () => window.location.reload() }),
    showInstallBanner &&
      h(InstallBanner, {
        variant: installEvent ? "android" : "ios",
        onInstallClick: handleInstallClick,
        onDismiss: dismissInstall,
      })
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));

// Açılış ekranını (splash), React içeriği boyandıktan hemen sonra yumuşakça kaldır.
(function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  requestAnimationFrame(() => {
    splash.classList.add("hidden");
    setTimeout(() => splash.remove(), 350);
  });
})();
