// Meridian Bay — the city itself.
// createWorld() builds the whole 3D harbour city procedurally: a street
// grid, towers with lit windows, street lamps, the sea and a dusk sky.
// Everything is generated at load time from a fixed seed, so the city is
// identical on every run and no asset file is ever downloaded.
(function (global) {
  'use strict';

  // Deterministic RNG (mulberry32) so the city never changes between loads.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A facade texture: dark wall with a grid of windows, a share of them
  // lit warm yellow. Shared by every building of one variant.
  function makeWindowTexture(rng, variant) {
    var c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    var g = c.getContext('2d');
    var shades = ['#2e2a33', '#332f38', '#2a2e38', '#38302e'];
    g.fillStyle = shades[variant % shades.length];
    g.fillRect(0, 0, 128, 256);
    var cols = 6;
    var rows = 14;
    var ww = 128 / cols;
    var wh = 256 / rows;
    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        var lit = rng() < 0.42;
        if (lit) {
          var warm = ['#ffd27a', '#ffb85e', '#ffe9a8', '#ff9e57'];
          g.fillStyle = warm[(rng() * warm.length) | 0];
        } else {
          g.fillStyle = rng() < 0.5 ? '#14121a' : '#1d2431';
        }
        g.fillRect(col * ww + 3, r * wh + 4, ww - 6, wh - 8);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Asphalt with a dashed centre line and edge lines, tiled along a road.
  // The texture's U axis runs ALONG the road, so the dashes and edge lines
  // are horizontal in texture space (constant V, spanning U).
  function makeRoadTexture() {
    var c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#2e323c';
    g.fillRect(0, 0, 128, 128);
    // faint tyre-wear bands running along the road
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, 34, 128, 16);
    g.fillRect(0, 78, 128, 16);
    // edge lines (top and bottom of the tile = road edges)
    g.fillStyle = '#c8c4b8';
    g.fillRect(0, 3, 128, 3);
    g.fillRect(0, 122, 128, 3);
    // dashed centre line (middle of the tile, broken along U)
    g.fillStyle = '#e8c33c';
    g.fillRect(6, 62, 46, 4);
    g.fillRect(76, 62, 46, 4);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Vertical dusk gradient for the sky dome. The canvas top is the zenith
  // and the canvas middle is the horizon (CanvasTexture flipY), so the
  // bright orange band sits at the middle of the canvas.
  function makeSkyTexture() {
    var c = document.createElement('canvas');
    c.width = 16;
    c.height = 256;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#241640');
    grad.addColorStop(0.30, '#4b2560');
    grad.addColorStop(0.44, '#8a3d6b');
    grad.addColorStop(0.50, '#ff8a3d');
    grad.addColorStop(0.56, '#ffc46b');
    grad.addColorStop(0.66, '#7a4468');
    grad.addColorStop(1.0, '#1d1233');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Build the city. Returns the render group plus the data other modules
  // need: spawn points, road centre lines, building collision boxes and
  // the city bounds.
  function createWorld() {
    var cfg = global.MB_CONFIG;
    var rng = mulberry32(20261117);
    var group = new THREE.Group();
    group.name = 'meridian-bay-city';

    var half = cfg.cityHalf;
    var colliders = []; // {minX, maxX, minZ, maxZ} per building, for walking
    var roads = [];     // centre-line polylines vehicles and peds can follow

    // ---- Ground: one big sidewalk slab under everything ----
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2 + 260, half * 2 + 260),
      new THREE.MeshLambertMaterial({ color: cfg.groundColor })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-60, 0, 0);
    ground.receiveShadow = false;
    group.add(ground);

    // ---- Roads: dark strips with dashed centres, along every street ----
    // The flat orientation is baked into the geometry (rotateX), and the
    // cross-street copy is turned by rotating the geometry about Y, so no
    // mesh ever combines two Euler rotations.
    var roadTex = makeRoadTexture();
    var centers = cfg.streetCenters;
    var span = half * 2;
    var flatGeo = new THREE.PlaneGeometry(span, cfg.streetWidth);
    flatGeo.rotateX(-Math.PI / 2);
    var flatGeoZ = flatGeo.clone();
    flatGeoZ.rotateY(Math.PI / 2);
    centers.forEach(function (c, i) {
      var texX = roadTex.clone();
      texX.needsUpdate = true;
      texX.repeat.set(span / 14, 1);
      var rx = new THREE.Mesh(
        flatGeo,
        new THREE.MeshLambertMaterial({ map: texX })
      );
      rx.position.set(0, 0.02, c);
      group.add(rx);
      var texZ = roadTex.clone();
      texZ.needsUpdate = true;
      texZ.repeat.set(span / 14, 1);
      var rz = new THREE.Mesh(
        flatGeoZ,
        new THREE.MeshLambertMaterial({ map: texZ })
      );
      rz.position.set(c, 0.02, 0);
      group.add(rz);
      roads.push({ axis: 'x', at: c, from: -half, to: half });
      roads.push({ axis: 'z', at: c, from: -half, to: half });
    });

    // ---- Buildings: one or two towers per block, lit windows at dusk ----
    var winTex = [
      makeWindowTexture(rng, 0),
      makeWindowTexture(rng, 1),
      makeWindowTexture(rng, 2),
      makeWindowTexture(rng, 3),
    ];
    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0); // origin at the base, so scale.y = height
    var roofGeo = new THREE.BoxGeometry(1, 1, 1);
    for (var bx = 0; bx < cfg.blocksPerSide; bx++) {
      for (var bz = 0; bz < cfg.blocksPerSide; bz++) {
        var blockCX = centers[bx] + cfg.pitch / 2;
        var blockCZ = centers[bz] + cfg.pitch / 2;
        var count = rng() < 0.45 ? 1 : 2;
        for (var b = 0; b < count; b++) {
          var w = 13 + rng() * 9;
          var d = 13 + rng() * 9;
          var h = cfg.buildingMinHeight +
            Math.pow(rng(), 1.6) * (cfg.buildingMaxHeight - cfg.buildingMinHeight);
          var ox = count === 1 ? 0 : (b === 0 ? -8 : 8);
          var oz = count === 1 ? 0 : (b === 0 ? 7 : -7);
          var px = blockCX + ox + (rng() - 0.5) * 3;
          var pz = blockCZ + oz + (rng() - 0.5) * 3;
          var tint = cfg.buildingColors[(rng() * cfg.buildingColors.length) | 0];
          var mat = new THREE.MeshLambertMaterial({
            map: winTex[(rng() * winTex.length) | 0],
            color: tint,
            emissive: 0xff9a3c,
            emissiveMap: winTex[(rng() * winTex.length) | 0],
            emissiveIntensity: 0.55,
          });
          var tower = new THREE.Mesh(boxGeo, mat);
          tower.scale.set(w, h, d);
          tower.position.set(px, 0, pz);
          group.add(tower);
          // flat roof cap, slightly wider, in a dark tone
          var roof = new THREE.Mesh(
            roofGeo,
            new THREE.MeshLambertMaterial({ color: 0x2a2d36 })
          );
          roof.scale.set(w + 0.6, 0.8, d + 0.6);
          roof.position.set(px, h, pz);
          group.add(roof);
          // a few towers get a rooftop beacon that blinks at dusk
          if (h > 46 && rng() < 0.5) {
            var beacon = new THREE.Mesh(
              new THREE.SphereGeometry(0.9, 8, 8),
              new THREE.MeshBasicMaterial({ color: 0xff3b30 })
            );
            beacon.position.set(px, h + 1.2, pz);
            beacon.name = 'beacon';
            group.add(beacon);
          }
          colliders.push({
            minX: px - w / 2, maxX: px + w / 2,
            minZ: pz - d / 2, maxZ: pz + d / 2,
          });
        }
      }
    }

    // ---- Street lamps: instanced poles + glowing heads, at intersections ----
    var lampSpots = [];
    centers.forEach(function (cx) {
      centers.forEach(function (cz) {
        lampSpots.push([cx + 8.5, cz + 8.5]);
      });
    });
    var poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6.5, 6);
    poleGeo.translate(0, 3.25, 0);
    var headGeo = new THREE.SphereGeometry(0.42, 10, 8);
    var poleMesh = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshLambertMaterial({ color: 0x2f333d }),
      lampSpots.length
    );
    var headMesh = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshBasicMaterial({ color: cfg.lampColor }),
      lampSpots.length
    );
    var m4 = new THREE.Matrix4();
    lampSpots.forEach(function (p, i) {
      m4.makeTranslation(p[0], 0, p[1]);
      poleMesh.setMatrixAt(i, m4);
      m4.makeTranslation(p[0], 6.6, p[1]);
      headMesh.setMatrixAt(i, m4);
    });
    poleMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    group.add(poleMesh);
    group.add(headMesh);

    // ---- Harbour sea to the west, with a pier and moored boats ----
    var sea = new THREE.Mesh(
      new THREE.PlaneGeometry(240, half * 2 + 260),
      new THREE.MeshLambertMaterial({ color: cfg.seaColor })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-half - 120, -0.4, 0);
    group.add(sea);
    // pier jutting into the water
    var pier = new THREE.Mesh(
      new THREE.BoxGeometry(70, 1.2, 10),
      new THREE.MeshLambertMaterial({ color: 0x6b4f35 })
    );
    pier.position.set(-half - 32, 0.4, 40);
    group.add(pier);
    var pierPosts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x4a3524 }),
      8
    );
    for (var pi = 0; pi < 8; pi++) {
      m4.makeTranslation(-half - 62 + pi * 9, -0.4, pi % 2 === 0 ? 35.5 : 44.5);
      pierPosts.setMatrixAt(pi, m4);
    }
    pierPosts.instanceMatrix.needsUpdate = true;
    group.add(pierPosts);
    // two simple moored boats: hull + cabin
    [[-half - 40, -60, 0.5], [-half - 55, 110, -0.3]].forEach(function (bt) {
      var boat = new THREE.Group();
      var hull = new THREE.Mesh(
        new THREE.BoxGeometry(14, 2.2, 5),
        new THREE.MeshLambertMaterial({ color: 0xd8d3c8 })
      );
      hull.position.y = 0.6;
      boat.add(hull);
      var cabin = new THREE.Mesh(
        new THREE.BoxGeometry(6, 2.4, 4),
        new THREE.MeshLambertMaterial({ color: 0x2e6f8e })
      );
      cabin.position.set(-1, 2.6, 0);
      boat.add(cabin);
      boat.position.set(bt[0], -0.2, bt[1]);
      boat.rotation.y = bt[2];
      group.add(boat);
    });

    // ---- Dusk sky dome, low sun, and a few pink clouds ----
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.MeshBasicMaterial({
        map: makeSkyTexture(),
        side: THREE.BackSide,
        fog: false,
      })
    );
    group.add(sky);
    var sun = new THREE.Mesh(
      new THREE.CircleGeometry(34, 32),
      new THREE.MeshBasicMaterial({ color: cfg.sunColor, fog: false })
    );
    sun.position.set(-720, 66, -140);
    sun.lookAt(0, 40, 0);
    group.add(sun);
    var cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffb3a0, transparent: true, opacity: 0.5, fog: false,
    });
    for (var ci = 0; ci < 9; ci++) {
      var cl = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cloudMat);
      var ca = rng() * Math.PI * 2;
      var cr = 420 + rng() * 320;
      cl.position.set(Math.cos(ca) * cr, 150 + rng() * 90, Math.sin(ca) * cr);
      cl.scale.set(60 + rng() * 70, 9 + rng() * 8, 26 + rng() * 22);
      group.add(cl);
    }

    // ---- Spawn points and the data other modules need ----
    var spawn = { x: centers[5] + 4, y: 0, z: centers[5] + 4 };
    return {
      group: group,
      spawn: spawn,
      roads: roads,
      colliders: colliders,
      bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
      lampCount: lampSpots.length,
    };
  }

  global.createWorld = createWorld;
})(typeof window !== 'undefined' ? window : globalThis);
