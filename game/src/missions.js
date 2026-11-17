// Meridian Bay — rantai misi Agent 3 (Milo).
// 5 misi Rio Kestrel: antar paket -> curi mobil -> kejar-kejaran ->
// hadapi geng -> pelarian besar. Menang = state.mission.status 'done'
// && state.mission.id === 5 (dicek main.js). Kalah = health <= 0.
//
// Kontrak yang dipakai HANYA yang ada di main.js:
//   state.player.{x,z,health,money,inVehicle}
//   state.wanted.{level,cooldown}
//   state.mission.{id,text,status}
//   state.peds / state.vehicles / state.police (array, boleh kosong)
// Target misi + antrean event disimpan INTERNAL di window.__MB_M3__
// (dibagi dengan hud.js + audio.js) — TIDAK memakai
// state.mission.target / state.events / state.phase (tidak ada di main.js).
//
// Fallback bila modul Agent 2 belum ada:
//   - Misi 2: tanpa kendaraan di state.vehicles, "mencuri" = tahan 1,5 dtk
//     di dekat titik mobil parkir (membobol). Bila Agent 2 sudah ada dan
//     pemain masuk mobil (inVehicle), misi langsung selesai.
//   - Misi 4: geng di-spawn sebagai entri state.peds {gang:true} oleh
//     modul ini sendiri; klik kiri di dekat anggota geng mengurangi
//     HP-nya (listener mousedown sendiri). Bila combat Agent 2 sudah
//     ada dan menurunkan HP peds geng, penyelesaian tetap terdeteksi
//     dari state.peds.
'use strict';

(function () {
  // ---- State internal bersama modul Milo ----
  var M3 = window.__MB_M3__ || (window.__MB_M3__ = {
    target: null,   // {x, z, label} | null — target misi aktif (minimap + beacon)
    events: [],     // antrean {type, data, t} — dibaca audio.js
    gangLeft: 0,    // anggota geng tersisa (misi 4)
    missionId: 0,   // id misi aktif
  });
  if (!M3.events) M3.events = [];

  // ---- Definisi 5 misi (semua titik di persimpangan jalan, bisa dicapai) ----
  // Jalan kota di c = -216 + i*54 (i 0..8). Spawn (0, 33).
  var MISSIONS = [
    null,
    { id: 1, text: 'Antar paket ke gudang timur.', x: 162, z: -108, radius: 6, reward: 150 },
    { id: 2, text: 'Curi mobil di parkiran selatan — dekati mobil, tekan F.', x: 54, z: 108, radius: 5, reward: 200 },
    { id: 3, text: 'Kabur ke titik barat daya selagi diburu polisi!', x: -162, z: 162, radius: 9, reward: 300 },
    { id: 4, text: 'Hadapi geng di turf utara — klik kiri untuk menyerang!', x: -108, z: -162, radius: 10, reward: 400 },
    { id: 5, text: 'Pelarian besar — capai dermaga barat!', x: -210, z: 30, radius: 8, reward: 500 },
  ];

  var HOTWIRE_RADIUS = 4.5;  // jarak membobol mobil (misi 2, fallback)
  var HOTWIRE_TIME = 1.5;    // detik tahan di dekat mobil
  var ATTACK_RANGE = 2.6;    // jangkauan pukulan (misi 4)
  var ATTACK_DAMAGE = 15;    // HP geng per pukulan (30 HP = 2 pukulan)
  var GANG_HP = 30;
  var GANG_CHASE_SPEED = 2.0;
  var GANG_CHASE_RANGE = 30;
  var GANG_HIT_RANGE = 2.2;
  var GANG_DPS = 4;          // damage per detik per anggota geng yang dekat

  var cur = 0;               // id misi aktif (0 = belum mulai)
  var holdT = 0;             // timer hotwire misi 2
  var gangSpawned = false;   // geng misi 4 sudah di-spawn
  var lastState = null;      // state terakhir dari updateMissions (untuk klik)
  var beacon = null;         // mesh penanda target (THREE, opsional)
  var attackBound = false;

  function dist(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function pushEvent(type, data) {
    try {
      M3.events.push({ type: type, data: data || null, t: Date.now() });
      if (M3.events.length > 32) M3.events.splice(0, M3.events.length - 32);
    } catch (err) { /* antrean event tidak boleh mematikan misi */ }
  }

  function def(id) { return MISSIONS[id] || null; }

  function setTarget(d) {
    M3.target = d ? { x: d.x, z: d.z, label: 'Misi ' + d.id } : null;
    M3.missionId = d ? d.id : 0;
  }

  // Target misi 2 dinamis: mobil terdekat di state.vehicles bila ada.
  function currentTarget(state, d) {
    if (cur === 2 && state.vehicles && state.vehicles.length > 0) {
      var best = null;
      var bestD = 1e9;
      for (var i = 0; i < state.vehicles.length; i++) {
        var v = state.vehicles[i];
        if (typeof v.x !== 'number' || typeof v.z !== 'number') continue;
        var dd = dist(state.player.x, state.player.z, v.x, v.z);
        if (dd < bestD) { bestD = dd; best = v; }
      }
      if (best) {
        M3.target = { x: best.x, z: best.z, label: 'Mobil curian' };
        return { x: best.x, z: best.z };
      }
    }
    return { x: d.x, z: d.z };
  }

  // ---- Geng misi 4 (disimpan sebagai state.peds, dibaca HUD + audio) ----
  function spawnGang(state) {
    var alive = 0;
    var total = 0;
    var i;
    for (i = 0; i < state.peds.length; i++) {
      if (!state.peds[i].gang) continue;
      total++;
      if (state.peds[i].health > 0) alive++;
    }
    if (alive > 0) {
      gangSpawned = true;
      M3.gangLeft = alive;
      return;
    }
    if (total > 0) {
      // Semua anggota geng sudah tumbang: JANGAN respawn, misi selesai.
      M3.gangLeft = 0;
      return;
    }
    // Belum ada entri geng sama sekali (awal misi 4, atau peds
    // dibersihkan resetRun / load save) -> spawn 3 anggota baru.
    gangSpawned = false;
    var d = def(4);
    var spots = [[0, 0], [7, -5], [-6, 6]];
    for (var k = 0; k < 3; k++) {
      state.peds.push({
        id: 'mb-gang-' + k,
        name: 'Geng Meridian',
        gang: true,
        x: d.x + spots[k][0],
        z: d.z + spots[k][1],
        health: GANG_HP,
        maxHealth: GANG_HP,
      });
    }
    gangSpawned = true;
    M3.gangLeft = 3;
  }

  function removeGang(state) {
    if (!state.peds) return;
    var kept = [];
    for (var i = 0; i < state.peds.length; i++) {
      if (!state.peds[i].gang) kept.push(state.peds[i]);
    }
    state.peds.length = 0;
    for (var j = 0; j < kept.length; j++) state.peds.push(kept[j]);
    gangSpawned = false;
    M3.gangLeft = 0;
  }

  function gangLeft(state) {
    var n = 0;
    for (var i = 0; i < state.peds.length; i++) {
      if (state.peds[i].gang && state.peds[i].health > 0) n++;
    }
    return n;
  }

  // Anggota geng mengejar pemain dan memukul dari dekat.
  function updateGang(state, dt) {
    var p = state.player;
    for (var i = 0; i < state.peds.length; i++) {
      var g = state.peds[i];
      if (!g.gang || g.health <= 0) continue;
      var d = dist(g.x, g.z, p.x, p.z);
      if (d < GANG_CHASE_RANGE && d > 1.6) {
        var step = GANG_CHASE_SPEED * dt;
        g.x += ((p.x - g.x) / d) * step;
        g.z += ((p.z - g.z) / d) * step;
        d = dist(g.x, g.z, p.x, p.z);
      }
      if (d < GANG_HIT_RANGE) {
        p.health -= GANG_DPS * dt;
      }
    }
  }

  // Klik kiri = pukulan saat misi 4 aktif (input.js tidak mengekspos
  // input ke modul ini, jadi missions.js mendengarkan mousedown sendiri).
  function onAttack() {
    if (cur !== 4 || !lastState) return;
    var st = lastState;
    if (!st.started || st.over || st.paused) return;
    var p = st.player;
    var best = null;
    var bestD = ATTACK_RANGE;
    for (var i = 0; i < st.peds.length; i++) {
      var g = st.peds[i];
      if (!g.gang || g.health <= 0) continue;
      var d = dist(p.x, p.z, g.x, g.z);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return;
    best.health -= ATTACK_DAMAGE;
    pushEvent('hit', { id: best.id });
    if (best.health <= 0) {
      best.health = 0;
      pushEvent('gang_down', { id: best.id });
    }
    M3.gangLeft = gangLeft(st);
  }

  // ---- Beacon 3D di atas target aktif (opsional, gagal diam-diam) ----
  function updateBeacon() {
    try {
      if (!window.THREE || !window.__MB__ || !window.__MB__.world ||
          !window.__MB__.world.group) return;
      var t = M3.target;
      if (!t) {
        if (beacon) beacon.visible = false;
        return;
      }
      if (!beacon) {
        var geo = new THREE.CylinderGeometry(1.4, 1.4, 34, 12, 1, true);
        var mat = new THREE.MeshBasicMaterial({
          color: 0xffc93c, transparent: true, opacity: 0.32,
          side: THREE.DoubleSide, depthWrite: false,
        });
        beacon = new THREE.Mesh(geo, mat);
        window.__MB__.world.group.add(beacon);
      }
      beacon.position.set(t.x, 17, t.z);
      beacon.visible = true;
    } catch (err) { /* beacon hanya kosmetik */ }
  }

  // ---- Alur misi ----
  function startMission(state, id) {
    var d = def(id);
    if (!d) return;
    cur = id;
    holdT = 0;
    state.mission = { id: id, text: d.text, status: 'active' };
    setTarget(d);
    if (id === 4) spawnGang(state);
    pushEvent('mission_start', { id: id });
  }

  function completeMission(state) {
    var d = def(cur);
    if (!d) return;
    state.player.money += d.reward;
    pushEvent('mission_done', { id: cur, reward: d.reward });
    if (cur === 2) {
      // Curi mobil menaikkan wanted (bila Agent 2 belum menaikkannya).
      if (state.wanted.level < 1) state.wanted.level = 1;
      state.wanted.cooldown = 12;
      pushEvent('wanted_up', { level: state.wanted.level });
    }
    if (cur >= 5) {
      state.mission = {
        id: 5,
        text: 'Pelarian besar berhasil — Rio bebas!',
        status: 'done',
      };
      setTarget(null);
      M3.gangLeft = 0;
      pushEvent('win', {});
      return; // cur tetap 5; main.js memicu gameOver(true)
    }
    startMission(state, cur + 1);
  }

  function resetInternal(state) {
    cur = 0;
    holdT = 0;
    removeGang(state);
    setTarget(null);
    if (beacon) {
      try { beacon.visible = false; } catch (err) { /* abaikan */ }
    }
  }

  // Sinkronisasi dengan state.mission (menangani resetRun() main.js dan
  // load save): bila main.js mengembalikan misi ke idle, internal ikut
  // reset; bila misi di state berbeda (mis. save dimuat), adopsi id itu.
  function syncFromState(state) {
    var m = state.mission;
    if (!m) return;
    if (m.id === 0 && m.status === 'idle') {
      if (cur !== 0) resetInternal(state);
      return;
    }
    if (m.id !== cur && m.id >= 1 && m.id <= 5) {
      cur = m.id;
      holdT = 0;
      if (m.status === 'done' && m.id === 5) {
        setTarget(null);
      } else {
        setTarget(def(cur));
        if (cur === 4) spawnGang(state);
      }
    }
  }

  // ---- API global (dipanggil main.js) ----
  function createMissions() {
    cur = 0;
    holdT = 0;
    gangSpawned = false;
    lastState = null;
    if (!attackBound && typeof window.addEventListener === 'function') {
      window.addEventListener('mousedown', onAttack);
      attackBound = true;
    }
    return { missions: MISSIONS.length - 1 };
  }

  function updateMissions(state, dt) {
    if (!state || !state.player) return;
    lastState = state;
    if (state.over) return;
    syncFromState(state);
    if (!state.started) return;
    if (state.mission.status === 'done') {
      updateBeacon();
      return;
    }
    if (cur === 0) {
      startMission(state, 1);
      updateBeacon();
      return;
    }
    var d = def(cur);
    if (!d) return;
    var p = state.player;
    var tgt = currentTarget(state, d);

    if (cur === 1 || cur === 3 || cur === 5) {
      if (cur === 3) {
        // Kejar-kejaran: polisi harus terus memburu sampai titik tercapai.
        if (state.wanted.level < 1) {
          state.wanted.level = 1;
          state.wanted.cooldown = 12;
          pushEvent('wanted_up', { level: 1 });
        }
      }
      if (dist(p.x, p.z, tgt.x, tgt.z) <= d.radius) completeMission(state);
    } else if (cur === 2) {
      if (p.inVehicle) {
        completeMission(state); // Agent 2 berhasil mencuri mobil
      } else if (dist(p.x, p.z, tgt.x, tgt.z) <= HOTWIRE_RADIUS) {
        holdT += dt; // membobol mobil (fallback bila Agent 2 belum ada)
        if (holdT >= HOTWIRE_TIME) completeMission(state);
      } else {
        holdT = 0;
      }
    } else if (cur === 4) {
      spawnGang(state);
      updateGang(state, dt);
      M3.gangLeft = gangLeft(state);
      if (M3.gangLeft === 0) completeMission(state);
    }
    updateBeacon();
  }

  window.createMissions = createMissions;
  window.updateMissions = updateMissions;
})();
