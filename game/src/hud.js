// Meridian Bay — HUD Agent 3 (Milo): uang, HP, bintang wanted, objektif,
// minimap + menu/petunjuk + save/load localStorage.
//
// PENTING: createHUD() mengembalikan truthy, jadi main.js BERHENTI
// menggambar HUD + minimap fallback-nya — file ini HARUS menggambar
// semuanya sendiri. Render jalan lewat loop requestAnimationFrame
// sendiri (membaca window.__MB__.state) supaya HUD tetap hidup saat
// jeda (P) dan sebelum/sesudah updateHUD dipanggil main.js; updateHUD
// tetap didukung sebagai jalur utama main.js.
//
// Save/load: key 'meridian-bay.save.v1' (MB_CONFIG.saveKey).
// Autosave tiap 15 detik + tiap misi selesai. Muat save dengan tombol L,
// simpan manual dengan tombol K. Global saveGame(state)/loadGame()
// diekspos untuk Agent 1.
'use strict';

(function () {
  var SAVE_KEY = 'meridian-bay.save.v1';
  try {
    if (typeof MB_CONFIG !== 'undefined' && MB_CONFIG.saveKey) {
      SAVE_KEY = MB_CONFIG.saveKey;
    }
  } catch (err) { /* pakai default */ }

  var M3 = window.__MB_M3__ || (window.__MB_M3__ = {
    target: null, events: [], gangLeft: 0, missionId: 0,
  });
  if (!M3.events) M3.events = [];

  var els = null;          // elemen DOM HUD
  var extra = null;        // elemen tambahan (toast, hint, jeda, save)
  var lastState = null;    // state terakhir yang dirender
  var lastKey = '';        // "id|status" misi terakhir (deteksi perubahan)
  var saveAcc = 0;         // akumulator autosave
  var toastUntil = 0;      // performance.now() sampai toast hilang
  var toastText = '';
  var saveFlashUntil = 0;  // "Tersimpan" berkedip sampai kapan
  var rafStarted = false;
  var keysBound = false;
  var loopLast = 0;

  function now() {
    try {
      return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
    } catch (err) { return Date.now(); }
  }

  function el(id) {
    try {
      return document.getElementById(id);
    } catch (err) { return null; }
  }

  function makeDiv(id, css) {
    var d = document.createElement('div');
    d.id = id;
    d.style.cssText = css;
    document.body.appendChild(d);
    return d;
  }

  // ---- Save / load ----
  function saveGame(state) {
    state = state || lastState ||
      (window.__MB__ && window.__MB__.state) || null;
    if (!state || !state.player || !state.mission) return false;
    try {
      var data = {
        v: 1,
        savedAt: Date.now(),
        money: state.player.money,
        health: state.player.health,
        wanted: state.wanted.level,
        mission: {
          id: state.mission.id,
          text: state.mission.text,
          status: state.mission.status,
        },
        player: {
          x: state.player.x,
          y: state.player.y || 0,
          z: state.player.z,
          heading: state.player.heading,
        },
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      saveFlashUntil = now() + 2000;
      return true;
    } catch (err) { return false; }
  }

  function loadGame(state) {
    state = state || lastState ||
      (window.__MB__ && window.__MB__.state) || null;
    if (!state || !state.player) return false;
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.mission || !data.player) return false;
      state.player.money = data.money;
      state.player.health = data.health;
      state.player.x = data.player.x;
      state.player.y = data.player.y || 0;
      state.player.z = data.player.z;
      state.player.heading = data.player.heading;
      state.player.inVehicle = false;
      state.wanted.level = data.wanted || 0;
      state.wanted.cooldown = 12;
      state.mission = {
        id: data.mission.id,
        text: data.mission.text,
        status: data.mission.status,
      };
      showToast('Save dimuat — lanjut misi ' + data.mission.id + '.');
      return true;
    } catch (err) { return false; }
  }

  function showToast(text) {
    toastText = text;
    toastUntil = now() + 3500;
  }

  // ---- Minimap (lingkaran, laut di barat, jalan, target, pemain) ----
  function drawMinimap(state) {
    var cv = els.minimap;
    if (!cv) return;
    var ctx = null;
    try { ctx = cv.getContext('2d'); } catch (err) { return; }
    if (!ctx) return;
    var w = cv.width || 168;
    var h = cv.height || 168;
    var world = (window.__MB__ && window.__MB__.world) || null;
    var b = (world && world.bounds) || 352;
    var seaX = (world && typeof world.seaX === 'number') ? world.seaX : -222;

    function sx(x) { return ((x + b) / (2 * b)) * w; }
    function sz(z) { return ((z + b) / (2 * b)) * h; }

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(10, 12, 26, 0.72)';
    ctx.fillRect(0, 0, w, h);
    // Laut (sisi barat).
    ctx.fillStyle = '#17384f';
    ctx.fillRect(0, 0, Math.max(0, sx(seaX)), h);
    // Jalan.
    if (world && world.roads) {
      ctx.strokeStyle = 'rgba(200, 200, 210, 0.55)';
      ctx.lineWidth = 2;
      for (var r = 0; r < world.roads.length; r++) {
        var road = world.roads[r];
        ctx.beginPath();
        if (road.axis === 'x') {
          ctx.moveTo(0, sz(road.at));
          ctx.lineTo(w, sz(road.at));
        } else {
          ctx.moveTo(sx(road.at), 0);
          ctx.lineTo(sx(road.at), h);
        }
        ctx.stroke();
      }
    }
    // Kendaraan (kuning), polisi (merah), anggota geng (oranye).
    var i;
    if (state.vehicles) {
      ctx.fillStyle = '#e8b93b';
      for (i = 0; i < state.vehicles.length; i++) {
        ctx.fillRect(sx(state.vehicles[i].x) - 2, sz(state.vehicles[i].z) - 2, 4, 4);
      }
    }
    if (state.police) {
      ctx.fillStyle = '#ff4d4d';
      for (i = 0; i < state.police.length; i++) {
        ctx.beginPath();
        ctx.arc(sx(state.police[i].x), sz(state.police[i].z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (state.peds) {
      ctx.fillStyle = '#ff8a3d';
      for (i = 0; i < state.peds.length; i++) {
        if (!state.peds[i].gang || state.peds[i].health <= 0) continue;
        ctx.beginPath();
        ctx.arc(sx(state.peds[i].x), sz(state.peds[i].z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Target misi aktif (berlian emas berdenyut).
    var t = M3.target;
    if (t) {
      var pulse = 5 + Math.sin(now() / 250) * 1.5;
      var tx = sx(t.x);
      var ty = sz(t.z);
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath();
      ctx.moveTo(tx, ty - pulse);
      ctx.lineTo(tx + pulse, ty);
      ctx.lineTo(tx, ty + pulse);
      ctx.lineTo(tx - pulse, ty);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Pemain (teal + arah hadap).
    var px = sx(state.player.x);
    var pz = sz(state.player.z);
    ctx.fillStyle = '#2dd4bf';
    ctx.beginPath();
    ctx.arc(px, pz, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(px + Math.sin(state.player.heading) * 8,
      pz + Math.cos(state.player.heading) * 8);
    ctx.stroke();
    ctx.restore();
    // Bingkai lingkaran.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- Render satu frame HUD ----
  function renderHUD(state, dt) {
    if (!state || !els) return;
    lastState = state;

    // Visibilitas: tampil hanya saat bermain.
    if (els.hud) {
      els.hud.style.display = (state.started && !state.over) ? 'block' : 'none';
    }
    if (els.minimap) {
      els.minimap.style.display = (state.started && !state.over) ? 'block' : 'none';
    }

    if (els.money) els.money.textContent = '$' + state.player.money;
    if (els.health) {
      els.health.textContent = 'HP ' + Math.max(0, Math.round(state.player.health));
      els.health.style.color = state.player.health > 30 ? '#7dff9a' : '#ff6b6b';
    }
    if (els.stars) {
      var s = '';
      for (var i = 0; i < 5; i++) s += i < state.wanted.level ? '★' : '☆';
      els.stars.textContent = s;
    }
    if (els.objective) {
      var m = state.mission;
      var txt = m.text;
      if (m.id >= 1 && m.id <= 5 && m.status !== 'done') {
        txt = 'MISI ' + m.id + '/5 — ' + m.text;
        if (m.id === 4 && M3.gangLeft > 0) txt += ' (Geng tersisa: ' + M3.gangLeft + ')';
      } else if (m.status === 'done') {
        txt = '★ ' + m.text;
      }
      els.objective.textContent = txt;
    }

    // Toast saat misi berganti / selesai + autosave saat itu.
    var key = state.mission.id + '|' + state.mission.status;
    if (key !== lastKey) {
      if (lastKey !== '') {
        if (state.mission.status === 'done') {
          showToast('PELARIAN BESAR BERHASIL — RIO BEBAS!');
        } else if (state.mission.id > 0) {
          showToast('Misi ' + state.mission.id + ' dimulai — ' + state.mission.text);
        }
        saveGame(state);
      }
      lastKey = key;
    }

    // Autosave berkala.
    if (dt > 0) {
      saveAcc += dt;
      if (saveAcc >= 15) {
        saveAcc = 0;
        saveGame(state);
      }
    }

    // Toast + indikator save + jeda.
    if (extra.toast) {
      if (now() < toastUntil) {
        extra.toast.textContent = toastText;
        extra.toast.style.display = 'block';
      } else {
        extra.toast.style.display = 'none';
      }
    }
    if (extra.saveNote) {
      extra.saveNote.style.display = (now() < saveFlashUntil) ? 'block' : 'none';
    }
    if (extra.pause) {
      extra.pause.style.display = state.paused ? 'block' : 'none';
    }
    if (extra.hint) {
      extra.hint.textContent = state.muted
        ? 'WASD gerak · Shift lari · Spasi lompat · E mobil · F curi · Klik serang · P jeda · M bisu (BISU)'
        : 'WASD gerak · Shift lari · Spasi lompat · E mobil · F curi · Klik serang · P jeda · M bisu · L muat save · K simpan';
    }

    drawMinimap(state);
  }

  function loop(t) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(loop);
    }
    var st = lastState || (window.__MB__ && window.__MB__.state) || null;
    if (!st) return;
    var dt = 0.016;
    if (loopLast) dt = Math.min(0.1, (t - loopLast) / 1000 || 0.016);
    loopLast = t;
    renderHUD(st, dt);
  }

  function onKey(e) {
    var k = (e.key || '').toLowerCase();
    if (k === 'l') loadGame();
    else if (k === 'k') {
      if (saveGame()) showToast('Progres disimpan.');
    }
  }

  // ---- API global (dipanggil main.js) ----
  function createHUD() {
    els = {
      hud: el('hud'),
      money: el('hud-money'),
      health: el('hud-health'),
      stars: el('hud-stars'),
      objective: el('hud-objective'),
      minimap: el('minimap'),
    };
    // Elemen inti tidak ada -> kembalikan null supaya fallback main.js jalan.
    if (!els.hud || !els.minimap) return null;

    if (!extra) {
      extra = {
        toast: makeDiv('mb-toast',
          'display:none; position:fixed; top:64px; left:50%; transform:translateX(-50%);' +
          'z-index:6; background:rgba(10,12,26,0.85); color:#ffc93c; padding:8px 18px;' +
          'border:1px solid #ffc93c; border-radius:8px; font:600 15px system-ui,sans-serif;' +
          'text-shadow:0 1px 3px #000;'),
        hint: makeDiv('mb-hint',
          'position:fixed; left:12px; bottom:12px; z-index:5; color:rgba(255,255,255,0.75);' +
          'font:12px system-ui,sans-serif; text-shadow:0 1px 3px #000;'),
        pause: makeDiv('mb-pause',
          'display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);' +
          'z-index:6; color:#fff; font:700 28px system-ui,sans-serif; letter-spacing:3px;' +
          'text-shadow:0 2px 6px #000;'),
        saveNote: makeDiv('mb-save',
          'display:none; position:fixed; right:12px; top:12px; z-index:5; color:#7dff9a;' +
          'font:12px system-ui,sans-serif; text-shadow:0 1px 3px #000;'),
      };
      extra.pause.textContent = 'JEDA — tekan P untuk lanjut';
      extra.saveNote.textContent = 'Tersimpan ✓';
    }
    if (!keysBound && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', onKey);
      keysBound = true;
    }
    if (!rafStarted && typeof requestAnimationFrame === 'function') {
      rafStarted = true;
      requestAnimationFrame(loop);
    }
    // Truthy -> main.js berhenti menggambar HUD/minimap fallback-nya.
    return { saveGame: saveGame, loadGame: loadGame, version: 1 };
  }

  function updateHUD(state, dt) {
    renderHUD(state, dt || 0);
  }

  window.createHUD = createHUD;
  window.updateHUD = updateHUD;
  window.saveGame = saveGame;
  window.loadGame = loadGame;
})();
