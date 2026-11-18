// Meridian Bay — combat jarak dekat (Agent 2, Kavi).
// Modul gameplay systems: pukulan / serangan jarak dekat (klik kiri).
// Mengurangi kesehatan target, melempar target ke belakang, membuat
// target kabur, dan menaikkan wanted bila ada polisi atau pejalan kaki
// lain yang melihat.
//
// Kontrak (design draft + main.js):
//   createCombat() -> api
//   attack(state) -> true bila mengenai target, false bila meleset
// Semua komunikasi lewat objek `state` bersama.
//
// Catatan integrasi dengan missions.js (Agent 3): saat misi 4 aktif,
// missions.js SUDAH mengurangi HP anggota geng lewat listener mousedown
// sendiri (15 HP per klik). Supaya satu klik tidak memberi damage ganda,
// attack() di sini MELEWATI anggota geng selama misi 4 aktif — damage
// geng tetap dari missions.js. Di luar misi 4, attack() bisa menyerang
// anggota geng juga (tidak ada handler ganda saat itu).
'use strict';

(function () {
  var THREE = (typeof window !== 'undefined' && window.THREE) || null;

  // ---- Konstanta ----
  var ATTACK_RANGE = 2.8;    // jangkauan pukulan
  var ATTACK_DAMAGE = 20;    // HP per pukulan
  var KNOCKBACK = 1.4;       // jarak target terlempar
  var WITNESS_POLICE = 55;   // polisi dalam radius ini melihat serangan
  var WITNESS_PED = 18;      // pejalan kaki lain dalam radius ini melapor
  var WANTED_COOLDOWN = 12;

  var swingMesh = null;      // efek ayunan (dibuat malas, disembunyikan timer)
  var swingTimer = null;

  // ---- Util ----
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function pushEvent(type, data) {
    try {
      var M3 = window.__MB_M3__;
      if (M3 && M3.events) {
        M3.events.push({ type: type, data: data || null, t: Date.now() });
        if (M3.events.length > 32) M3.events.splice(0, M3.events.length - 32);
      }
    } catch (err) { /* audio opsional */ }
  }

  // Ada saksi? Polisi dalam radius 55 m, atau pejalan kaki hidup lain
  // dalam radius 18 m (bukan target, bukan geng).
  function witnessed(state, target) {
    var i, d;
    var p = state.player;
    if (state.police) {
      for (i = 0; i < state.police.length; i++) {
        d = dist2(p.x, p.z, state.police[i].x, state.police[i].z);
        if (d < WITNESS_POLICE) return true;
      }
    }
    if (state.peds) {
      for (i = 0; i < state.peds.length; i++) {
        var ped = state.peds[i];
        if (ped === target || ped.gang || ped.health <= 0) continue;
        d = dist2(p.x, p.z, ped.x, ped.z);
        if (d < WITNESS_PED) return true;
      }
    }
    return false;
  }

  // Efek visual ayunan: cincin kuning di depan pemain, tampil 160 ms.
  // Dibuat malas lewat window.__MB__.world.group (main.js menyetelnya
  // sebelum frame pertama). Gagal diam-diam bila scene belum ada.
  function showSwing(state) {
    if (!THREE) return;
    try {
      if (!swingMesh) {
        if (!window.__MB__ || !window.__MB__.world || !window.__MB__.world.group) return;
        var geo = new THREE.RingGeometry(0.7, 2.6, 24, 1, -0.9, 1.8);
        var m = new THREE.MeshBasicMaterial({
          color: 0xffd94d, transparent: true, opacity: 0.55,
          side: THREE.DoubleSide, depthWrite: false,
        });
        swingMesh = new THREE.Mesh(geo, m);
        swingMesh.visible = false;
        window.__MB__.world.group.add(swingMesh);
      }
      var p = state.player;
      swingMesh.position.set(
        p.x + Math.sin(p.heading) * 1.4, 1.1,
        p.z + Math.cos(p.heading) * 1.4);
      swingMesh.rotation.set(-Math.PI / 2, 0, -p.heading);
      swingMesh.visible = true;
      if (swingTimer) clearTimeout(swingTimer);
      swingTimer = setTimeout(function () {
        if (swingMesh) swingMesh.visible = false;
      }, 160);
    } catch (err) { /* efek hanya kosmetik */ }
  }

  // ---- API global ----
  function createCombat() {
    swingMesh = null;
    swingTimer = null;
    return { range: ATTACK_RANGE, damage: ATTACK_DAMAGE };
  }

  function attack(state) {
    if (!state || !state.player) return false;
    var p = state.player;
    if (!state.started || state.over || state.paused) return false;
    if (p.inVehicle) return false; // tidak bisa memukul dari dalam mobil
    if (!state.peds) return false;

    showSwing(state);

    // Misi 4 aktif -> lewati anggota geng (damage mereka dari missions.js).
    var mission4 = state.mission &&
      state.mission.id === 4 && state.mission.status === 'active';

    // Target terdekat dalam jangkauan.
    var best = null;
    var bestD = ATTACK_RANGE;
    for (var i = 0; i < state.peds.length; i++) {
      var ped = state.peds[i];
      if (!ped || ped.health <= 0) continue;
      if (mission4 && ped.gang) continue;
      if (typeof ped.x !== 'number' || typeof ped.z !== 'number') continue;
      var d = dist2(p.x, p.z, ped.x, ped.z);
      if (d < bestD) { bestD = d; best = ped; }
    }
    if (!best) return false; // meleset

    // Damage + knockback + kabur.
    best.health -= ATTACK_DAMAGE;
    var dx = best.x - p.x;
    var dz = best.z - p.z;
    var dl = Math.sqrt(dx * dx + dz * dz) || 1;
    best.x += (dx / dl) * KNOCKBACK;
    best.z += (dz / dl) * KNOCKBACK;
    best.fleeing = true;
    best.fleeT = 4;
    best.tx = best.x + (dx / dl) * 26;
    best.tz = best.z + (dz / dl) * 26;
    if (best.health <= 0) {
      best.health = 0;
      // Tumbang: mesh berbaring (traffic.js tidak menggerakkan ped mati).
      if (best.mesh) {
        best.mesh.rotation.z = Math.PI / 2;
        best.mesh.position.y = 0.35;
      }
    }
    pushEvent('hit', { id: best.id || null });

    // Dilihat polisi / saksi -> wanted naik 1 bintang.
    if (witnessed(state, best)) {
      if (state.wanted) {
        state.wanted.level = clamp(state.wanted.level + 1, 0, 5);
        state.wanted.cooldown = WANTED_COOLDOWN;
        pushEvent('wanted_up', { level: state.wanted.level });
      }
    }
    return true;
  }

  window.createCombat = createCombat;
  window.attack = attack;
})();
