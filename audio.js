// Ses efektleri — Web Audio API ile sentezlenir, dış ses dosyasına ihtiyaç duymaz.
window.TabuAudio = (function () {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, startTime, duration, type, gainValue) {
    const audioCtx = getCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(gainValue || 0.2, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  return {
    tick() {
      const audioCtx = getCtx();
      tone(880, audioCtx.currentTime, 0.08, "square", 0.15);
    },
    buzzer() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(160, now, 0.5, "sawtooth", 0.25);
      tone(120, now + 0.05, 0.55, "sawtooth", 0.2);
    },
    correct() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(523.25, now, 0.12, "sine", 0.2);
      tone(783.99, now + 0.1, 0.18, "sine", 0.2);
    },
    tabu() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(220, now, 0.18, "square", 0.2);
      tone(196, now + 0.1, 0.22, "square", 0.18);
    },
    taDum() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(98, now, 0.35, "sawtooth", 0.28);
      tone(73.42, now + 0.4, 0.6, "sawtooth", 0.3);
    },
  };
})();
