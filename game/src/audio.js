// Meridian Bay — audio prosedural Agent 3 (Milo), WebAudio murni.
// SELF-INIT saat script dimuat: main.js TIDAK memanggil modul ini sama
// sekali. AudioContext dibuat setelah gesture pertama (klik / tombol)
// sesuai kebijakan autoplay browser; state dibaca lewat
// window.__MB__.state dan antrean event window.__MB_M3__.events.
//
// Bunyi: ambient senja (pad + desir laut), dengung mesin saat di mobil,
// jingle misi mulai/selesai, sirene saat wanted naik, bunyi luka, koin,
// bobol mobil, pukulan, menang/kalah. Semua disintesis — tanpa aset luar.
// Bisu (state.muted, tombol M) mematikan master gain.
'use strict';

(function () {
  var M3 = window.__MB_M3__ || (window.__MB_M3__ = {
    target: null, events: [], gangLeft: 0, missionId: 0,
  });
  if (!M3.events) M3.events = [];

  var ctx = null;        // AudioContext (null sampai gesture pertama)
  var master = null;     // GainNode utama
  var engineOsc = null;  // osilator dengung mesin
  var engineGain = null;
  var ambientOn = false;
  var bound = false;

  // Snapshot terakhir untuk deteksi perubahan (fallback bila tidak ada event).
  var last = {
    missionId: 0, missionStatus: '', wanted: 0, health: 100,
    money: 250, inVehicle: false, won: false, over: false,
  };

  function AC() {
    try {
      return window.AudioContext || window.webkitAudioContext || null;
    } catch (err) { return null; }
  }

  function ensureCtx() {
    var Ctor = AC();
    if (!Ctor || ctx) return;
    try {
      ctx = new Ctor();
    } catch (err) {
      ctx = null;
      return;
    }
    try {
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch (err) { ctx = null; return; }
    startAmbient();
    startEngine();
  }

  function onGesture() {
    ensureCtx();
    if (ctx && ctx.state === 'suspended') {
      try {
        var r = ctx.resume();
        if (r && r.catch) r.catch(function () { /* abaikan */ });
      } catch (err) { /* abaikan */ }
    }
  }

  // ---- Ambient: pad senja + desir laut (loop, volume rendah) ----
  function startAmbient() {
    if (ambientOn || !ctx || !master) return;
    try {
      var padGain = ctx.createGain();
      padGain.gain.value = 0.018;
      padGain.connect(master);
      var freqs = [110, 164.81, 220];
      for (var i = 0; i < freqs.length; i++) {
        var o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sine';
        o.frequency.value = freqs[i];
        o.detune.value = (i - 1) * 4;
        o.connect(padGain);
        o.start();
      }
      // Desir: noise loop lewat lowpass.
      var len = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var n = 0; n < len; n++) d[n] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 320;
      var ng = ctx.createGain();
      ng.gain.value = 0.012;
      src.connect(filt);
      filt.connect(ng);
      ng.connect(master);
      src.start();
      ambientOn = true;
    } catch (err) { /* ambient opsional */ }
  }

  // ---- Dengung mesin (pitch ikut kecepatan, gain 0 saat jalan kaki) ----
  function startEngine() {
    if (!ctx || !master || engineOsc) return;
    try {
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filt);
      filt.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
    } catch (err) { engineOsc = null; engineGain = null; }
  }

  function updateEngine(state) {
    if (!engineOsc || !engineGain || !ctx) return;
    try {
      var p = state.player;
      var speed = Math.sqrt((p.vx || 0) * (p.vx || 0) + (p.vz || 0) * (p.vz || 0));
      if (p.inVehicle) {
        engineOsc.frequency.setTargetAtTime(55 + speed * 3.5, ctx.currentTime, 0.1);
        engineGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.1);
      } else {
        engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      }
    } catch (err) { /* abaikan */ }
  }

  // ---- Primitif bunyi ----
  function tone(freq, dur, type, vol, delay) {
    if (!ctx || !master) return;
    try {
      var t0 = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (err) { /* abaikan */ }
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!ctx || !master) return;
    try {
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = cutoff || 800;
      f.Q.value = 0.8;
      var g = ctx.createGain();
      g.gain.value = vol || 0.1;
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start();
    } catch (err) { /* abaikan */ }
  }

  function arpeggio(notes, dur, type, vol) {
    for (var i = 0; i < notes.length; i++) {
      tone(notes[i], dur, type, vol, i * 0.11);
    }
  }

  // ---- Pemetaan event -> bunyi ----
  function playEvent(type) {
    if (!ctx || !master) return;
    switch (type) {
      case 'mission_start':
        tone(660, 0.12, 'triangle', 0.12);
        tone(880, 0.16, 'triangle', 0.12, 0.1);
        break;
      case 'mission_done':
        arpeggio([523, 659, 784, 1047], 0.16, 'triangle', 0.12);
        break;
      case 'win':
        arpeggio([523, 659, 784, 1047, 1319], 0.28, 'triangle', 0.13);
        break;
      case 'lose':
        arpeggio([392, 330, 262, 196], 0.3, 'sawtooth', 0.07);
        break;
      case 'wanted_up':
        tone(700, 0.16, 'square', 0.06);
        tone(950, 0.16, 'square', 0.06, 0.16);
        tone(700, 0.16, 'square', 0.06, 0.32);
        tone(950, 0.2, 'square', 0.06, 0.48);
        break;
      case 'damage':
        tone(90, 0.18, 'sine', 0.2);
        noiseBurst(0.1, 0.08, 300);
        break;
      case 'cash':
        tone(1320, 0.07, 'sine', 0.09);
        tone(1760, 0.1, 'sine', 0.09, 0.06);
        break;
      case 'steal':
        tone(160, 0.15, 'square', 0.1);
        tone(90, 0.22, 'sine', 0.14, 0.1);
        break;
      case 'hit':
        noiseBurst(0.06, 0.12, 1200);
        break;
      case 'gang_down':
        tone(220, 0.15, 'sawtooth', 0.09);
        tone(165, 0.2, 'sawtooth', 0.08, 0.08);
        break;
      case 'enter_car':
        tone(60, 0.25, 'sawtooth', 0.08);
        tone(120, 0.2, 'sawtooth', 0.06, 0.15);
        break;
      case 'exit_car':
        tone(120, 0.2, 'sawtooth', 0.06);
        tone(60, 0.25, 'sawtooth', 0.06, 0.12);
        break;
      default:
        break;
    }
  }

  function syncLast(state) {
    last.missionId = state.mission.id;
    last.missionStatus = state.mission.status;
    last.wanted = state.wanted.level;
    last.health = state.player.health;
    last.money = state.player.money;
    last.inVehicle = state.player.inVehicle;
    last.won = state.won;
    last.over = state.over;
  }

  // ---- Polling state (120 ms): konsumsi event + deteksi perubahan ----
  function poll() {
    var st = (window.__MB__ && window.__MB__.state) || null;
    if (!st || !st.player || !st.mission || !st.wanted) return;

    // Konsumsi antrean event misi (sekali baca, supaya tidak dobel).
    if (M3.events && M3.events.length > 0) {
      var evs = M3.events.splice(0, M3.events.length);
      for (var i = 0; i < evs.length; i++) playEvent(evs[i].type);
    }
    if (!ctx || !master) {
      // Belum ada gesture: tetap perbarui snapshot agar tidak ada
      // bunyi tertumpuk saat audio akhirnya menyala.
      syncLast(st);
      return;
    }
    try {
      master.gain.value = st.muted ? 0 : 0.9;
    } catch (err) { /* abaikan */ }

    if (st.wanted.level > last.wanted) playEvent('wanted_up');
    if (st.player.health < last.health - 4) playEvent('damage');
    if (st.player.money > last.money) playEvent('cash');
    if (st.player.inVehicle !== last.inVehicle) {
      playEvent(st.player.inVehicle ? 'enter_car' : 'exit_car');
    }
    if (st.won && !last.won) playEvent('win');
    if (st.over && !last.over && !st.won) playEvent('lose');
    updateEngine(st);
    syncLast(st);
  }

  // ---- Self-init saat script dimuat ----
  if (typeof window.addEventListener === 'function' && !bound) {
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    bound = true;
  }
  if (typeof setInterval === 'function') {
    setInterval(poll, 120);
  }

  window.__MB_AUDIO__ = {
    play: playEvent,
    poll: poll,
    ensure: onGesture,
    isReady: function () { return !!ctx; },
  };
})();
