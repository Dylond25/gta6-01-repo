// Meridian Bay — polisi + sistem wanted (Agent 2, Kavi).
// Modul gameplay systems: unit polisi mengejar Rio sesuai level wanted
// (makin tinggi makin cepat dan agresif), menangkap bila menyentuh,
// dan wanted yang turun saat Rio bersembunyi.
//
// Kontrak (design draft + main.js):
//   createPolice() -> api        // TANPA argumen world (lihat bawah)
//   updatePolice(state, dt)
//   setWanted(state, level)      // level 0-5, cooldown 12 dtk
// Semua komunikasi lewat objek `state` bersama.
//
// Catatan: main.js memanggil createPolice() tanpa argumen, jadi modul
// ini TIDAK menerima world/scene saat dibuat. Mesh polisi dibuat malas
// (lazy) pada updatePolice pertama, lewat window.__MB__.world.group
// (sudah diset main.js sebelum frame pertama). Bila scene tidak
// tersedia, logika tetap jalan penuh — hanya visual yang absen.
'use strict';

(function () {
  var THREE = (typeof window !== 'undefined' && window.THREE) || null;

  // ---- Konstanta ----
  var MAX_UNITS = 5;
  var CATCH_DIST = 2.4;      // jarak sentuh = tertangkap
  var CATCH_FOOT_TIME = 1.2; // detik bersentuhan jalan kaki -> tertangkap
  var CATCH_CAR_TIME = 2.5;  // detik mobil pemain tertahan -> tertangkap
  var SPAWN_MIN = 45;        // jarak spawn minimum dari pemain
  var SPAWN_MAX = 70;        // jarak spawn maksimum dari pemain
  var SIGHT_RANGE = 50;      // dalam radius ini polisi "melihat" pemain
  var WANTED_COOLDOWN = 12;
  var CITY_EDGE = 208;

  // ---- State internal modul ----
  var units = [];            // pool unit polisi (aktif + nonaktif)
  var meshesReady = false;
  var uidSeq = 0;

  // ---- Util ----
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
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

  function worldGroup() {
    try {
      if (window.__MB__ && window.__MB__.world && window.__MB__.world.group) {
        return window.__MB__.world.group;
      }
    } catch (err) { /* abaikan */ }
    return null;
  }

  function worldColliders() {
    try {
      if (window.__MB__ && window.__MB__.world && window.__MB__.world.colliders) {
        return window.__MB__.world.colliders;
      }
    } catch (err) { /* abaikan */ }
    return null;
  }

  function hitsBuilding(x, z, r) {
    var cols = worldColliders();
    if (!cols) return false;
    for (var i = 0; i < cols.length; i++) {
      var b = cols[i];
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return false;
  }

  // ---- Mesh mobil polisi (hitam-putih + light bar merah/biru) ----
  function mat(color) {
    return new THREE.MeshLambertMaterial({ color: color });
  }

  function buildPoliceCarMesh() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.3), mat(0x1c1e26));
    body.position.y = 0.55;
    g.add(body);
    // Pintu putih (strip tengah) supaya terlihat seperti mobil polisi.
    var door = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.4, 1.7), mat(0xe8e8e8));
    door.position.set(0, 0.58, -0.2);
    g.add(door);
    var cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.66, 0.55, 2.1),
      new THREE.MeshLambertMaterial({ color: 0x1a2028 }));
    cab.position.set(0, 1.12, -0.25);
    g.add(cab);
    // Light bar: merah kiri, biru kanan — berkedip di updatePolice.
    var barBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.4), mat(0x22222c));
    barBase.position.set(0, 1.45, -0.25);
    g.add(barBase);
    var lightL = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.36),
      new THREE.MeshBasicMaterial({ color: 0xff2e2e }));
    lightL.position.set(-0.32, 1.56, -0.25);
    g.add(lightL);
    var lightR = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.36),
      new THREE.MeshBasicMaterial({ color: 0x2e6bff }));
    lightR.position.set(0.32, 1.56, -0.25);
    g.add(lightR);
    var lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    var tailMat = new THREE.MeshBasicMaterial({ color: 0xc22e2e });
    for (var s = -1; s <= 1; s += 2) {
      var hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lightMat);
      hl.position.set(s * 0.62, 0.62, 2.16);
      g.add(hl);
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), tailMat);
      tl.position.set(s * 0.62, 0.62, -2.16);
      g.add(tl);
    }
    var wheels = [];
    var wpos = [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]];
    for (var w = 0; w < wpos.length; w++) {
      var wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10), mat(0x14141a));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wpos[w][0], 0.36, wpos[w][1]);
      g.add(wheel);
      wheels.push(wheel);
    }
    return { group: g, wheels: wheels, lightL: lightL, lightR: lightR };
  }

  // ---- Spawn ----
  // Cari titik spawn di jalan, 45-70 m dari pemain.
  function spawnPoint(state) {
    var p = state.player;
    var roads = null;
    try {
      if (window.__MB__ && window.__MB__.world && window.__MB__.world.roads) {
        roads = window.__MB__.world.roads;
      }
    } catch (err) { roads = null; }
    for (var t = 0; t < 24; t++) {
      var x, z;
      if (roads && roads.length > 0) {
        var r = pick(roads);
        var along = rand(-CITY_EDGE, CITY_EDGE);
        if (r.axis === 'x') { x = along; z = r.at + (Math.random() < 0.5 ? 2.8 : -2.8); }
        else { x = r.at + (Math.random() < 0.5 ? 2.8 : -2.8); z = along; }
      } else {
        // Fallback tanpa data jalan: lingkaran acak di sekitar pemain.
        var ang = Math.random() * Math.PI * 2;
        var d = rand(SPAWN_MIN, SPAWN_MAX);
        x = p.x + Math.cos(ang) * d;
        z = p.z + Math.sin(ang) * d;
      }
      var dd = dist2(x, z, p.x, p.z);
      if (dd >= SPAWN_MIN && dd <= SPAWN_MAX + 30) return { x: x, z: z };
    }
    // Fallback terakhir: 55 m ke timur pemain.
    return { x: p.x + 55, z: p.z };
  }

  function ensureMeshes() {
    if (meshesReady || !THREE) return;
    var group = worldGroup();
    if (!group) return; // scene belum tersedia; coba lagi frame berikut
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.mesh) {
        var built = buildPoliceCarMesh();
        u.mesh = built.group;
        u.wheels = built.wheels;
        u.lightL = built.lightL;
        u.lightR = built.lightR;
        u.mesh.visible = false;
        group.add(built.group);
      }
    }
    meshesReady = true;
  }

  function getUnit() {
    for (var i = 0; i < units.length; i++) {
      if (!units[i].active) return units[i];
    }
    if (units.length >= MAX_UNITS) return null;
    var built = null;
    if (THREE && worldGroup()) {
      built = buildPoliceCarMesh();
      worldGroup().add(built.group);
      meshesReady = true;
    }
    var u = {
      id: 'mb-police-' + (uidSeq++),
      x: 0, z: 0, heading: 0, speed: 0,
      active: false, catchT: 0, sirenT: Math.random(),
      mesh: built ? built.group : null,
      wheels: built ? built.wheels : null,
      lightL: built ? built.lightL : null,
      lightR: built ? built.lightR : null,
    };
    if (u.mesh) u.mesh.visible = false;
    units.push(u);
    return u;
  }

  // ---- API global ----
  function createPolice() {
    units = [];
    meshesReady = false;
    uidSeq = 0;
    return { maxUnits: MAX_UNITS };
  }

  function setWanted(state, level) {
    if (!state || !state.wanted) return;
    var l = clamp(Math.round(level) || 0, 0, 5);
    if (l > state.wanted.level) pushEvent('wanted_up', { level: l });
    state.wanted.level = l;
    state.wanted.cooldown = l > 0 ? WANTED_COOLDOWN : 0;
  }

  function updatePolice(state, dt) {
    if (!state || !state.player || !state.wanted) return;
    if (!state.police) state.police = [];
    var wanted = state.wanted.level;
    var p = state.player;

    ensureMeshes();

    // Jumlah unit yang diinginkan: 0 bila wanted 0, 1+wanted (maks 5).
    var desired = wanted > 0 ? Math.min(1 + wanted, MAX_UNITS) : 0;

    // Spawn unit yang kurang.
    var active = 0;
    for (var i = 0; i < units.length; i++) if (units[i].active) active++;
    while (active < desired) {
      var u = getUnit();
      if (!u) break;
      var sp = spawnPoint(state);
      u.x = sp.x;
      u.z = sp.z;
      u.heading = Math.atan2(p.x - sp.x, p.z - sp.z);
      u.speed = 6;
      u.catchT = 0;
      u.active = true;
      active++;
    }
    // Nonaktifkan unit berlebih (wanted turun) — yang terjauh dulu.
    while (active > desired) {
      var far = null;
      var farD = -1;
      for (var j = 0; j < units.length; j++) {
        if (!units[j].active) continue;
        var d = dist2(units[j].x, units[j].z, p.x, p.z);
        if (d > farD) { farD = d; far = units[j]; }
      }
      if (!far) break;
      far.active = false;
      far.catchT = 0;
      if (far.mesh) far.mesh.visible = false;
      active--;
    }

    // Sinkronisasi state.police dengan unit aktif (anti-duplikat,
    // tahan resetRun() yang mengganti array-nya).
    for (var k = 0; k < units.length; k++) {
      var uu = units[k];
      var idx = -1;
      for (var m = 0; m < state.police.length; m++) {
        if (state.police[m].id === uu.id) { idx = m; break; }
      }
      if (uu.active && idx === -1) state.police.push(uu);
      if (!uu.active && idx !== -1) state.police.splice(idx, 1);
    }

    // Bersembunyi: tidak ada polisi dalam radius pandang -> cooldown
    // wanted turun 2x lebih cepat (di atas decay main.js).
    var seen = false;
    for (var s = 0; s < units.length; s++) {
      if (!units[s].active) continue;
      if (dist2(units[s].x, units[s].z, p.x, p.z) < SIGHT_RANGE) { seen = true; break; }
    }
    if (!seen && wanted > 0) {
      state.wanted.cooldown -= dt;
    }

    // Kejar pemain per unit.
    var topSpeed = 11 + wanted * 2.4; // wanted 5 -> 23 (sedikit di bawah sedan 25)
    for (var n = 0; n < units.length; n++) {
      var unit = units[n];
      if (!unit.active) continue;
      var dx = p.x - unit.x;
      var dz = p.z - unit.z;
      var d = Math.sqrt(dx * dx + dz * dz) || 0.001;
      // Belok menuju pemain (laju belok terbatas -> kejar-kejaran terasa).
      var targetHeading = Math.atan2(dx, dz);
      var turn = clamp(angDiff(targetHeading, unit.heading), -2.6 * dt, 2.6 * dt);
      unit.heading += turn;
      // Kecepatan: makin tinggi wanted makin agresif; pelan saat dekat
      // supaya tidak menabrak pemain terus-menerus.
      var want = d < 6 ? topSpeed * 0.55 : topSpeed;
      if (unit.speed < want) unit.speed = Math.min(want, unit.speed + 10 * dt);
      else if (unit.speed > want) unit.speed = Math.max(want, unit.speed - 12 * dt);
      var nx = unit.x + Math.sin(unit.heading) * unit.speed * dt;
      var nz = unit.z + Math.cos(unit.heading) * unit.speed * dt;
      // Hindari gedung: geser di dinding seperti pemain (main.js).
      if (!hitsBuilding(nx, unit.z, 1.1)) unit.x = nx;
      if (!hitsBuilding(unit.x, nz, 1.1)) unit.z = nz;
      unit.x = clamp(unit.x, -CITY_EDGE, CITY_EDGE);
      unit.z = clamp(unit.z, -CITY_EDGE, CITY_EDGE);

      // Menangkap: sentuh pemain.
      var dNow = dist2(unit.x, unit.z, p.x, p.z);
      if (dNow < CATCH_DIST) {
        if (p.inVehicle) {
          // Menabrak mobil pemain: perlambat mobilnya (ram).
          var pv = null;
          for (var v = 0; v < (state.vehicles || []).length; v++) {
            if (state.vehicles[v].id === p.vehicleId) { pv = state.vehicles[v]; break; }
          }
          if (pv) pv.speed *= Math.max(0, 1 - 1.8 * dt);
          if (pv && Math.abs(pv.speed) < 2.5) {
            unit.catchT += dt;
            if (unit.catchT > CATCH_CAR_TIME) {
              p.health = 0; // main.js: health <= 0 -> game over (tertangkap)
              pushEvent('caught', { level: wanted });
            }
          } else {
            unit.catchT = Math.max(0, unit.catchT - dt);
          }
        } else {
          unit.catchT += dt;
          if (unit.catchT > CATCH_FOOT_TIME) {
            p.health = 0;
            pushEvent('caught', { level: wanted });
          }
        }
      } else {
        unit.catchT = Math.max(0, unit.catchT - dt * 2);
      }

      // Sinkron mesh + light bar berkedip (merah/biru bergantian).
      if (unit.mesh) {
        unit.mesh.visible = true;
        unit.mesh.position.set(unit.x, 0, unit.z);
        unit.mesh.rotation.y = unit.heading;
        if (unit.wheels) {
          var spin = unit.speed * dt / 0.36;
          for (var w = 0; w < unit.wheels.length; w++) {
            unit.wheels[w].rotation.x += spin;
          }
        }
        unit.sirenT += dt;
        var phase = Math.floor(unit.sirenT / 0.35) % 2 === 0;
        if (unit.lightL && unit.lightL.material) {
          unit.lightL.material.color.setHex(phase ? 0xff2e2e : 0x551111);
        }
        if (unit.lightR && unit.lightR.material) {
          unit.lightR.material.color.setHex(phase ? 0x111155 : 0x2e6bff);
        }
      }
    }
  }

  window.createPolice = createPolice;
  window.updatePolice = updatePolice;
  window.setWanted = setWanted;
})();
