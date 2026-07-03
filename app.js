const { useState, useEffect, useRef, useMemo, useCallback } = React;
const h = React.createElement;

const STORAGE_KEY = "netflix-tabu-state-v1";

const TEAM_COLORS = ["#E50914", "#1F8A70", "#2196F3", "#B565D9"];

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

function playSound(name) {
  if (window.TabuAudio && typeof window.TabuAudio[name] === "function") {
    try {
      window.TabuAudio[name]();
    } catch (e) {
      /* ses çalınamadı — sessizce yoksay */
    }
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
    { id: 1, name: "Takım 1", score: 0 },
    { id: 2, name: "Takım 2", score: 0 },
  ];
}

function defaultSettings() {
  return {
    duration: 60,
    difficulty: "medium",
    passLimit: 3, // null = sınırsız
    targetScore: 50,
    categories: window.WORD_CATEGORIES.map((c) => c.key),
  };
}

// ---------------------------------------------------------------------------
// Profil (Kim Oynuyor?) Ekranı
// ---------------------------------------------------------------------------
function ProfilesScreen({ teams, setTeams, onContinue }) {
  const addTeam = () => {
    if (teams.length >= 4) return;
    const nextId = Math.max(0, ...teams.map((t) => t.id)) + 1;
    setTeams([...teams, { id: nextId, name: `Takım ${teams.length + 1}`, score: 0 }]);
  };

  const removeTeam = (id) => {
    if (teams.length <= 2) return;
    setTeams(teams.filter((t) => t.id !== id));
  };

  const renameTeam = (id, name) => {
    setTeams(teams.map((t) => (t.id === id ? { ...t, name } : t)));
  };

  const canContinue = teams.length >= 2 && teams.every((t) => t.name.trim().length > 0);

  return h(
    "div",
    { className: "netflix-bg min-h-screen flex flex-col items-center justify-center px-4 py-12 fade-in" },
    h(
      "h1",
      { className: "font-display text-5xl sm:text-6xl text-white mb-2 tracking-wide" },
      "KİM ",
      h("span", { style: { color: "#E50914" } }, "OYNUYOR?")
    ),
    h(
      "p",
      { className: "text-gray-400 mb-12 text-sm sm:text-base" },
      "2 ile 4 arasında takım oluştur ve isimlerini düzenle"
    ),
    h(
      "div",
      { className: "flex flex-wrap items-start justify-center gap-6 sm:gap-10 max-w-3xl" },
      teams.map((team, idx) =>
        h(
          "div",
          {
            key: team.id,
            className: "profile-tile pop-in relative flex flex-col items-center w-28 sm:w-36",
          },
          teams.length > 2 &&
            h(
              "button",
              {
                key: "remove",
                onClick: () => removeTeam(team.id),
                className:
                  "absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-800 text-gray-300 text-xs flex items-center justify-center hover:bg-red-600 hover:text-white z-10",
                title: "Takımı kaldır",
              },
              "✕"
            ),
          h(
            "div",
            {
              key: "avatar",
              className:
                "avatar w-24 h-24 sm:w-32 sm:h-32 rounded-md flex items-center justify-center font-display text-4xl sm:text-5xl text-white border-2 border-transparent",
              style: { backgroundColor: TEAM_COLORS[idx % TEAM_COLORS.length] },
            },
            team.name.trim().charAt(0).toUpperCase() || "?"
          ),
          h("input", {
            key: "input",
            value: team.name,
            onChange: (e) => renameTeam(team.id, e.target.value.slice(0, 18)),
            className:
              "mt-3 bg-transparent text-center text-gray-300 focus:text-white outline-none border-b border-transparent focus:border-gray-500 w-full text-sm sm:text-base",
            placeholder: "Takım adı",
          })
        )
      ),
      teams.length < 4 &&
        h(
          "button",
          {
            key: "add-team",
            onClick: addTeam,
            className: "profile-tile flex flex-col items-center w-28 sm:w-36 group",
          },
          h(
            "div",
            {
              className:
                "avatar w-24 h-24 sm:w-32 sm:h-32 rounded-md flex items-center justify-center text-5xl text-gray-500 border-2 border-dashed border-gray-600 group-hover:border-gray-400 group-hover:text-gray-300",
            },
            "+"
          ),
          h("span", { className: "mt-3 text-gray-500 text-sm sm:text-base" }, "Takım Ekle")
        )
    ),
    h(
      "button",
      {
        disabled: !canContinue,
        onClick: onContinue,
        className: "btn-action mt-16 px-10 py-3 rounded font-bold tracking-wide text-white disabled:cursor-not-allowed",
        style: { backgroundColor: canContinue ? "#E50914" : "#4b4b4b" },
      },
      "DEVAM ET"
    )
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
        const accent = cat.accent || "#E50914";
        return h(
          "button",
          {
            key: cat.key,
            type: "button",
            onClick: () => onToggle(cat.key),
            className: `category-tile ${active ? "active" : "inactive"}`,
            style: {
              background: `linear-gradient(160deg, ${accent}cc 0%, #101010 120%)`,
            },
          },
          active && h("span", { className: "check-badge" }, "✓"),
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
    h("h2", { className: "text-gray-300 uppercase text-sm tracking-widest mb-3" }, "Tur Süresi (saniye)"),
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
            className: "btn-action px-5 py-2 rounded font-semibold",
            style: {
              backgroundColor: settings.duration === d && customDuration === "" ? "#E50914" : "#2b2b2b",
              color: "white",
            },
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
        className:
          "w-24 px-3 py-2 rounded bg-[#2b2b2b] text-white outline-none focus:ring-2 focus:ring-red-600 placeholder-gray-500",
      })
    )
  );

  const difficultySection = h(
    "section",
    { key: "difficulty" },
    h("h2", { className: "text-gray-300 uppercase text-sm tracking-widest mb-3" }, "Zorluk Seviyesi"),
    h(
      "div",
      { className: "flex flex-wrap gap-3" },
      DIFFICULTY_OPTIONS.map((opt) =>
        h(
          "button",
          {
            key: opt.key,
            onClick: () => update({ difficulty: opt.key }),
            className: "btn-action px-5 py-2 rounded font-semibold",
            style: {
              backgroundColor: settings.difficulty === opt.key ? "#E50914" : "#2b2b2b",
              color: "white",
            },
          },
          `${opt.label} (${opt.forbiddenCount} kelime)`
        )
      )
    )
  );

  const passSection = h(
    "section",
    { key: "pass" },
    h("h2", { className: "text-gray-300 uppercase text-sm tracking-widest mb-3" }, "Pas Hakkı"),
    h(
      "div",
      { className: "flex flex-wrap items-center gap-3" },
      h(
        "button",
        {
          key: "unlimited",
          onClick: toggleUnlimited,
          className: "btn-action px-5 py-2 rounded font-semibold",
          style: { backgroundColor: unlimitedPass ? "#E50914" : "#2b2b2b", color: "white" },
        },
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
        className:
          "w-24 px-3 py-2 rounded bg-[#2b2b2b] text-white outline-none focus:ring-2 focus:ring-red-600 placeholder-gray-500 disabled:opacity-40",
      })
    )
  );

  const targetSection = h(
    "section",
    { key: "target" },
    h("h2", { className: "text-gray-300 uppercase text-sm tracking-widest mb-3" }, "Hedef Puan (Kazanma Skoru)"),
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
            className: "btn-action px-5 py-2 rounded font-semibold",
            style: {
              backgroundColor: settings.targetScore === s && customTarget === "" ? "#E50914" : "#2b2b2b",
              color: "white",
            },
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
        className:
          "w-24 px-3 py-2 rounded bg-[#2b2b2b] text-white outline-none focus:ring-2 focus:ring-red-600 placeholder-gray-500",
      })
    )
  );

  const categorySection = h(
    "section",
    { key: "categories" },
    h(
      "div",
      { className: "flex items-center justify-between mb-3" },
      h("h2", { className: "text-gray-300 uppercase text-sm tracking-widest" }, "Kategoriler"),
      h(
        "div",
        { className: "flex gap-3" },
        h(
          "button",
          { onClick: selectAllCategories, className: "text-xs text-gray-400 hover:text-white underline" },
          "Tümünü Seç"
        ),
        h(
          "button",
          { onClick: clearAllCategories, className: "text-xs text-gray-400 hover:text-white underline" },
          "Tümünü Kaldır"
        )
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
    { className: "netflix-bg min-h-screen flex flex-col items-center px-4 py-12 fade-in" },
    h(
      "h1",
      { className: "font-display text-4xl sm:text-5xl text-white mb-10 tracking-wide" },
      "OYUN ",
      h("span", { style: { color: "#E50914" } }, "AYARLARI")
    ),
    h(
      "div",
      { className: "w-full max-w-2xl space-y-10" },
      durationSection,
      difficultySection,
      passSection,
      targetSection,
      categorySection
    ),
    h(
      "div",
      { className: "flex gap-4 mt-14" },
      h(
        "button",
        {
          onClick: onBack,
          className: "btn-action px-8 py-3 rounded font-bold tracking-wide text-gray-300 bg-[#2b2b2b]",
        },
        "GERİ"
      ),
      h(
        "button",
        {
          onClick: onStart,
          className: "btn-action px-10 py-3 rounded font-bold tracking-wide text-white",
          style: { backgroundColor: "#E50914" },
        },
        "OYUNU BAŞLAT"
      )
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
    { className: "flex flex-wrap gap-2 sm:gap-3 justify-center px-3 py-3" },
    teams.map((team, idx) =>
      h(
        "div",
        {
          key: team.id,
          className: `score-chip flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-700 bg-black/40 ${
            team.id === currentTeamId ? "active" : ""
          }`,
        },
        h("span", {
          className: "w-2.5 h-2.5 rounded-full",
          style: { backgroundColor: TEAM_COLORS[idx % TEAM_COLORS.length] },
        }),
        h("span", { className: "text-sm text-gray-200 font-medium" }, team.name),
        h("span", { className: "text-sm font-bold text-white" }, String(team.score))
      )
    )
  );
});

// ---------------------------------------------------------------------------
// Hazır Ekranı (sıradaki takım)
// ---------------------------------------------------------------------------
function ReadyScreen({ team, onStart, teams }) {
  return h(
    "div",
    { className: "netflix-bg min-h-screen flex flex-col fade-in" },
    h(ScoreBar, { teams, currentTeamId: team.id }),
    h(
      "div",
      { className: "flex-1 flex flex-col items-center justify-center px-4 text-center" },
      h("p", { className: "text-gray-400 uppercase tracking-widest mb-3 text-sm" }, "Şimdi Oynatılıyor"),
      h("h1", { className: "font-display text-5xl sm:text-7xl text-white mb-10 pop-in" }, team.name),
      h(
        "button",
        {
          onClick: onStart,
          className: "btn-action px-12 py-4 rounded font-bold tracking-wide text-white text-lg",
          style: { backgroundColor: "#E50914" },
        },
        "▶ BAŞLA"
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
      h("h1", { className: "font-display text-6xl sm:text-7xl mb-8 tracking-widest text-white" }, "DURAKLATILDI"),
      h(
        "div",
        { className: "flex flex-col items-center gap-3" },
        h(
          "button",
          {
            onClick: onResume,
            className: "btn-action px-10 py-3 rounded font-bold tracking-wide text-white text-lg",
            style: { backgroundColor: "#E50914" },
          },
          "▶ Devam Et"
        ),
        h(
          "button",
          { onClick: onEndGame, className: "btn-action px-10 py-3 rounded font-bold tracking-wide text-gray-300 bg-[#2b2b2b]" },
          "⏹ Oyunu Bitir"
        )
      )
    )
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return h(
    "div",
    { className: "history-overlay", onClick: onCancel },
    h(
      "div",
      { className: "history-modal", onClick: (e) => e.stopPropagation(), style: { maxWidth: "360px", textAlign: "center" } },
      h("h2", { className: "font-display text-2xl text-white tracking-wide mb-2" }, title),
      h("p", { className: "text-gray-300 text-sm mb-6" }, message),
      h(
        "div",
        { className: "flex gap-3 justify-center" },
        h(
          "button",
          { onClick: onCancel, className: "btn-action px-5 py-2 rounded font-bold text-gray-300 bg-[#2b2b2b]" },
          cancelLabel || "Vazgeç"
        ),
        h(
          "button",
          { onClick: onConfirm, className: "btn-action px-5 py-2 rounded font-bold text-white", style: { backgroundColor: "#E50914" } },
          confirmLabel || "Onayla"
        )
      )
    )
  );
}

// Performans: kelime kartı yalnızca `card`/`forbiddenCount` değiştiğinde yeniden
// çizilir. Aksi halde sayaç her saniye GameScreen'i render ederken, kart ve
// yasaklı kelime listesi de (o an değişmese bile) gereksiz yere yeniden hesaplanırdı.
const WordCard = React.memo(function WordCard({ card, forbiddenCount }) {
  return h(
    "div",
    { key: card.id, className: "word-card pop-in w-full max-w-md p-6 sm:p-8" },
    h(
      "h2",
      { className: "font-display text-4xl sm:text-5xl text-center text-white mb-6 uppercase" },
      card.word
    ),
    h(
      "div",
      { className: "space-y-2" },
      card.forbidden.slice(0, forbiddenCount).map((w) =>
        h(
          "div",
          { key: w, className: "forbidden-row flex items-center gap-3 py-2 px-2" },
          h("span", { className: "text-red-600 font-bold" }, "✕"),
          h("span", { className: "text-gray-300 text-lg" }, w)
        )
      )
    )
  );
});

function EmptyDeckFallback({ onEndGame }) {
  return h(
    "div",
    { className: "netflix-bg min-h-screen flex flex-col items-center justify-center px-4 text-center fade-in" },
    h("h1", { className: "font-display text-4xl sm:text-5xl text-white mb-4" }, "Kelime Havuzu Bulunamadı"),
    h(
      "p",
      { className: "text-gray-400 mb-8 max-w-sm" },
      "Seçili kategoriler için kelime yüklenemedi. Bu genelde words.js dosyasının yüklenememesinden kaynaklanır — sayfayı yenilemeyi deneyin."
    ),
    h(
      "button",
      {
        onClick: onEndGame,
        className: "btn-action px-8 py-3 rounded font-bold tracking-wide text-white",
        style: { backgroundColor: "#E50914" },
      },
      "Oyunu Bitir"
    )
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
  onCorrect,
  onTabu,
  onPass,
  onTogglePause,
  onEndGame,
}) {
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  if (!deck || deck.length === 0) {
    return h(EmptyDeckFallback, { onEndGame });
  }

  const forbiddenCount = DIFFICULTY_OPTIONS.find((d) => d.key === settings.difficulty).forbiddenCount;
  const card = deck[cardIndex % deck.length];
  const progressPct = Math.max(0, Math.round((timeLeft / settings.duration) * 100));
  const urgent = timeLeft <= Math.min(10, Math.ceil(settings.duration * 0.2));
  const passDisabled = settings.passLimit !== null && passesLeft <= 0;

  return h(
    "div",
    { className: "netflix-bg min-h-screen flex flex-col" },
    h(
      "div",
      { className: "game-controls" },
      h(
        "button",
        { onClick: onTogglePause, className: "game-control-btn", "aria-label": "Duraklat" },
        "⏸"
      ),
      h(
        "button",
        { onClick: () => setShowEndConfirm(true), className: "game-control-btn", "aria-label": "Bitir" },
        "⏹"
      )
    ),
    h(ScoreBar, { teams, currentTeamId: currentTeam.id }),
    h(
      "div",
      { className: "px-4 sm:px-8 mt-2" },
      h("p", { className: "text-center text-gray-400 text-xs uppercase tracking-widest mb-1" }, `${currentTeam.name} oynuyor`),
      h("div", { className: `game-timer ${urgent ? "urgent" : ""}` }, `${timeLeft}`),
      h(
        "div",
        { className: "progress-track max-w-3xl mx-auto mt-2" },
        h("div", {
          className: `progress-fill ${urgent ? "urgent" : ""}`,
          style: { width: `${progressPct}%` },
        })
      )
    ),
    h(
      "div",
      { className: "flex-1 flex items-center justify-center px-4" },
      h(WordCard, { card, forbiddenCount })
    ),
    h(
      "div",
      { className: "grid grid-cols-3 gap-3 sm:gap-4 px-4 sm:px-8 pb-8 pb-safe max-w-2xl mx-auto w-full" },
      h(
        "button",
        {
          onClick: onTabu,
          className: "btn-action py-4 rounded-lg font-bold text-white uppercase tracking-wide",
          style: { backgroundColor: "#E50914" },
        },
        "Tabu"
      ),
      h(
        "button",
        {
          onClick: onPass,
          disabled: passDisabled,
          className: "btn-action py-4 rounded-lg font-bold text-white uppercase tracking-wide bg-gray-600",
        },
        `Pas${settings.passLimit !== null ? ` (${passesLeft})` : ""}`
      ),
      h(
        "button",
        {
          onClick: onCorrect,
          className: "btn-action py-4 rounded-lg font-bold text-white uppercase tracking-wide",
          style: { backgroundColor: "#1F8A70" },
        },
        "Doğru"
      )
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
      { className: "text-center px-6 fade-in" },
      h(
        "h1",
        { className: "font-display flash-text text-6xl sm:text-8xl mb-8 tracking-widest" },
        "SÜRE DOLDU!"
      ),
      h("p", { className: "text-gray-300 mb-1 text-lg" }, `${team.name} turu bitti`),
      h(
        "div",
        { className: "flex justify-center gap-6 my-6 text-lg" },
        h("span", { className: "text-green-500 font-bold" }, `✓ Doğru: ${stats.correct}`),
        h("span", { className: "text-red-500 font-bold" }, `✕ Tabu: ${stats.tabu}`),
        h("span", { className: "text-gray-400 font-bold" }, `➜ Pas: ${stats.passed}`)
      ),
      h(
        "button",
        {
          onClick: onNext,
          className: "btn-action mt-6 px-10 py-3 rounded font-bold tracking-wide text-white",
          style: { backgroundColor: "#E50914" },
        },
        `SONRAKİ TUR — ${nextTeam.name}`
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Maç Sonu İstatistik Dashboard'u
// ---------------------------------------------------------------------------
const CONFETTI_COLORS = ["#E50914", "#FFD700", "#1F8A70", "#2196F3", "#B565D9", "#FFFFFF"];

function StatTile({ label, value }) {
  return h(
    "div",
    { className: "stat-tile" },
    h("p", { className: "stat-tile-label" }, label),
    h("p", { className: "stat-tile-value" }, value)
  );
}

function StatusLegend() {
  return h(
    "div",
    { className: "status-legend" },
    h("span", { className: "legend-item" }, h("span", { className: "legend-dot", style: { backgroundColor: "#1F8A70" } }), "Doğru"),
    h("span", { className: "legend-item" }, h("span", { className: "legend-dot", style: { backgroundColor: "#E50914" } }), "Tabu"),
    h("span", { className: "legend-item" }, h("span", { className: "legend-dot", style: { backgroundColor: "#6b7280" } }), "Pas")
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
      correctPct > 0 && h("span", { className: "team-perf-seg", style: { width: `${correctPct}%`, backgroundColor: "#1F8A70" } }),
      tabuPct > 0 && h("span", { className: "team-perf-seg", style: { width: `${tabuPct}%`, backgroundColor: "#E50914" } }),
      passPct > 0 && h("span", { className: "team-perf-seg", style: { width: `${passPct}%`, backgroundColor: "#6b7280" } })
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

function StatsDashboardScreen({ teams, winner, wordLog, onRestart }) {
  const sorted = teams.slice().sort((a, b) => b.score - a.score);
  const stats = useMemo(() => computeGameStats(wordLog, teams), [wordLog, teams]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 90 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 2,
        duration: 2.5 + Math.random() * 2.5,
        size: 6 + Math.random() * 8,
      })),
    []
  );

  return h(
    "div",
    { className: "netflix-bg min-h-screen flex flex-col items-center px-4 py-12 fade-in relative" },
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
    h("div", { className: "trophy-glow text-7xl mb-6" }, "🏆"),
    h("p", { className: "text-gray-400 uppercase tracking-widest mb-2" }, "Kazanan"),
    h(
      "h1",
      { className: "font-display text-5xl sm:text-7xl text-white mb-10 text-center", style: { color: "#E50914" } },
      winner.name
    ),

    h(
      "div",
      { className: "w-full max-w-2xl" },
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
        h("h3", { className: "dashboard-card-title" }, "🔥 Zorlu Kelimeler"),
        stats.zorluKelimeler.length === 0
          ? h("p", { className: "text-gray-400 text-sm" }, "Bu oyunda öne çıkan zorlu bir kelime olmadı.")
          : stats.zorluKelimeler.map((s, idx) =>
              h(
                "div",
                { key: s.word, className: "struggle-row" },
                h("span", { className: "struggle-rank" }, `#${idx + 1}`),
                h("span", { className: "struggle-word" }, s.word),
                h(
                  "span",
                  { className: "struggle-badge" },
                  stats.zorluKelimelerShared ? `${s.teamCount} takım zorlandı` : `${s.count} kez zorlandı`
                )
              )
            )
      )
    ),

    h(
      "div",
      { className: "w-full max-w-sm space-y-2 my-8" },
      sorted.map((t, idx) =>
        h(
          "div",
          {
            key: t.id,
            className: "flex items-center justify-between px-4 py-3 rounded bg-black/40 border border-gray-700",
          },
          h("span", { className: "text-gray-200" }, `${idx + 1}. ${t.name}`),
          h("span", { className: "font-bold text-white" }, String(t.score))
        )
      )
    ),
    h(
      "button",
      {
        onClick: onRestart,
        className: "btn-action px-10 py-3 rounded font-bold tracking-wide text-white",
        style: { backgroundColor: "#E50914" },
      },
      "YENİDEN OYNA"
    )
  );
}

// ---------------------------------------------------------------------------
// Tur Geçmişi
// ---------------------------------------------------------------------------
function HistoryButton({ onClick }) {
  return h("button", { onClick, className: "history-btn" }, "🕒 Geçmiş");
}

function HistoryPanel({ history, onClose }) {
  return h(
    "div",
    { className: "history-overlay", onClick: onClose },
    h(
      "div",
      { className: "history-modal", onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "flex items-center justify-between mb-3" },
        h("h2", { className: "font-display text-2xl text-white tracking-wide" }, "Tur Geçmişi"),
        h(
          "button",
          { onClick: onClose, className: "text-gray-400 hover:text-white text-xl" },
          "✕"
        )
      ),
      history.length === 0
        ? h("p", { className: "text-gray-400 text-sm" }, "Henüz tamamlanmış bir tur yok.")
        : history
            .slice()
            .reverse()
            .map((r) =>
              h(
                "div",
                { key: r.id, className: "history-row" },
                h("span", { className: "text-gray-200" }, `#${r.id} ${r.teamName}`),
                h(
                  "span",
                  { className: "text-gray-300" },
                  `✓${r.correct}  ✕${r.tabu}  ➜${r.passed}  (net ${r.net >= 0 ? "+" : ""}${r.net})`
                )
              )
            )
    )
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
    return base.map((t) => ({ ...t, score: 0 }));
  });
  const [settings, setSettings] = useState(() => ({ ...defaultSettings(), ...(persisted?.settings || {}) }));
  const [phase, setPhase] = useState("profiles"); // profiles | setup | ready | playing | roundEnd | gameOver

  const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
  const [deck, setDeck] = useState(() => shuffle(getFilteredPool(settings.categories)));
  const [cardIndex, setCardIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(settings.duration);
  const [passesLeft, setPassesLeft] = useState(settings.passLimit);
  const [roundStats, setRoundStats] = useState({ correct: 0, tabu: 0, passed: 0 });
  const [roundHistory, setRoundHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [winner, setWinner] = useState(null);
  const [wordLog, setWordLog] = useState([]);
  const [isPaused, setIsPaused] = useState(false);

  const timerRef = useRef(null);
  const cardStartRef = useRef(Date.now());
  const lastActionAtRef = useRef(0);

  useEffect(() => {
    // Puan hiç kaydedilmez — yalnızca isim/id kalıcı olsun, bir sonraki açılışta
    // her zaman 0'dan başlansın (ayrıca bkz. teams state'in ilk yüklenme mantığı).
    persist({ teams: teams.map((t) => ({ id: t.id, name: t.name })), settings });
  }, [teams, settings]);

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
        setDeck(shuffle(getFilteredPool(settings.categories)));
        return 0;
      }
      return next;
    });
  }, [deck.length, settings.categories]);

  const updateScoreAndCheckWin = (delta) => {
    setTeams((prev) => {
      const updated = prev.map((t) =>
        t.id === currentTeam.id ? { ...t, score: t.score + delta } : t
      );
      const reachedTarget = updated.find((t) => t.score >= settings.targetScore);
      if (reachedTarget) {
        clearInterval(timerRef.current);
        setWinner(reachedTarget);
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
  };

  // İnsan-üstü hızda art arda tıklamaya (spam-click) karşı koruma: aynı kelime
  // için iki kez puan/log kaydı oluşmasını ya da deck'in iki kez atlanmasını önler.
  const canAct = () => {
    const now = Date.now();
    if (now - lastActionAtRef.current < SPAM_GUARD_MS) return false;
    lastActionAtRef.current = now;
    return true;
  };

  const handleCorrect = () => {
    if (isPaused || !canAct()) return;
    playSound("correct");
    logCurrentCard("correct");
    setRoundStats((s) => ({ ...s, correct: s.correct + 1 }));
    updateScoreAndCheckWin(1);
    advanceCard();
  };

  const handleTabu = () => {
    if (isPaused || !canAct()) return;
    playSound("tabu");
    logCurrentCard("tabu");
    setRoundStats((s) => ({ ...s, tabu: s.tabu + 1 }));
    updateScoreAndCheckWin(-1);
    advanceCard();
  };

  const handlePass = () => {
    if (isPaused || !canAct()) return;
    if (settings.passLimit !== null && passesLeft <= 0) return;
    logCurrentCard("pass");
    setRoundStats((s) => ({ ...s, passed: s.passed + 1 }));
    if (settings.passLimit !== null) setPassesLeft((p) => p - 1);
    advanceCard();
  };

  const startRound = () => {
    playSound("taDum");
    cardStartRef.current = Date.now();
    setIsPaused(false);
    setTimeLeft(settings.duration);
    setPassesLeft(settings.passLimit);
    setRoundStats({ correct: 0, tabu: 0, passed: 0 });
    setPhase("playing");
  };

  const goNextTeam = () => {
    setCurrentTeamIndex((idx) => (idx + 1) % teams.length);
    setPhase("ready");
  };

  const goToReady = () => {
    setDeck(shuffle(getFilteredPool(settings.categories)));
    setCardIndex(0);
    setPhase("ready");
  };

  const togglePause = () => setIsPaused((p) => !p);

  const endGameNow = () => {
    clearInterval(timerRef.current);
    const top = teams.slice().sort((a, b) => b.score - a.score)[0];
    setIsPaused(false);
    setWinner(top);
    setPhase("gameOver");
  };

  const restartGame = () => {
    setTeams((prev) => prev.map((t) => ({ ...t, score: 0 })));
    setCurrentTeamIndex(0);
    setDeck(shuffle(getFilteredPool(settings.categories)));
    setCardIndex(0);
    setRoundHistory([]);
    setWordLog([]);
    setWinner(null);
    setIsPaused(false);
    setPhase("profiles");
  };

  const screen = (() => {
    switch (phase) {
      case "profiles":
        return h(ProfilesScreen, { teams, setTeams, onContinue: () => setPhase("setup") });
      case "setup":
        return h(SettingsScreen, {
          settings,
          setSettings,
          onBack: () => setPhase("profiles"),
          onStart: goToReady,
        });
      case "ready":
        return h(ReadyScreen, { team: currentTeam, teams, onStart: startRound });
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
          onCorrect: handleCorrect,
          onTabu: handleTabu,
          onPass: handlePass,
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
        return h(StatsDashboardScreen, { teams, winner, wordLog, onRestart: restartGame });
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
    showHistory && h(HistoryPanel, { history: roundHistory, onClose: () => setShowHistory(false) })
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
