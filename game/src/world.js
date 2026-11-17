// Meridian Bay — dunia: kota 3D prosedural di senja pelabuhan.
// createWorld() membangun jalan, trotoar, gedung, lampu, laut,
// dermaga, langit, lalu mengembalikan spawn + jalan + collider.
// Deterministik: seed tetap, kota yang sama di setiap load.
'use strict';

function createWorld() {
  const C = MB_CONFIG;
  const THREE = window.THREE;
  const rand = mbRandom(20261117);
  const group = new THREE.Group();

  const pitch = C.blockSize + C.roadWidth;      // jarak antar pusat blok
  const half = (C.blocks * pitch + C.roadWidth) / 2; // setengah lebar kota
  const colliders = [];
  const roads = [];

  // ---- Tekstur jendela gedung (4 varian, digambar di canvas) ----
  function windowTexture(variant) {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = ['#2b2f3a', '#332f3d', '#262b33', '#3a2f33'][variant];
    g.fillRect(0, 0, 128, 256);
    const litRatio = [0.42, 0.55, 0.34, 0.62][variant];
    for (let y = 8; y < 248; y += 16) {
      for (let x = 8; x < 120; x += 14) {
        if (rand() < litRatio) {
          g.fillStyle = rand() < 0.75 ? '#ffc46b' : '#9fd8ff';
          g.globalAlpha = 0.65 + rand() * 0.35;
        } else {
          g.fillStyle = '#101018';
          g.globalAlpha = 1;
        }
        g.fillRect(x, y, 9, 11);
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const winTex = [windowTexture(0), windowTexture(1), windowTexture(2), windowTexture(3)];

  // ---- Langit gradien senja (kubah besar, sisi dalam) ----
  function skyTexture() {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, C.colors.skyTop);
    grad.addColorStop(0.45, C.colors.skyMid);
    grad.addColorStop(0.78, C.colors.skyHorizon);
    grad.addColorStop(1.0, '#ff9a4d');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---- Tanah dasar (trotoar) + jalan + marka ----
  const groundMat = new THREE.MeshLambertMaterial({ color: C.colors.sidewalk });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 260, half * 2 + 260), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  group.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: C.colors.road });
  const centerMat = new THREE.MeshBasicMaterial({ color: C.colors.lineCenter });
  const edgeMat = new THREE.MeshBasicMaterial({ color: C.colors.lineEdge });

  // Jalan membujur (sejajar sumbu X) dan melintang (sejajar sumbu Z).
  for (let i = 0; i <= C.blocks; i++) {
    const c = -half + C.roadWidth / 2 + i * pitch; // pusat jalan ke-i
    // Strip aspal X dan Z.
    const rx = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, C.roadWidth), roadMat);
    rx.rotation.x = -Math.PI / 2;
    rx.position.set(0, 0.02, c);
    group.add(rx);
    const rz = new THREE.Mesh(new THREE.PlaneGeometry(C.roadWidth, half * 2), roadMat);
    rz.rotation.x = -Math.PI / 2;
    rz.position.set(c, 0.03, 0);
    group.add(rz);
    roads.push({ axis: 'x', at: c });
    roads.push({ axis: 'z', at: c });

    // Garis tengah putus-putus (kuning) di sepanjang jalan X.
    for (let d = -half + 6; d < half - 6; d += 9) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.35), centerMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(d, 0.05, c);
      group.add(dash);
      const dashZ = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 4.5), centerMat);
      dashZ.rotation.x = -Math.PI / 2;
      dashZ.position.set(c, 0.05, d);
      group.add(dashZ);
    }
    // Garis tepi putih di kedua sisi jalan X dan Z.
    for (const off of [-C.roadWidth / 2 + 0.5, C.roadWidth / 2 - 0.5]) {
      const e1 = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.22), edgeMat);
      e1.rotation.x = -Math.PI / 2;
      e1.position.set(0, 0.05, c + off);
      group.add(e1);
      const e2 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, half * 2), edgeMat);
      e2.rotation.x = -Math.PI / 2;
      e2.position.set(c + off, 0.05, 0);
      group.add(e2);
    }
  }

  // ---- Blok trotoar (alas gedung, sedikit terangkat) ----
  const blockMat = new THREE.MeshLambertMaterial({ color: '#4a4a55' });
  for (let bx = 0; bx < C.blocks; bx++) {
    for (let bz = 0; bz < C.blocks; bz++) {
      const cx = -half + C.roadWidth + C.blockSize / 2 + bx * pitch;
      const cz = -half + C.roadWidth + C.blockSize / 2 + bz * pitch;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(C.blockSize, C.blockTop, C.blockSize), blockMat);
      slab.position.set(cx, C.blockTop / 2, cz);
      group.add(slab);
    }
  }

  // ---- Gedung menara (satu atau dua per blok, tinggi bervariasi) ----
  for (let bx = 0; bx < C.blocks; bx++) {
    for (let bz = 0; bz < C.blocks; bz++) {
      const cx = -half + C.roadWidth + C.blockSize / 2 + bx * pitch;
      const cz = -half + C.roadWidth + C.blockSize / 2 + bz * pitch;
      // Menara lebih tinggi di dekat pusat kota.
      const distC = Math.max(Math.abs(cx), Math.abs(cz)) / half;
      const hBase = mbLerp(C.maxBuildingH, C.minBuildingH, distC);
      const n = rand() < 0.55 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const w = 12 + rand() * 10;
        const d = 12 + rand() * 10;
        const h = hBase * (0.55 + rand() * 0.7);
        const ox = n === 1 ? 0 : (k === 0 ? -8 : 8);
        const oz = n === 1 ? 0 : (k === 0 ? 7 : -7);
        const tex = winTex[(bx * 7 + bz * 3 + k) % 4];
        const mat = new THREE.MeshLambertMaterial({
          map: tex,
          color: 0xaab0c0,
          emissive: 0xffc46b,
          emissiveMap: tex,
          emissiveIntensity: 0.55,
        });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        tower.position.set(cx + ox, C.blockTop + h / 2, cz + oz);
        group.add(tower);
        colliders.push({
          minX: cx + ox - w / 2, maxX: cx + ox + w / 2,
          minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2,
        });
        // Atap: kotak kecil (AC / heliport) supaya siluet tidak polos.
        if (rand() < 0.6) {
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.3, 2.2, d * 0.3),
            new THREE.MeshLambertMaterial({ color: 0x22222c }));
          roof.position.set(cx + ox, C.blockTop + h + 1.1, cz + oz);
          group.add(roof);
        }
      }
    }
  }

  // ---- Lampu jalan di tiap persimpangan ----
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
  const headMat = new THREE.MeshBasicMaterial({ color: C.colors.lampHead });
  for (let i = 0; i <= C.blocks; i++) {
    for (let j = 0; j <= C.blocks; j++) {
      const x = -half + C.roadWidth / 2 + i * pitch;
      const z = -half + C.roadWidth / 2 + j * pitch;
      const px = x + C.roadWidth / 2 + 0.8;
      const pz = z + C.roadWidth / 2 + 0.8;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), poleMat);
      pole.position.set(px, 2.7, pz);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), headMat);
      head.position.set(px, 5.5, pz);
      group.add(head);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), poleMat);
      arm.position.set(px - 0.5, 5.35, pz);
      group.add(arm);
    }
  }

  // ---- Laut + dermaga + perahu di sisi barat ----
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(300, half * 2 + 260),
    new THREE.MeshLambertMaterial({ color: C.colors.sea, emissive: 0x0a2036 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-half - 150 + 4, 0.06, 0);
  group.add(sea);

  const pierMat = new THREE.MeshLambertMaterial({ color: C.colors.pier });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(90, 0.5, 14), pierMat);
  pier.position.set(-half - 40, 0.3, 30);
  group.add(pier);
  for (let p = 0; p < 6; p++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 6), pierMat);
    post.position.set(-half - 78 + p * 15, 0.1, 30 + (p % 2 === 0 ? 6 : -6));
    group.add(post);
  }
  // Dua perahu sederhana.
  const boatCols = [0xd8d8d8, 0xc23b2e];
  for (let b = 0; b < 2; b++) {
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(14, 1.6, 4.5),
      new THREE.MeshLambertMaterial({ color: boatCols[b] }));
    hull.position.set(-half - 60 - b * 35, 0.7, -40 + b * 55);
    group.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(5, 2.2, 3.4),
      new THREE.MeshLambertMaterial({ color: 0x2a2f3a }));
    cabin.position.set(-half - 60 - b * 35, 2.4, -40 + b * 55);
    group.add(cabin);
  }

  // ---- Kubah langit + matahari rendah + awan ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(950, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  group.add(sky);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(46, 32),
    new THREE.MeshBasicMaterial({ color: C.colors.sun, fog: false }));
  sun.position.set(-820, 95, -180);
  sun.lookAt(0, 40, 0);
  group.add(sun);

  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffc9a3, transparent: true, opacity: 0.35, fog: false });
  for (let c = 0; c < 9; c++) {
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(150 + rand() * 130, 22 + rand() * 16), cloudMat);
    const ang = rand() * Math.PI * 2;
    const r = 620 + rand() * 200;
    cl.position.set(Math.cos(ang) * r, 210 + rand() * 130, Math.sin(ang) * r);
    cl.lookAt(0, 150, 0);
    group.add(cl);
  }

  const spawn = { x: 0, z: C.roadWidth / 2 + pitch * 0.5, yaw: Math.PI };
  return {
    group: group,
    spawn: spawn,
    roads: roads,
    colliders: colliders,
    bounds: half + 130,
    seaX: -half,
  };
}
