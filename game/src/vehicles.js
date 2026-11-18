// Meridian Bay — kendaraan + menyetir + curi mobil (Agent 2, Kavi).
// Modul gameplay systems: mobil parkir (termasuk mesh parkir detail M2),
// masuk/keluar mobil (E), curi mobil (F), dan mengemudi (WASD).
//
// Kontrak (design draft + main.js):
//   createVehicles(world) -> api
//   updateVehicles(state, dt)
//   tryEnterVehicle(state)   // E: masuk mobil terdekat / keluar bila di mobil
//   tryStealVehicle(state)   // F: curi mobil (wanted naik bila terlihat)
// Semua komunikasi lewat objek `state` bersama. Mesh ditambahkan ke
// world.group (sudah masuk scene lewat main.js). Tanpa request jaringan,
// semua aset prosedural (THREE.js + warna).
//
// Catatan pembagian kerja: mobil lalu lintas yang BERGERAK di-spawn dan
// digerakkan traffic.js (single owner per kendaraan); modul ini memiliki
// mobil parkir + mobil yang sedang dikendarai pemain. state.vehicles
// adalah gabungan keduanya (sinkronisasi berbasis id, anti-duplikat).
'use strict';

(function () {
  var THREE = (typeof window !== 'undefined' && window.THREE) || null;

  // ---- Konstanta ----
  var ENTER_RANGE = 4.2;   // jarak masuk mobil (E)
  var STEAL_RANGE = 4.5;   // jarak curi mobil (F)
  var WITNESS_POLICE = 55; // polisi dalam radius ini melihat pencurian
  var WITNESS_PED = 20;    // pejalan kaki dalam radius ini melihat pencurian
  var CITY_EDGE = 208;     // mobil tidak keluar dari grid jalan kota
  var WANTED_COOLDOWN = 12;

  var PARKED_TYPES = ['sedan', 'taxi', 'van', 'sedan', 'taxi', 'sedan', 'van', 'motor', 'sedan', 'taxi'];
  var PARKED_COLORS = [0xc23b2e, 0x2e6fc2, 0xd8d8d8, 0x3a3f4a, 0x7a4a9e, 0x2e8a5a, 0xb0702e, 0x8a2f4d, 0x4a6a7a, 0xc2a52e];

  // Titik parkir: {x, z, heading}. Dua di dekat titik misi 2 (54,108),
  // satu di dekat spawn (0,33) supaya pemain langsung bisa mencoba mobil.
  var PARKED_SPOTS = [
    { x: 50, z: 103.6, heading: Math.PI / 2 },
    { x: 62, z: 112.4, heading: -Math.PI / 2 },
    { x: 4.4, z: 20, heading: 0 },
    { x: -4.4, z: 42, heading: Math.PI },
    { x: 100, z: -4.4, heading: Math.PI / 2 },
    { x: -112, z: 4.4, heading: -Math.PI / 2 },
    { x: 157.6, z: 58, heading: 0 },
    { x: -58, z: -103.6, heading: Math.PI / 2 },
    { x: 112.4, z: -58, heading: Math.PI },
    { x: -166, z: 103.6, heading: -Math.PI / 2 },
  ];

  // Performa per jenis kendaraan.
  var SPECS = {
    sedan: { maxSpeed: 25, accel: 15, brake: 24, turn: 2.1, len: 4.3 },
    taxi: { maxSpeed: 24, accel: 15, brake: 24, turn: 2.1, len: 4.3 },
    van: { maxSpeed: 19, accel: 11, brake: 20, turn: 1.7, len: 4.9 },
    motor: { maxSpeed: 28, accel: 19, brake: 26, turn: 2.6, len: 2.4 },
  };

  // ---- State internal modul ----
  var worldRef = null;      // world dari createVehicles (roads/colliders/group)
  var parked = [];          // daftar mobil parkir (milik modul ini)
  var driveKeys = {};       // tombol mengemudi (listener sendiri, bukan input.js)
  var keysBound = false;

  // ---- Util ----
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
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

  // Antrean event Agent 3 (audio.js) — semua dibungkus try/catch.
  function pushEvent(type, data) {
    try {
      var M3 = window.__MB_M3__;
      if (M3 && M3.events) {
        M3.events.push({ type: type, data: data || null, t: Date.now() });
        if (M3.events.length > 32) M3.events.splice(0, M3.events.length - 32);
      }
    } catch (err) { /* audio opsional */ }
  }

  function raiseWanted(state, level) {
    if (!state || !state.wanted) return;
    if (level > state.wanted.level) {
      state.wanted.level = clamp(level, 0, 5);
      state.wanted.cooldown = WANTED_COOLDOWN;
      pushEvent('wanted_up', { level: state.wanted.level });
    }
  }

  // Ada saksi? Polisi dalam radius 55 m, atau pejalan kaki hidup
  // dalam radius 20 m (bukan geng — geng tidak melapor).
  function witnessed(state, x, z) {
    var i, d;
    if (state.police) {
      for (i = 0; i < state.police.length; i++) {
        d = dist2(x, z, state.police[i].x, state.police[i].z);
        if (d < WITNESS_POLICE) return true;
      }
    }
    if (state.peds) {
      for (i = 0; i < state.peds.length; i++) {
        var p = state.peds[i];
        if (p.gang || p.health <= 0) continue;
        d = dist2(x, z, p.x, p.z);
        if (d < WITNESS_PED) return true;
      }
    }
    return false;
  }

  // Tabrakan titik (x,z) radius r dengan gedung (AABB world.colliders).
  function hitsBuilding(x, z, r) {
    if (!worldRef || !worldRef.colliders) return false;
    for (var i = 0; i < worldRef.colliders.length; i++) {
      var b = worldRef.colliders[i];
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return false;
  }

  // ---- Mesh kendaraan (gaya render.js/world.js: Box + Cylinder) ----
  function mat(color) {
    return new THREE.MeshLambertMaterial({ color: color });
  }

  function addWheel(group, x, z, wheels) {
    var w = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10), mat(0x14141a));
    w.rotation.z = Math.PI / 2; // sumbu silinder -> sumbu X (as roda)
    w.position.set(x, 0.36, z);
    group.add(w);
    wheels.push(w);
    return w;
  }

  // Builder mobil umum (sedan/taksi/van/motor). Panjang di sumbu Z,
  // depan +Z, jadi rotation.y = heading langsung cocok dengan
  // forward = (sin heading, cos heading).
  function buildCarMesh(type, color) {
    var g = new THREE.Group();
    var wheels = [];
    var spec = SPECS[type] || SPECS.sedan;
    if (type === 'motor') {
      var bike = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 2.3), mat(color));
      bike.position.y = 0.75;
      g.add(bike);
      var seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.9), mat(0x1c1c22));
      seat.position.set(0, 1.05, -0.3);
      g.add(seat);
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.08), mat(0x22222c));
      bar.position.set(0, 1.15, 0.85);
      g.add(bar);
      addWheel(g, 0, 1.0, wheels);
      addWheel(g, 0, -1.0, wheels);
      var lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
      lamp.position.set(0, 0.8, 1.18);
      g.add(lamp);
      return { group: g, wheels: wheels };
    }
    var len = spec.len;
    var bodyH = type === 'van' ? 0.95 : 0.62;
    var bodyY = type === 'van' ? 0.72 : 0.55;
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.9, bodyH, len), mat(color));
    body.position.y = bodyY;
    g.add(body);
    var cabLen = type === 'van' ? len * 0.62 : 2.1;
    var cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.66, 0.55, cabLen),
      new THREE.MeshLambertMaterial({ color: 0x1a2028 }));
    cab.position.set(0, bodyY + bodyH / 2 + 0.26, type === 'van' ? -0.2 : -0.25);
    g.add(cab);
    // Bumper depan/belakang.
    var bump = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.22, 0.18), mat(0x22222c));
    bump.position.set(0, 0.32, len / 2);
    g.add(bump);
    var bumpB = bump.clone ? bump.clone() : null;
    if (bumpB) { bumpB.position.z = -len / 2; g.add(bumpB); }
    // Lampu depan (kuning) + belakang (merah).
    var lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    var tailMat = new THREE.MeshBasicMaterial({ color: 0xc22e2e });
    for (var s = -1; s <= 1; s += 2) {
      var hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lightMat);
      hl.position.set(s * 0.62, 0.62, len / 2 + 0.01);
      g.add(hl);
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), tailMat);
      tl.position.set(s * 0.62, 0.62, -len / 2 - 0.01);
      g.add(tl);
    }
    // Taksi: papan atap kuning-hitam.
    if (type === 'taxi') {
      var sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xe8b93b }));
      sign.position.set(0, bodyY + bodyH / 2 + 0.62, -0.25);
      g.add(sign);
    }
    addWheel(g, -0.85, len / 2 - 0.85, wheels);
    addWheel(g, 0.85, len / 2 - 0.85, wheels);
    addWheel(g, -0.85, -len / 2 + 0.85, wheels);
    addWheel(g, 0.85, -len / 2 + 0.85, wheels);
    return { group: g, wheels: wheels };
  }

  // ---- Mesh mobil parkir M2 (bagian Agent 2): sedan detail ----
  // Varian parkir yang lebih detail dari mobil lalu lintas biasa:
  // spion, lis krom, pelat nomor, dan rak atap — supaya mobil parkir
  // (target misi curi mobil) mudah dikenali di screenshot.
  function buildParkedCarMeshM2(color) {
    var built = buildCarMesh('sedan', color);
    var g = built.group;
    // Spion kiri/kanan.
    for (var s = -1; s <= 1; s += 2) {
      var mir = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.22), mat(0x22222c));
      mir.position.set(s * 1.02, 0.98, 0.75);
      g.add(mir);
    }
    // Lis krom di sisi bodi.
    var trimMat = new THREE.MeshBasicMaterial({ color: 0xd8d8e0 });
    for (var t = -1; t <= 1; t += 2) {
      var trim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 3.6), trimMat);
      trim.position.set(t * 0.96, 0.5, 0);
      g.add(trim);
    }
    // Pelat nomor depan/belakang (putih).
    var plateMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    var pf = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.03), plateMat);
    pf.position.set(0, 0.34, 2.17);
    g.add(pf);
    var pb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.03), plateMat);
    pb.position.set(0, 0.34, -2.17);
    g.add(pb);
    // Rak atap.
    var rack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 1.6), mat(0x2a2a32));
    rack.position.set(0, 1.42, -0.25);
    g.add(rack);
    return built;
  }

  // ---- Input mengemudi (listener sendiri; input.js tidak mengekspos axis) ----
  function bindDriveKeys() {
    if (keysBound || typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase();
      driveKeys[k] = true;
    });
    window.addEventListener('keyup', function (e) {
      driveKeys[(e.key || '').toLowerCase()] = false;
    });
    window.addEventListener('blur', function () {
      for (var k in driveKeys) driveKeys[k] = false;
    });
    keysBound = true;
  }

  function driveAxis() {
    var f = (driveKeys['w'] || driveKeys['arrowup']) ? 1 : 0;
    var b = (driveKeys['s'] || driveKeys['arrowdown']) ? 1 : 0;
    var l = (driveKeys['a'] || driveKeys['arrowleft']) ? 1 : 0;
    var r = (driveKeys['d'] || driveKeys['arrowright']) ? 1 : 0;
    return {
      throttle: f - b,
      steer: r - l, // +1 = belok kanan
      boost: !!driveKeys['shift'],
    };
  }

  // ---- API global ----
  function createVehicles(world) {
    worldRef = world || null;
    parked = [];
    bindDriveKeys();
    for (var i = 0; i < PARKED_SPOTS.length; i++) {
      var s = PARKED_SPOTS[i];
      var type = PARKED_TYPES[i % PARKED_TYPES.length];
      var color = PARKED_COLORS[i % PARKED_COLORS.length];
      var built = buildParkedCarMeshM2(color);
      // Motor parkir pakai builder motor (M2 khusus sedan).
      if (type === 'motor') built = buildCarMesh('motor', color);
      if (type === 'van') built = buildCarMesh('van', color);
      if (type === 'taxi') {
        // Taksi parkir tetap pakai detail M2 (spion/pelat) + papan taksi.
        var tb = buildCarMesh('taxi', color);
        built.group = tb.group;
        built.wheels = tb.wheels;
      }
      var spec = SPECS[type] || SPECS.sedan;
      var v = {
        id: 'mb-car-parked-' + i,
        type: type,
        color: color,
        x: s.x, z: s.z, heading: s.heading,
        speed: 0, maxSpeed: spec.maxSpeed,
        parked: true, stolen: false, driven: false, driver: false,
        mesh: built.group, wheels: built.wheels,
      };
      built.group.position.set(s.x, 0, s.z);
      built.group.rotation.y = s.heading;
      if (worldRef && worldRef.group && worldRef.group.add) {
        worldRef.group.add(built.group);
      }
      parked.push(v);
    }
    return { count: parked.length, parked: parked.length };
  }

  // Mobil terdekat dari (x,z) dalam radius r (dari state.vehicles).
  function nearestVehicle(state, x, z, r) {
    var best = null;
    var bestD = r;
    if (!state.vehicles) return null;
    for (var i = 0; i < state.vehicles.length; i++) {
      var v = state.vehicles[i];
      var d = dist2(x, z, v.x, v.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function enterCar(state, v) {
    var p = state.player;
    v.driven = true;
    v.parked = false;
    p.inVehicle = true;
    p.vehicleId = v.id;
    p.x = v.x;
    p.z = v.z;
    p.y = 0;
    p.heading = v.heading;
  }

  function exitCar(state, v) {
    var p = state.player;
    // Turun di sisi kanan mobil; bila terhalang gedung, coba sisi kiri.
    var rx = -Math.cos(v.heading);
    var rz = Math.sin(v.heading);
    var ex = v.x + rx * 2.4;
    var ez = v.z + rz * 2.4;
    if (hitsBuilding(ex, ez, 0.6)) {
      ex = v.x - rx * 2.4;
      ez = v.z - rz * 2.4;
    }
    v.driven = false;
    v.speed = 0;
    p.inVehicle = false;
    p.vehicleId = null;
    p.x = ex;
    p.z = ez;
    p.y = 0;
    p.vx = 0;
    p.vz = 0;
    p.heading = v.heading;
  }

  function tryEnterVehicle(state) {
    if (!state || !state.player) return false;
    var p = state.player;
    if (p.inVehicle) {
      // Keluar dari mobil yang sedang dikendarai.
      for (var i = 0; i < state.vehicles.length; i++) {
        if (state.vehicles[i].id === p.vehicleId) {
          exitCar(state, state.vehicles[i]);
          return true;
        }
      }
      p.inVehicle = false;
      p.vehicleId = null;
      return true;
    }
    // Masuk mobil tak berpenumpang terdekat (parkir / ditinggal).
    var best = null;
    var bestD = ENTER_RANGE;
    for (var j = 0; j < state.vehicles.length; j++) {
      var v = state.vehicles[j];
      if (v.driven || v.driver) continue; // ada sopir -> pakai F (curi)
      var d = dist2(p.x, p.z, v.x, v.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return false;
    enterCar(state, best);
    return true;
  }

  function tryStealVehicle(state) {
    if (!state || !state.player) return false;
    var p = state.player;
    if (p.inVehicle) return false; // sudah di mobil
    var v = nearestVehicle(state, p.x, p.z, STEAL_RANGE);
    if (!v || v.driven) return false;
    var seen = witnessed(state, v.x, v.z);
    if (v.driver) {
      // Begal mobil berisi sopir NPC: sopir kabur sebagai pejalan kaki.
      var rx = -Math.cos(v.heading);
      var rz = Math.sin(v.heading);
      if (state.peds) {
        state.peds.push({
          id: 'mb-driver-' + v.id,
          x: v.x + rx * 2.2, z: v.z + rz * 2.2,
          heading: v.heading, speed: 0,
          tx: v.x + rx * 26, tz: v.z + rz * 26,
          health: 100, maxHealth: 100,
          fleeing: true, driver: true, mesh: null,
        });
      }
      v.driver = false;
      if (seen) raiseWanted(state, 2);
    } else {
      // Mobil parkir / ditinggal: bobol dan bawa kabur.
      if (seen) raiseWanted(state, 1);
    }
    v.stolen = true;
    v.parked = false;
    enterCar(state, v);
    pushEvent('steal', { id: v.id });
    return true;
  }

  // Fisika mobil pemain: akselerasi, belok ikut kecepatan, tabrak gedung.
  function drivePlayerCar(state, v, dt) {
    var p = state.player;
    var a = driveAxis();
    var spec = SPECS[v.type] || SPECS.sedan;
    var top = spec.maxSpeed * (a.boost ? 1.22 : 1);
    if (a.throttle > 0) {
      v.speed += spec.accel * dt;
    } else if (a.throttle < 0) {
      if (v.speed > 0.5) v.speed -= spec.brake * dt; // rem
      else v.speed -= spec.accel * 0.7 * dt;          // mundur
    } else {
      // Hambatan gelinding.
      if (v.speed > 0) v.speed = Math.max(0, v.speed - 7 * dt);
      else v.speed = Math.min(0, v.speed + 7 * dt);
    }
    v.speed = clamp(v.speed, -8, top);
    // Belok: arah belok berbalik saat mundur; tidak belok saat diam.
    var spdF = clamp(v.speed / 8, -1, 1);
    v.heading -= a.steer * spec.turn * spdF * dt;
    var nx = v.x + Math.sin(v.heading) * v.speed * dt;
    var nz = v.z + Math.cos(v.heading) * v.speed * dt;
    // Tabrak gedung: geser di dinding seperti movePlayer (main.js).
    if (!hitsBuilding(nx, v.z, 1.1)) v.x = nx;
    else v.speed *= 0.4;
    if (!hitsBuilding(v.x, nz, 1.1)) v.z = nz;
    else v.speed *= 0.4;
    v.x = clamp(v.x, -CITY_EDGE, CITY_EDGE);
    v.z = clamp(v.z, -CITY_EDGE, CITY_EDGE);
    // Sinkronkan pemain ke mobil (kamera + HUD + misi membaca player).
    p.x = v.x;
    p.z = v.z;
    p.y = 0;
    p.heading = v.heading;
    p.vx = Math.sin(v.heading) * v.speed;
    p.vz = Math.cos(v.heading) * v.speed;
  }

  function syncMesh(v) {
    if (!v.mesh) return;
    v.mesh.position.set(v.x, 0, v.z);
    v.mesh.rotation.y = v.heading;
    if (v.wheels) {
      var spin = (v.speed || 0) * 0.016 / 0.36;
      for (var i = 0; i < v.wheels.length; i++) {
        v.wheels[i].rotation.x += spin;
      }
    }
  }

  function updateVehicles(state, dt) {
    if (!state || !state.player) return;
    if (!state.vehicles) state.vehicles = [];
    // Sinkronisasi mobil parkir ke state.vehicles (anti-duplikat by id;
    // tahan terhadap resetRun() main.js yang mengganti array-nya).
    for (var i = 0; i < parked.length; i++) {
      var found = false;
      for (var j = 0; j < state.vehicles.length; j++) {
        if (state.vehicles[j].id === parked[i].id) { found = true; break; }
      }
      if (!found) state.vehicles.push(parked[i]);
    }
    // Bila pemain tidak di mobil, tidak ada mobil yang berstatus driven.
    if (!state.player.inVehicle) {
      for (var k = 0; k < state.vehicles.length; k++) {
        if (state.vehicles[k].driven) state.vehicles[k].driven = false;
      }
    }
    // Kendarai mobil pemain (bila ada).
    if (state.player.inVehicle && state.player.vehicleId) {
      for (var m = 0; m < state.vehicles.length; m++) {
        var v = state.vehicles[m];
        if (v.id === state.player.vehicleId && v.driven) {
          drivePlayerCar(state, v, dt);
          break;
        }
      }
    }
    // Sinkronkan semua mesh mobil milik modul ini.
    for (var n = 0; n < parked.length; n++) syncMesh(parked[n]);
  }

  window.createVehicles = createVehicles;
  window.updateVehicles = updateVehicles;
  window.tryEnterVehicle = tryEnterVehicle;
  window.tryStealVehicle = tryStealVehicle;
})();
