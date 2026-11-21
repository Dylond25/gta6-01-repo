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

  // ---- Integrasi: nama zona dari posisi + dialog berpotret ----
  function zoneName(x, z) {
    if (x < -180) return 'Dermaga Barat';
    if (x < -120 && z > 60) return 'Boardwalk';
    if (x < -120) return 'Pelabuhan Barat';
    if (z < -150) return 'Turf Utara';
    if (z > 150) return 'Parkiran Selatan';
    if (x > 150) return 'Gudang Timur';
    if (z < -60) return 'Kota Utara';
    return 'Boulevard Pantai';
  }

  var DIALOGUE = {
    1: { name: 'MARA VOSS', color: '#b0527d', line: 'Rio, paketnya harus sampai sebelum senja. Jangan bikin masalah.' },
    2: { name: 'RIO KESTREL', color: '#1f8a8a', line: 'Mobil itu... aku butuh kunci cepat. Parkiran selatan, sekarang.' },
    3: { name: 'DARIO', color: '#c23b2e', line: 'Polisi sudah di ekor kita — gas terus, jangan berhenti!' },
    4: { name: 'MARA VOSS', color: '#b0527d', line: 'Geng Meridian tidak main-main. Habisi mereka, Rio.' },
    5: { name: 'DARIO', color: '#c23b2e', line: 'Dermaga barat. Sekali jalan, jangan menoleh ke belakang.' },
  };
  var dialogueUntil = 0;   // performance.now() sampai dialog hilang
  var dialogueMission = 0; // misi yang dialognya sedang tampil

  function barText(label, v) {
    var n = Math.max(0, Math.min(10, Math.round(v / 10)));
    var s = '';
    for (var i = 0; i < 10; i++) s += i < n ? '█' : '░';
    return label + ' [' + s + '] ' + Math.round(v);
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
          // Dialog berpotret 15 detik saat misi berganti.
          dialogueMission = state.mission.id;
          dialogueUntil = now() + 15000;
        }
        saveGame(state);
      } else if (state.mission.id > 0 && state.mission.status !== 'done') {
        // Misi pertama saat game mulai.
        dialogueMission = state.mission.id;
        dialogueUntil = now() + 15000;
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

    // ---- HUD padat (integrasi) ----
    var playing = state.started && !state.over;
    if (extra.zone) {
      extra.zone.style.display = playing ? 'block' : 'none';
      if (playing) extra.zone.textContent = '◉ ' + zoneName(state.player.x, state.player.z);
    }
    if (extra.bars) {
      extra.bars.style.display = playing ? 'block' : 'none';
      if (playing) {
        extra.bars.textContent =
          barText('RESPECT', state.player.respect || 0) + '\n' +
          barText('HEALTH ', state.player.health) + '\n' +
          barText('ARMOUR ', state.player.armour || 0);
        extra.bars.style.whiteSpace = 'pre';
      }
    }
    if (extra.policeList) {
      extra.policeList.style.display = playing ? 'block' : 'none';
      if (playing) {
        var lines = ['RESPONS POLISI'];
        var units = state.police || [];
        if (state.wanted.level === 0 || units.length === 0) {
          lines.push('— siaga —');
        } else {
          for (var u = 0; u < units.length; u++) {
            var un = units[u];
            var dd = Math.round(Math.hypot(un.x - state.player.x, un.z - state.player.z));
            var st = dd < 8 ? 'RAMMING' : (dd > 50 ? 'MENYISIR' : 'PURSUIT');
            lines.push((u + 1) + '. PCPD-' + (u + 1) + ' · ' + dd + 'm · ' + st);
          }
        }
        extra.policeList.textContent = lines.join('\n');
        extra.policeList.style.whiteSpace = 'pre';
      }
    }
    if (extra.weapon) {
      extra.weapon.style.display = playing ? 'block' : 'none';
      if (playing) extra.weapon.textContent = 'SENJATA: ● TINJU  ○ BAT (terkunci)  ○ PISTOL (terkunci)  ○ SMG (terkunci)';
    }
    if (extra.radio) extra.radio.style.display = playing ? 'block' : 'none';
    if (extra.carInfo) {
      if (playing && state.player.inVehicle && state.player.vehicleId) {
        var cv = null;
        for (var ci = 0; ci < (state.vehicles || []).length; ci++) {
          if (state.vehicles[ci].id === state.player.vehicleId) { cv = state.vehicles[ci]; break; }
        }
        if (cv) {
          var kmh = Math.round(Math.abs(cv.speed || 0) * 3.6);
          extra.carInfo.textContent = (cv.type || 'mobil').toUpperCase() + ' · ' + kmh +
            ' km/j · KONDISI ' + Math.round(state.player.carCond || 100) + '%';
          extra.carInfo.style.display = 'block';
        } else {
          extra.carInfo.style.display = 'none';
        }
      } else {
        extra.carInfo.style.display = 'none';
      }
    }
    // Dialog berpotret: tampil 15 detik sejak misi berganti; hint
    // disembunyikan selama dialog tampil.
    var dlgOn = now() < dialogueUntil && dialogueMission > 0;
    if (extra.dialogue) {
      extra.dialogue.style.display = (playing && dlgOn) ? 'block' : 'none';
      if (playing && dlgOn) {
        var dg = DIALOGUE[dialogueMission] || DIALOGUE[1];
        extra.dialogue.innerHTML = '';
        var face = document.createElement('span');
        face.textContent = dg.name.charAt(0);
        face.style.cssText = 'display:inline-block; width:38px; height:38px; line-height:38px;' +
          'text-align:center; border-radius:50%; background:' + dg.color + '; color:#fff;' +
          'font:700 18px system-ui,sans-serif; margin-right:10px; vertical-align:top;';
        var who = document.createElement('b');
        who.textContent = dg.name;
        who.style.color = '#ffc93c';
        var say = document.createElement('span');
        say.textContent = ' — “' + dg.line + '”';
        extra.dialogue.appendChild(face);
        extra.dialogue.appendChild(who);
        extra.dialogue.appendChild(say);
      }
    }
    if (extra.hint) extra.hint.style.display = dlgOn ? 'none' : '';

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
        // ---- HUD padat (integrasi) ----
        zone: makeDiv('mb-zone',
          'position:fixed; left:12px; top:118px; z-index:5; color:#ffd94d;' +
          'font:700 13px system-ui,sans-serif; letter-spacing:1px; text-shadow:0 1px 3px #000;'),
        bars: makeDiv('mb-bars',
          'position:fixed; left:12px; top:140px; z-index:5; color:#fff;' +
          'font:12px/1.7 monospace; text-shadow:0 1px 3px #000;'),
        policeList: makeDiv('mb-police',
          'position:fixed; right:12px; top:64px; z-index:5; color:#ffb3b3;' +
          'font:12px/1.7 monospace; text-align:right; text-shadow:0 1px 3px #000;' +
          'background:rgba(10,12,26,0.55); padding:6px 10px; border-radius:8px;'),
        weapon: makeDiv('mb-weapon',
          'position:fixed; left:12px; bottom:44px; z-index:5; color:#fff;' +
          'font:700 13px system-ui,sans-serif; text-shadow:0 1px 3px #000;' +
          'background:rgba(10,12,26,0.55); padding:6px 10px; border-radius:8px;'),
        radio: makeDiv('mb-radio',
          'position:fixed; right:192px; bottom:12px; z-index:5; color:#7dd8ff;' +
          'font:700 13px system-ui,sans-serif; text-shadow:0 1px 3px #000;'),
        carInfo: makeDiv('mb-car',
          'position:fixed; right:192px; bottom:34px; z-index:5; color:#fff;' +
          'font:700 13px system-ui,sans-serif; text-shadow:0 1px 3px #000;'),
        dialogue: makeDiv('mb-dialogue',
          'display:none; position:fixed; left:50%; bottom:96px; transform:translateX(-50%);' +
          'z-index:6; width:520px; max-width:86vw; background:rgba(10,12,26,0.88);' +
          'border:1px solid #ffc93c; border-radius:10px; padding:10px 14px;' +
          'color:#fff; font:14px/1.5 system-ui,sans-serif;'),
      };
      extra.radio.textContent = 'RADIO · BAY FM 88.1';
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
