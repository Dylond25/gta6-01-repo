// Meridian Bay — renderer and camera.
// createRenderer(canvas) owns the WebGL renderer, the scene, the dusk
// lighting and the third-person camera. It draws `state` every frame and
// keeps the player mesh glued to state.player, so the other modules never
// touch three.js directly.
(function (global) {
  'use strict';

  // Rio Kestrel, on foot: bright jacket so the player reads at a glance
  // against the dusk city, dark trousers, simple blocky build.
  function makePlayerMesh() {
    var p = new THREE.Group();
    p.name = 'rio-kestrel';
    var jacket = new THREE.MeshLambertMaterial({ color: 0x12b5a5 });
    var dark = new THREE.MeshLambertMaterial({ color: 0x23262e });
    var skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), jacket);
    torso.position.y = 1.12;
    p.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
    head.position.y = 1.68;
    p.add(head);
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshLambertMaterial({ color: 0x1a1210 })
    );
    hair.position.y = 1.72;
    p.add(hair);
    var legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.26), dark);
    legL.position.set(-0.16, 0.39, 0);
    p.add(legL);
    var legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.26), dark);
    legR.position.set(0.16, 0.39, 0);
    p.add(legR);
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.22), jacket);
    armL.position.set(-0.42, 1.12, 0);
    p.add(armL);
    var armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.22), jacket);
    armR.position.set(0.42, 1.12, 0);
    p.add(armR);
    // a soft blob shadow so the player grounds visually on the street
    var blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    p.add(blob);
    return p;
  }

  function createRenderer(canvas) {
    var cfg = global.MB_CONFIG;
    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(cfg.fogColor, cfg.fogNear, cfg.fogFar);

    var camera = new THREE.PerspectiveCamera(
      62, window.innerWidth / window.innerHeight, 0.1, 2000
    );

    // Dusk lighting: a violet sky wash, a low warm sun from the west
    // (over the harbour), and a faint ambient so shadows never go black.
    var hemi = new THREE.HemisphereLight(0x8a6ab0, 0x3a2f22, 1.25);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xff9a3c, 1.8);
    sun.position.set(-220, 90, -60);
    scene.add(sun);
    var amb = new THREE.AmbientLight(0x50405e, 0.95);
    scene.add(amb);

    var playerMesh = makePlayerMesh();
    scene.add(playerMesh);

    // Smoothed camera state, so the follow never snaps.
    var camPos = new THREE.Vector3(0, 8, 14);
    var camLook = new THREE.Vector3(0, 1, 0);

    function resize() {
      var w = window.innerWidth;
      var h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', resize);

    // Draw one frame from `state`. The camera orbits behind the player on
    // the yaw/pitch input supplies, pulls back while driving, and eases
    // toward its target so fast turns feel smooth instead of snappy.
    function render(state, dt) {
      var cfg = global.MB_CONFIG;
      var pl = state.player;
      var cam = state.camera;

      // player mesh follows the body
      playerMesh.position.set(pl.x, pl.y, pl.z);
      playerMesh.rotation.y = pl.heading;
      // simple walk bob: legs swing while moving on foot
      var moving = Math.hypot(pl.vx || 0, pl.vz || 0) > 0.5 && pl.onFoot;
      var t = (state.time.elapsed || 0) * 10;
      playerMesh.children[3].rotation.x = moving ? Math.sin(t) * 0.55 : 0;
      playerMesh.children[4].rotation.x = moving ? -Math.sin(t) * 0.55 : 0;
      playerMesh.children[5].rotation.x = moving ? -Math.sin(t) * 0.4 : 0;
      playerMesh.children[6].rotation.x = moving ? Math.sin(t) * 0.4 : 0;
      playerMesh.visible = true;

      // camera target: behind the player at cam.yaw, above at cam.pitch
      var dist = pl.inVehicle ? cfg.camDriveDistance : cfg.camDistance;
      var height = pl.inVehicle ? cfg.camDriveHeight : cfg.camHeight;
      var cy = cam.yaw;
      var cp = cam.pitch;
      var tx = pl.x - Math.sin(cy) * Math.cos(cp) * dist;
      var tz = pl.z - Math.cos(cy) * Math.cos(cp) * dist;
      var ty = pl.y + height + Math.sin(cp) * dist * 0.6;
      // keep the camera out of the ground and inside the city
      if (ty < 1.2) ty = 1.2;
      var k = 1 - Math.exp(-dt * 10);
      camPos.x += (tx - camPos.x) * k;
      camPos.y += (ty - camPos.y) * k;
      camPos.z += (tz - camPos.z) * k;
      camera.position.copy(camPos);
      var lx = pl.x + Math.sin(cy) * 4;
      var lz = pl.z + Math.cos(cy) * 4;
      camLook.x += (lx - camLook.x) * k;
      camLook.y += ((pl.y + 1.6) - camLook.y) * k;
      camLook.z += (lz - camLook.z) * k;
      camera.lookAt(camLook);

      renderer.render(scene, camera);
    }

    return {
      scene: scene,
      camera: camera,
      renderer: renderer,
      render: render,
      resize: resize,
      playerMesh: playerMesh,
    };
  }

  global.createRenderer = createRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
