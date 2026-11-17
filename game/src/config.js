// Meridian Bay — game configuration.
// All tuning constants for the core world live here, so the other modules
// (vehicles, traffic, police, missions, HUD, audio) read one shared source
// of truth instead of hard-coding their own numbers.
(function (global) {
  'use strict';

  var MB_CONFIG = {
    // ---- City layout (metres) ----
    // A grid of square blocks separated by streets. The city is centred on
    // the origin; the harbour sea lies to the west (negative x).
    blocksPerSide: 10,
    blockSize: 36,
    streetWidth: 14,
    // Derived: pitch = blockSize + streetWidth = 50; city half-extent 257.
    // Street centre lines sit at -250, -200, ..., 250 on both axes.

    // ---- Dusk palette ----
    skyTop: 0x2b1a4a,       // deep violet, high in the sky
    skyHorizon: 0xff9a3c,   // burnt orange at the horizon
    sunColor: 0xffb347,     // low sun disc
    fogColor: 0x8a5a7a,     // hazy mauve fog between the towers
    fogNear: 160,
    fogFar: 720,
    groundColor: 0x4a4f5c,  // sidewalk / plaza grey
    roadColor: 0x2e323c,    // asphalt
    seaColor: 0x1d4e6b,     // harbour water, dusk blue
    lampColor: 0xffc46b,    // street-lamp glow

    // ---- Buildings ----
    buildingMinHeight: 12,
    buildingMaxHeight: 72,
    buildingColors: [
      0x8a7f8d, 0x6f7d8c, 0x9c8a7a, 0x7a6f7d,
      0x5d6b7a, 0x8c7a6f, 0x746a80, 0x6b7a6f
    ],

    // ---- Player (Rio Kestrel, on foot) ----
    walkSpeed: 6,           // m/s
    runSpeed: 10,           // m/s while Shift is held
    jumpSpeed: 8,           // m/s initial upward velocity
    gravity: 22,            // m/s^2
    playerRadius: 0.55,     // collision cylinder radius
    playerHeight: 1.8,
    playerHealth: 100,
    startMoney: 250,

    // ---- Camera (third person) ----
    camDistance: 9,
    camHeight: 3.6,
    camDriveDistance: 12,
    camDriveHeight: 4.6,
    camPitchMin: -0.15,
    camPitchMax: 0.55,

    // ---- Wanted ----
    maxWanted: 5,
    wantedCooldown: 20,     // seconds hidden before stars start dropping

    // ---- Game loop ----
    fixedDt: 1 / 60,
    maxFrameDt: 0.1,
  };

  // Derived layout numbers, computed once so world.js and the gameplay
  // modules agree on exactly where streets and blocks are.
  MB_CONFIG.pitch = MB_CONFIG.blockSize + MB_CONFIG.streetWidth;
  MB_CONFIG.cityHalf =
    (MB_CONFIG.blocksPerSide * MB_CONFIG.pitch + MB_CONFIG.streetWidth) / 2;
  MB_CONFIG.streetCenters = [];
  for (var i = 0; i <= MB_CONFIG.blocksPerSide; i++) {
    MB_CONFIG.streetCenters.push(
      -MB_CONFIG.cityHalf + MB_CONFIG.streetWidth / 2 + i * MB_CONFIG.pitch
    );
  }

  global.MB_CONFIG = MB_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
