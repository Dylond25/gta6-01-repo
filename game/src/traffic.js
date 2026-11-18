// Meridian Bay — lalu lintas + pejalan kaki (Agent 2, Kavi).
// Modul gameplay systems: mobil lalu lintas AI yang mengikuti jalan
// (lajur kanan, belok di persimpangan, berhenti di belakang mobil lain)
// dan pejalan kaki yang berjalan di trotoar, menyeberang sesekali, dan
// kabur saat ada kendaraan melaju ke arah mereka.
//
// Kontrak (design draft + main.js):
//   createTraffic(world) -> api
//   updateTraffic(state, dt)
// Isi state.peds (posisi + tujuan jalan) dan state.vehicles (mobil
// lalu lintas). Semua komunikasi lewat objek `state` bersama.
//
// Pembagian kerja dengan vehicles.js: modul ini memiliki mobil lalu
// lintas yang BERGERAK + semua pejalan kaki; vehicles.js memiliki mobil
// parkir + mobil yang dikendarai pemain. Sinkronisasi ke state memakai
// id (anti-duplikat, tahan resetRun()).
//
// Pejalan kaki dari modul lain (geng misi 4 dari missions.js: entri
// state.peds {gang:true} tanpa tx/tz/mesh) TIDAK digerakkan modul ini —
// missions.js yang menggerakkan mereka. Entri tanpa mesh (sopir yang
// dibegal vehicles.js) tetap digerakkan logikanya, tanpa sinkron mesh.
'use strict';

(function () {
  var THREE = (typeof window !== 'undefined' && window.THREE) || null;

  // ---- Konstanta ----
  var TRAFFIC_COUNT = 8;
  var PED_COUNT = 14;
  var LANE = 2.8;            // offset lajur kanan dari garis tengah jalan
  var SIDEWALK = 7.6;        // offset trotoar dari garis tengah jalan
  var ROAD_HALF = 6;         // setengah lebar jalan (roadWidth 12)
  var CITY_EDGE = 208;       // ujung grid jalan kota
  var TURN_CHANCE = 0.004;   // peluang belok per frame saat di persimpangan
  var PED_FLEE_SPEED = 3.4;

  var TRAFFIC_TYPES = ['sedan', 'taxi', 'van', 'sedan', 'taxi', 'sedan', 'van', 'sedan'];
  var TRAFFIC_COLORS = [0x3a6ac2, 0xd8b93b, 0x5a5f6a, 0x7a2e2e, 0x2e7a4a, 0x9e9aa8, 0x4a3a6a, 0xc2702e];
  var PED_SHIRTS = [0xc23b2e, 0x2e6fc2, 0x2e8a5a, 0xd8b93b, 0x7a4a9e, 0xd8d8d8, 0x3a3f4a, 0xb0702e];
  var PED_SKINS = [0xd9a986, 0xb98a68, 0x8a6248, 0xe8c39a];

  // ---- State internal modul ----
  var worldRef = null;
  var trafficCars = [];
  var peds = [];

  // ---- Util ----
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // Lajur kanan: lajur = +2.8 atau -2.8 tergantung sumbu + arah.
  function laneFor(axis, dir) {
    if (axis === 'x') return dir > 0 ? LANE : -LANE;
    return dir > 0 ? -LANE : LANE;
  }
  // Heading dari sumbu + arah (depan = (sin h, cos h)).
  function headingFor(axis, dir) {
    if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    return dir > 0 ? 0 : Math.PI;
  }

  // Daftar pusat jalan dari world.roads [{axis, at}].
  function roadCenters(axis) {
    var out = [];
    if (!worldRef || !worldRef.roads) return out;
    for (var i = 0; i < worldRef.roads.length; i++) {
      if (worldRef.roads[i].axis === axis) out.push(worldRef.roads[i].at);
    }
    return out;
  }

  // ---- Mesh ----
  function mat(color) {
    return new THREE.MeshLambertMaterial({ color: color });
  }

  function addWheel(group, x, z, wheels) {
    var w = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10), mat(0x14141a));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    group.add(w);
    wheels.push(w);
    return w;
  }

  // Builder mobil lalu lintas (sedan/taksi/van). Sama gaya dengan
  // vehicles.js (ditulis ulang di sini supaya modul mandiri).
  function buildTrafficCarMesh(type, color) {
    var g = new THREE.Group();
    var wheels = [];
    var len = type === 'van' ? 4.9 : 4.3;
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

  // Pejalan kaki: humanoid kecil (gaya mesh pemain di render.js).
  function buildPedMesh(shirt, skin) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.66, 0.3), mat(shirt));
    body.position.y = 1.12;
    g.add(body);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.28), mat(skin));
    head.position.y = 1.66;
    g.add(head);
    var hair = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.3), mat(0x1c1c22));
    hair.position.y = 1.84;
    g.add(hair);
    var legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), mat(0x23232e));
    legL.position.set(-0.14, 0.39, 0);
    g.add(legL);
    var legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), mat(0x23232e));
    legR.position.set(0.14, 0.39, 0);
    g.add(legR);
    return { group: g, legL: legL, legR: legR, phase: Math.random() * 6 };
  }

  // ---- Spawn ----
  function spawnTrafficCar(i) {
    var xs = roadCenters('x');
    var zs = roadCenters('z');
    var axis = Math.random() < 0.5 ? 'x' : 'z';
    var at = axis === 'x' ? pick(xs) : pick(zs);
    var dir = Math.random() < 0.5 ? 1 : -1;
    var lane = laneFor(axis, dir);
    var along = rand(-CITY_EDGE + 10, CITY_EDGE - 10);
    var type = TRAFFIC_TYPES[i % TRAFFIC_TYPES.length];
    var color = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length];
    var built = buildTrafficCarMesh(type, color);
    var x = axis === 'x' ? along : at + lane;
    var z = axis === 'x' ? at + lane : along;
    var car = {
      id: 'mb-car-traffic-' + i,
      type: type, color: color,
      x: x, z: z, heading: headingFor(axis, dir),
      speed: rand(6, 11), targetSpeed: type === 'van' ? 8.5 : rand(9, 13),
      maxSpeed: type === 'van' ? 12 : 14,
      parked: false, stolen: false, driven: false, driver: true,
      roadAxis: axis, roadAt: at, dir: dir, lane: lane,
      mesh: built.group, wheels: built.wheels,
    };
    built.group.position.set(x, 0, z);
    built.group.rotation.y = car.heading;
    if (worldRef && worldRef.group && worldRef.group.add) worldRef.group.add(built.group);
    return car;
  }

  // Pejalan kaki di trotoar: garis sejajar jalan, offset +-7.6 m.
  function spawnPed(i) {
    var xs = roadCenters('x');
    var zs = roadCenters('z');
    var axis = Math.random() < 0.5 ? 'x' : 'z';
    var at = axis === 'x' ? pick(xs) : pick(zs);
    var side = Math.random() < 0.5 ? 1 : -1;
    var line = at + side * SIDEWALK;
    var along = rand(-CITY_EDGE + 10, CITY_EDGE - 10);
    var dir = Math.random() < 0.5 ? 1 : -1;
    var shirt = PED_SHIRTS[i % PED_SHIRTS.length];
    var skin = PED_SKINS[i % PED_SKINS.length];
    var built = buildPedMesh(shirt, skin);
    var x = axis === 'x' ? along : line;
    var z = axis === 'x' ? line : along;
    var ped = {
      id: 'mb-ped-' + i,
      x: x, z: z, heading: headingFor(axis, dir),
      speed: rand(1.0, 1.7),
      tx: x, tz: z,
      health: 100, maxHealth: 100,
      fleeing: false, fleeT: 0, waitT: 0,
      axis: axis, line: line, dir: dir,
      mesh: built.group, legL: built.legL, legR: built.legR, phase: built.phase,
    };
    // Tujuan pertama: 25-60 m ke arah jalan kaki.
    pickPedTarget(ped, true);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = ped.heading;
    if (worldRef && worldRef.group && worldRef.group.add) worldRef.group.add(built.group);
    return ped;
  }

  // Pilih tujuan jalan baru untuk pejalan kaki: lanjut lurus, belok di
  // persimpangan, atau menyeberang ke trotoar seberang (20%).
  function pickPedTarget(ped, first) {
    var dist = rand(25, 60);
    var cross = !first && Math.random() < 0.2;
    if (cross) {
      // Menyeberang: tujuan di trotoar seberang jalan yang sama.
      var base = ped.axis === 'x' ? ped.z : ped.x;
      var nearRoad = Math.round(base / 54) * 54;
      var targetLine = nearRoad - (ped.line - nearRoad);
      if (ped.axis === 'x') { ped.tx = ped.x + rand(-8, 8); ped.tz = targetLine; }
      else { ped.tx = targetLine; ped.tz = ped.z + rand(-8, 8); }
      ped.line = targetLine;
      return;
    }
    // Belok di persimpangan (35%): ganti sumbu jalan kaki.
    if (!first && Math.random() < 0.35) {
      var centers = ped.axis === 'x' ? roadCenters('z') : roadCenters('x');
      if (centers.length > 0) {
        var crossAt = pick(centers);
        var newAxis = ped.axis === 'x' ? 'z' : 'x';
        var side = Math.random() < 0.5 ? 1 : -1;
        var newLine = crossAt + side * SIDEWALK;
        if (newAxis === 'x') { ped.tx = ped.x + ped.dir * dist; ped.tz = newLine; }
        else { ped.tx = newLine; ped.tz = ped.z + ped.dir * dist; }
        ped.axis = newAxis;
        ped.line = newLine;
        ped.dir = Math.random() < 0.5 ? 1 : -1;
        return;
      }
    }
    // Lanjut lurus di trotoar yang sama.
    if (ped.axis === 'x') { ped.tx = ped.x + ped.dir * dist; ped.tz = ped.line; }
    else { ped.tx = ped.line; ped.tz = ped.z + ped.dir * dist; }
    ped.tx = clamp(ped.tx, -CITY_EDGE, CITY_EDGE);
    ped.tz = clamp(ped.tz, -CITY_EDGE, CITY_EDGE);
  }

  // ---- API global ----
  function createTraffic(world) {
    worldRef = world || null;
    trafficCars = [];
    peds = [];
    for (var i = 0; i < TRAFFIC_COUNT; i++) trafficCars.push(spawnTrafficCar(i));
    for (var j = 0; j < PED_COUNT; j++) peds.push(spawnPed(j));
    return { cars: trafficCars.length, peds: peds.length };
  }

  // Mobil di depan (jalur sama, searah, dalam jarak gap) -> pelan/berhenti.
  function carAhead(state, car, gap) {
    var best = gap;
    var list = state.vehicles || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === car || o.parked) continue;
      if (o.roadAxis !== car.roadAxis || Math.abs(o.roadAt - car.roadAt) > 1.5) continue;
      if (o.dir !== car.dir) continue;
      var along = car.roadAxis === 'x' ? (o.x - car.x) * car.dir : (o.z - car.z) * car.dir;
      if (along > 0 && along < best) best = along;
    }
    return best;
  }

  // Pejalan kaki di depan mobil dalam jarak gap (di jalan yang sama).
  function pedAhead(state, car, gap) {
    var list = state.peds || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.health <= 0) continue;
      var dx = p.x - car.x;
      var dz = p.z - car.z;
      var ahead = car.roadAxis === 'x' ? dx * car.dir : dz * car.dir;
      var side = car.roadAxis === 'x' ? Math.abs(dz - (car.lane || 0)) : Math.abs(dx - (car.lane || 0));
      if (ahead > 0 && ahead < gap && side < 3.5) return true;
    }
    return false;
  }

  function updateTrafficCar(state, car, dt) {
    // Mobil pemain / mobil parkir bukan urusan modul ini.
    if (car.driven || car.parked) return;
    var want = car.targetSpeed;
    // Berhenti di belakang mobil lain / pejalan kaki di depan.
    if (carAhead(state, car, 9) < 9 || pedAhead(state, car, 7)) want = 0;
    // Mobil pemain di depan (jalur sama) juga membuat lalu lintas pelan.
    if (state.player && state.player.inVehicle) {
      var pv = null;
      for (var i = 0; i < (state.vehicles || []).length; i++) {
        if (state.vehicles[i].id === state.player.vehicleId) { pv = state.vehicles[i]; break; }
      }
      if (pv && pv.roadAxis === car.roadAxis && Math.abs((pv.roadAt || 0) - car.roadAt) < 1.5) {
        var alongP = car.roadAxis === 'x' ? (pv.x - car.x) * car.dir : (pv.z - car.z) * car.dir;
        if (alongP > 0 && alongP < 9) want = 0;
      }
    }
    if (car.speed < want) car.speed = Math.min(want, car.speed + 6 * dt);
    else if (car.speed > want) car.speed = Math.max(want, car.speed - 9 * dt);

    // Maju di jalurnya.
    if (car.roadAxis === 'x') {
      car.x += car.dir * car.speed * dt;
      car.z = car.roadAt + car.lane;
    } else {
      car.z += car.dir * car.speed * dt;
      car.x = car.roadAt + car.lane;
    }
    car.heading = headingFor(car.roadAxis, car.dir);

    // Belok di persimpangan: bila dekat garis tengah jalan melintang.
    var others = car.roadAxis === 'x' ? roadCenters('z') : roadCenters('x');
    var alongPos = car.roadAxis === 'x' ? car.x : car.z;
    for (var k = 0; k < others.length; k++) {
      if (Math.abs(alongPos - others[k]) < 2.5 && Math.random() < TURN_CHANCE) {
        var newAxis = car.roadAxis === 'x' ? 'z' : 'x';
        var newDir = Math.random() < 0.5 ? 1 : -1;
        car.roadAxis = newAxis;
        car.roadAt = others[k];
        car.dir = newDir;
        car.lane = laneFor(newAxis, newDir);
        break;
      }
    }
    // Ujung kota: putar balik.
    if (alongPos > CITY_EDGE || alongPos < -CITY_EDGE) {
      car.dir *= -1;
      car.lane = laneFor(car.roadAxis, car.dir);
    }
    // Sinkron mesh.
    if (car.mesh) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
      if (car.wheels) {
        var spin = car.speed * dt / 0.36;
        for (var w = 0; w < car.wheels.length; w++) car.wheels[w].rotation.x += spin;
      }
    }
  }

  function updatePed(state, ped, dt) {
    // Geng misi 4 (tanpa tx/tz) dan pejalan kaki tumbang tidak digerakkan.
    if (ped.gang) return;
    if (ped.health <= 0) return;
    if (typeof ped.tx !== 'number' || typeof ped.tz !== 'number') return;

    // Kabur: ada kendaraan melaju ke arah pejalan kaki.
    if (!ped.fleeing) {
      var list = state.vehicles || [];
      for (var i = 0; i < list.length; i++) {
        var v = list[i];
        if (Math.abs(v.speed || 0) < 3) continue;
        var d = dist2(ped.x, ped.z, v.x, v.z);
        if (d < 5.5) {
          ped.fleeing = true;
          ped.fleeT = 3.5;
          var fx = ped.x - v.x;
          var fz = ped.z - v.z;
          var fl = Math.sqrt(fx * fx + fz * fz) || 1;
          ped.tx = ped.x + (fx / fl) * 24;
          ped.tz = ped.z + (fz / fl) * 24;
          break;
        }
      }
    }
    if (ped.fleeing) {
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) { ped.fleeing = false; pickPedTarget(ped, false); }
    }

    // Berjalan menuju tujuan.
    var dx = ped.tx - ped.x;
    var dz = ped.tz - ped.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1.2) {
      if (ped.waitT > 0) {
        ped.waitT -= dt;
        if (ped.waitT <= 0) pickPedTarget(ped, false);
      } else {
        // Berhenti sebentar di tujuan (15% peluang), lalu jalan lagi.
        if (Math.random() < 0.15) ped.waitT = rand(1, 3);
        else pickPedTarget(ped, false);
      }
    } else {
      var spd = ped.fleeing ? PED_FLEE_SPEED : (ped.speed || 1.3);
      var step = spd * dt;
      ped.x += (dx / d) * step;
      ped.z += (dz / d) * step;
      ped.heading = Math.atan2(dx, dz);
      ped.x = clamp(ped.x, -CITY_EDGE, CITY_EDGE);
      ped.z = clamp(ped.z, -CITY_EDGE, CITY_EDGE);
    }
    // Sinkron mesh (bila ada) + animasi kaki.
    if (ped.mesh) {
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.heading;
      if (ped.health > 0 && d >= 1.2) {
        ped.phase = (ped.phase || 0) + dt * (ped.fleeing ? 11 : 7);
        var swing = Math.sin(ped.phase) * 0.5;
        if (ped.legL) ped.legL.rotation.x = swing;
        if (ped.legR) ped.legR.rotation.x = -swing;
      } else if (ped.legL && ped.legR) {
        ped.legL.rotation.x *= 0.8;
        ped.legR.rotation.x *= 0.8;
      }
    }
  }

  function updateTraffic(state, dt) {
    if (!state) return;
    if (!state.vehicles) state.vehicles = [];
    if (!state.peds) state.peds = [];
    // Sinkronisasi mobil lalu lintas ke state.vehicles (anti-duplikat).
    for (var i = 0; i < trafficCars.length; i++) {
      var found = false;
      for (var j = 0; j < state.vehicles.length; j++) {
        if (state.vehicles[j].id === trafficCars[i].id) { found = true; break; }
      }
      if (!found) state.vehicles.push(trafficCars[i]);
    }
    // Sinkronisasi pejalan kaki ke state.peds (anti-duplikat).
    for (var k = 0; k < peds.length; k++) {
      var foundP = false;
      for (var m = 0; m < state.peds.length; m++) {
        if (state.peds[m].id === peds[k].id) { foundP = true; break; }
      }
      if (!foundP) state.peds.push(peds[k]);
    }
    // Gerakkan mobil lalu lintas (termasuk mobil curian yang ditinggal:
    // parked=false + driven=false -> AI mengambil alih lagi).
    for (var c = 0; c < trafficCars.length; c++) {
      updateTrafficCar(state, trafficCars[c], dt);
    }
    // Gerakkan semua pejalan kaki di state (termasuk sopir yang dibegal
    // — mereka punya tx/tz; geng misi 4 dilewati di updatePed).
    for (var p = 0; p < state.peds.length; p++) {
      updatePed(state, state.peds[p], dt);
    }
  }

  window.createTraffic = createTraffic;
  window.updateTraffic = updateTraffic;
})();
