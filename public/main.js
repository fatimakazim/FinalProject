/* =========================================================
   Study Until the Ice Melts — main.js
   Three.js r128 — fully self-contained

   FIXES:
   1. [ICE SOUND]    audio-ice element now reliably plays via
                     AudioContext + HTMLAudioElement fallback
   2. [LOCAL AUDIO]  cafe.mp3 + white.mp3 served from assets/
   3. [ONBOARDING]   enterTimer() navigates to the timer screen
   4. [MODES]        Pomodoro & DeepWork auto-populate ice cubes
   5. [MOBILE UI]    Mode bar absolute positioning + safe area
   ========================================================= */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────── */
  var GLASS_R        = 0.52;
  var GLASS_H        = 1.4;
  var GLASS_W        = 0.045;
  var INNER_R        = GLASS_R - GLASS_W - 0.025;
  var FLOOR_Y        = -(GLASS_H / 2) + 0.09;
  var WATER_MAX      = GLASS_H * 0.70;
  var CUBE_HS        = 0.082;
  var MAX_CUBES      = 8;
  var MELT_SECS_BASE = 240;   // 4 minutes per cube at room temp
  var GRAVITY        = -5.8;
  var RESTITUT       = 0.06;
  var DAMPING        = 5.5;
  var BG_COL         = 0x060e1a;

  /* ── State ─────────────────────────────────────────────── */
  var scene, camera, renderer, clock;
  var waterMesh, waterSurface;
  var iceCubes   = [];
  var meltedCnt  = 0;
  var running    = false;
  var elapsed    = 0;
  var lastClink  = 0;
  var audioCtx   = null;
  var envMap     = null;

  /* ── Mode state ─────────────────────────────────────────── */
  var currentMode       = 'ice';   // 'ice' | 'pomodoro' | 'deepwork'
  var deepWorkMins      = 60;
  var fixedTimerTarget  = 0;       // seconds
  var fixedTimerRunning = false;
  var sessionCompleted  = false;
  var temperatureLevel  = 3;       // 1–5; default room temp
  var meltSecs          = MELT_SECS_BASE;

  /* ── Ambient audio state ────────────────────────────────── */
  var currentSound = 'none';
  var audioNodes   = {};

  /* ── Audio unlocked flag ────────────────────────────────── */
  var audioUnlocked = false;

  /* ── Mode descriptions ──────────────────────────────────── */
  var MODE_HINTS = {
    ice:      'Your session lasts as long as the ice takes to melt',
    pomodoro: '25-minute focused work session — classic Pomodoro',
    deepwork: 'Extended deep work — choose your duration below'
  };

  /* ── Temperature labels & multipliers ──────────────────── */
  var TEMP_LABELS = [
    '',
    'Freezing — very slow melt (×0.4)',
    'Cold — slow melt (×0.65)',
    'Room temp — normal melt (×1.0)',
    'Warm — faster melt (×1.5)',
    'Hot — rapid melt (×2.5)'
  ];
  var TEMP_MULT = [1, 0.4, 0.65, 1.0, 1.5, 2.5];

  /* ── Three.js boot flag ─────────────────────────────────── */
  var threeInitialised = false;

  /* ══════════════════════════════════════════════════════════
     AUDIO UNLOCK
     Browsers require a user gesture before any audio plays.
     We unlock on the very first tap (dismissSplash).
  ══════════════════════════════════════════════════════════ */
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    // Create / resume AudioContext
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (e) {}

    // Prime every audio element by playing + immediately pausing.
    // This is the key trick that lets them fire later without a gesture.
    var ids = ['audio-ice', 'audio-rain', 'audio-cafe', 'audio-white'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.volume = 0;
      var p = el.play();
      if (p && p.then) {
        p.then(function () {
          el.pause();
          el.currentTime = 0;
          el.volume = 1;
        }).catch(function () {
          el.volume = 1;
        });
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
     SCREEN NAVIGATION
  ══════════════════════════════════════════════════════════ */

  /**
   * Called when user taps the splash screen.
   * Unlocks audio, hides splash → shows onboarding.
   */
  window.dismissSplash = function () {
    unlockAudio();   // ← must happen on direct user gesture

    var splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(function () { splash.remove(); }, 1000);
    }

    var ob = document.getElementById('onboarding-screen');
    if (ob) ob.classList.remove('hidden');
  };

  /**
   * Called when user clicks "I Understand" on onboarding.
   * Hides onboarding → shows timer screen → boots Three.js once.
   */
  window.enterTimer = function () {
    unlockAudio();   // secondary unlock in case user skips quickly

    var ob = document.getElementById('onboarding-screen');
    if (ob) {
      ob.style.opacity    = '0';
      ob.style.transition = 'opacity 0.5s';
      setTimeout(function () {
        ob.classList.add('hidden');
        ob.style.opacity = '';
      }, 500);
    }

    var ts = document.getElementById('timer-screen');
    if (ts) ts.classList.remove('hidden');

    if (!threeInitialised) {
      threeInitialised = true;
      bootThree();
    }
  };

  /* ══════════════════════════════════════════════════════════
     THREE.JS INITIALISATION
  ══════════════════════════════════════════════════════════ */
  function bootThree() {
    var canvas = document.getElementById('canvas');

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping             = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure     = 1.65;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COL);
    scene.fog = new THREE.FogExp2(BG_COL, 0.14);

    camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 40);
    camera.position.set(0, 1.2, 4.2);
    camera.lookAt(0, -0.1, 0);

    clock = new THREE.Clock();

    buildEnv();
    buildLights();
    buildGlass();
    buildWater();
    buildTable();

    // Cache audio elements
    audioNodes = {
      rain:  document.getElementById('audio-rain'),
      cafe:  document.getElementById('audio-cafe'),
      white: document.getElementById('audio-white')
    };

    applyModeUI();
    updateModeHint();
    window.setTemperature(temperatureLevel);

    var slider = document.getElementById('temp-slider');
    if (slider) slider.value = temperatureLevel;

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    loop();
  }

  /* ══════════════════════════════════════════════════════════
     ENV MAP
  ══════════════════════════════════════════════════════════ */
  function buildEnv() {
    var sz = 128;
    var px = new Uint8Array(sz * sz * 3);
    for (var y = 0; y < sz; y++) {
      for (var x = 0; x < sz; x++) {
        var t   = y / (sz - 1);
        var n   = (Math.sin(x * 0.25 + y * 0.1) * 0.5 + 0.5) * 14;
        var idx = (y * sz + x) * 3;
        px[idx]     = Math.min(255, Math.floor(6  + t * 58  + n * 0.3));
        px[idx + 1] = Math.min(255, Math.floor(14 + t * 85  + n * 0.5));
        px[idx + 2] = Math.min(255, Math.floor(38 + t * 148 + n));
      }
    }
    var tex = new THREE.DataTexture(px, sz, sz, THREE.RGBFormat);
    tex.needsUpdate = true;

    var cubeRT  = new THREE.WebGLCubeRenderTarget(256);
    var cubeCam = new THREE.CubeCamera(0.1, 30, cubeRT);
    scene.add(cubeCam);
    envMap = cubeRT.texture;
    envMap.encoding = THREE.sRGBEncoding;

    setTimeout(function () {
      cubeCam.update(renderer, scene);
      scene.environment = envMap;
    }, 200);
  }

  /* ── Lights ─────────────────────────────────────────────── */
  function buildLights() {
    scene.add(new THREE.AmbientLight(0x6888aa, 1.2));

    var key = new THREE.DirectionalLight(0xd0e8ff, 3.4);
    key.position.set(-2.2, 5, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.width  = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.left   = -2.5;
    key.shadow.camera.right  =  2.5;
    key.shadow.camera.top    =  2.5;
    key.shadow.camera.bottom = -2.5;
    key.shadow.camera.near   = 0.5;
    key.shadow.camera.far    = 14;
    key.shadow.radius = 5;
    key.shadow.bias   = -0.0004;
    scene.add(key);

    var top = new THREE.DirectionalLight(0xc0dcf8, 1.9);
    top.position.set(0.2, 7, 0.3);
    scene.add(top);

    var rim1 = new THREE.DirectionalLight(0x80b8e4, 2.6);
    rim1.position.set(0.6, 2, -4);
    scene.add(rim1);

    var rim2 = new THREE.DirectionalLight(0x446688, 1.3);
    rim2.position.set(-1.8, 1, -3);
    scene.add(rim2);

    var fill = new THREE.DirectionalLight(0x8ab8d8, 0.85);
    fill.position.set(0, 0.5, 5);
    scene.add(fill);

    var glow = new THREE.PointLight(0x99d4ff, 2.4, 2.1);
    glow.position.set(0, 0.0, 0);
    scene.add(glow);

    var bounce = new THREE.PointLight(0x1a3c5c, 1.5, 5);
    bounce.position.set(0, -2.0, 0.6);
    scene.add(bounce);
  }

  /* ── Glass ──────────────────────────────────────────────── */
  function buildGlass() {
    var R = GLASS_R, H = GLASS_H, W = GLASS_W;

    function gm(opts) {
      var base = {
        metalness: 0,
        envMap: envMap,
        envMapIntensity: 3.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
      };
      Object.keys(opts).forEach(function (k) { base[k] = opts[k]; });
      return new THREE.MeshPhysicalMaterial(base);
    }

    var shellGeo = new THREE.CylinderGeometry(R, R * 0.84, H, 64, 1, true);
    var shellMat = gm({
      color: 0xd8eeff, roughness: 0.03, reflectivity: 0.96,
      transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    });
    var shell = new THREE.Mesh(shellGeo, shellMat);
    shell.castShadow = true;
    scene.add(shell);

    var botGeo = new THREE.CylinderGeometry(R * 0.83 - W, R * 0.83 - W, 0.07, 64);
    var botMat = gm({
      color: 0xc8e4ff, roughness: 0.02, reflectivity: 0.95,
      transparent: true, opacity: 0.28,
    });
    var bot = new THREE.Mesh(botGeo, botMat);
    bot.position.y = -H / 2 + 0.035;
    bot.castShadow = true;
    scene.add(bot);

    var rimGeo = new THREE.TorusGeometry(R, W * 0.7, 12, 64);
    var rimMat = gm({
      color: 0xeef8ff, roughness: 0.05, metalness: 0.06, reflectivity: 0.98,
      transparent: true, opacity: 0.88, clearcoatRoughness: 0.02,
    });
    var rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = H / 2;
    rimMesh.rotation.x = Math.PI / 2;
    scene.add(rimMesh);

    var innerGeo = new THREE.CylinderGeometry(R - W - 0.01, (R - W - 0.01) * 0.98, H * 0.98, 64, 1, true);
    var innerMat = gm({
      color: 0xffffff, roughness: 0.0, reflectivity: 1.0,
      transparent: true, opacity: 0.08, side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(innerGeo, innerMat));
  }

  /* ── Water ──────────────────────────────────────────────── */
  function buildWater() {
    var R = INNER_R - 0.01;

    var wGeo = new THREE.CylinderGeometry(R, R * 0.93, 1.0, 48);
    var wMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a5a90, roughness: 0.0, metalness: 0.08,
      transparent: true, opacity: 0.62,
      envMap: envMap, envMapIntensity: 1.8, reflectivity: 0.82,
    });
    waterMesh = new THREE.Mesh(wGeo, wMat);
    waterMesh.position.y = FLOOR_Y;
    waterMesh.scale.y    = 0.001;
    scene.add(waterMesh);

    var sGeo = new THREE.CircleGeometry(R, 48);
    var sMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a7fc8, roughness: 0.04, metalness: 0.14,
      transparent: true, opacity: 0.68,
      envMap: envMap, envMapIntensity: 2.4, reflectivity: 0.92,
      side: THREE.DoubleSide,
    });
    waterSurface = new THREE.Mesh(sGeo, sMat);
    waterSurface.rotation.x = -Math.PI / 2;
    waterSurface.position.y = FLOOR_Y;
    scene.add(waterSurface);
  }

  /* ── Table ──────────────────────────────────────────────── */
  function buildTable() {
    var geo = new THREE.PlaneGeometry(16, 16);
    var mat = new THREE.MeshStandardMaterial({ color: 0x07111e, roughness: 0.93, metalness: 0 });
    var plane = new THREE.Mesh(geo, mat);
    plane.rotation.x    = -Math.PI / 2;
    plane.position.y    = -GLASS_H / 2 - 0.02;
    plane.receiveShadow = true;
    scene.add(plane);

    var dGeo = new THREE.CircleGeometry(0.65, 32);
    var dMat = new THREE.MeshBasicMaterial({ color: 0x1a3850, transparent: true, opacity: 0.30 });
    var disc = new THREE.Mesh(dGeo, dMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -GLASS_H / 2 - 0.015;
    scene.add(disc);
  }

  /* ══════════════════════════════════════════════════════════
     ICE SOUND EFFECT
     Uses the <audio id="audio-ice"> element that was pre-primed
     on the first user gesture. Works on iOS, Android & desktop.
  ══════════════════════════════════════════════════════════ */
  function playClink() {
    var now = Date.now();
    if (now - lastClink < 180) return;   // throttle
    lastClink = now;

    // Resume AudioContext if it got suspended (e.g. tab backgrounded)
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    var el = document.getElementById('audio-ice');
    if (!el) return;

    try {
      // Rewind so it can replay immediately even if still playing
      el.currentTime = 0;

      // Slight randomisation for realism
      el.volume        = 0.50 + Math.random() * 0.20;
      el.playbackRate  = 0.94 + Math.random() * 0.12;

      var p = el.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      // fail silently
    }
  }

  /* ══════════════════════════════════════════════════════════
     ICE CUBE FACTORY
  ══════════════════════════════════════════════════════════ */
  function createIceCube() {
    var jit = 0.85 + Math.random() * 0.30;
    var w   = CUBE_HS * 2 * jit;
    var h   = CUBE_HS * 2 * (0.85 + Math.random() * 0.30);
    var d   = CUBE_HS * 2 * (0.85 + Math.random() * 0.30);

    var geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
    var pa  = geo.attributes.position;
    for (var i = 0; i < pa.count; i++) {
      pa.setXYZ(i,
        pa.getX(i) + (Math.random() - 0.5) * 0.009,
        pa.getY(i) + (Math.random() - 0.5) * 0.009,
        pa.getZ(i) + (Math.random() - 0.5) * 0.009
      );
    }
    pa.needsUpdate = true;
    geo.computeVertexNormals();

    var hue = 0.56 + (Math.random() - 0.5) * 0.06;
    var mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setHSL(hue, 0.28, 0.90),
      roughness: 0.08 + Math.random() * 0.14,
      metalness: 0.0,
      reflectivity: 0.90,
      clearcoat: 1.0,
      clearcoatRoughness: 0.10,
      transparent: true,
      opacity: 0.82,
      envMap: envMap,
      envMapIntensity: 2.8,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;

    var spawnR = INNER_R * 0.55;
    var angle  = Math.random() * Math.PI * 2;
    var r      = Math.random() * spawnR;
    mesh.position.set(
      Math.cos(angle) * r,
      GLASS_H / 2 + CUBE_HS + 0.12,
      Math.sin(angle) * r
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    var cube = {
      mesh:    mesh,
      vy:      -1.2 - Math.random() * 0.4,
      vx:      (Math.random() - 0.5) * 0.35,
      vz:      (Math.random() - 0.5) * 0.35,
      vRot:    new THREE.Vector3(
        (Math.random() - 0.5) * 1.0,
        (Math.random() - 0.5) * 1.0,
        (Math.random() - 0.5) * 1.0
      ),
      settled: false,
      age:     0,
      meltAge: 0,
      hs:      CUBE_HS,
    };

    scene.add(mesh);
    iceCubes.push(cube);
    playClink();
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC API — ICE MODE
  ══════════════════════════════════════════════════════════ */

  window.addIce = function () {
    if (currentMode !== 'ice') return;
    if (iceCubes.length >= MAX_CUBES) return;
    createIceCube();
    running          = true;
    sessionCompleted = false;
    redrawUI();
  };

  window.resetScene = function () {
    fixedTimerRunning = false;
    fixedTimerTarget  = 0;
    sessionCompleted  = false;

    iceCubes.forEach(function (c) { if (scene) scene.remove(c.mesh); });
    iceCubes  = [];
    meltedCnt = 0;
    running   = false;
    elapsed   = 0;

    if (waterMesh)    { waterMesh.scale.y = 0.001; waterMesh.position.y = FLOOR_Y; }
    if (waterSurface) { waterSurface.position.y = FLOOR_Y; }

    stopAllAmbient();
    redrawUI();

    var h = document.getElementById('hint');
    if (h) h.style.opacity = '1';

    var sb = document.getElementById('btn-start');
    if (sb) { sb.style.opacity = ''; sb.style.pointerEvents = ''; }
  };

  /* ══════════════════════════════════════════════════════════
     MODE SWITCHING
  ══════════════════════════════════════════════════════════ */
  window.setMode = function (mode) {
    if (currentMode === mode) return;
    window.resetScene();
    currentMode = mode;

    document.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    applyModeUI();
    updateModeHint();
  };

  function applyModeUI() {
    var isIce  = currentMode === 'ice';
    var isDW   = currentMode === 'deepwork';
    var isPomo = currentMode === 'pomodoro';

    setElVisible('btn-add',         isIce);
    setElVisible('btn-start',       isPomo || isDW);
    setElVisible('temp-control',    isIce);
    setElVisible('deepwork-picker', isDW);
    setElVisible('ice-status',      isIce);

    var lb = document.getElementById('timer-label');
    if (lb) lb.textContent = isIce ? 'elapsed' : 'remaining';

    var hint = document.getElementById('hint');
    if (hint) {
      if (isIce)  hint.textContent = 'Add ice cubes to start your session';
      if (isPomo) hint.textContent = 'Press Start to begin your Pomodoro';
      if (isDW)   hint.textContent = 'Choose duration, then press Start';
      hint.style.opacity = '1';
    }

    var te = document.getElementById('timer');
    if (te) {
      if (isPomo)    te.textContent = '25:00';
      else if (isDW) te.textContent = pad(deepWorkMins) + ':00';
      else           te.textContent = '00:00';
    }
  }

  function updateModeHint() {
    var el = document.getElementById('mode-hint-text');
    if (el) el.textContent = MODE_HINTS[currentMode] || '';
  }

  /* ── Deep Work duration picker ──────────────────────────── */
  window.setDeepWorkDuration = function (mins) {
    deepWorkMins = mins;
    document.querySelectorAll('.dw-btn').forEach(function (btn) {
      btn.classList.toggle('active', parseInt(btn.dataset.mins) === mins);
    });
    var te = document.getElementById('timer');
    if (te && !fixedTimerRunning) te.textContent = pad(mins) + ':00';
  };

  /* ══════════════════════════════════════════════════════════
     START FIXED-MODE TIMER (Pomodoro / Deep Work)
  ══════════════════════════════════════════════════════════ */
  window.startFixedTimer = function () {
    if (fixedTimerRunning) return;

    var totalSecs     = currentMode === 'pomodoro' ? 25 * 60 : deepWorkMins * 60;
    fixedTimerTarget  = totalSecs;
    elapsed           = 0;
    fixedTimerRunning = true;
    sessionCompleted  = false;
    running           = true;

    var cubeCount = Math.min(MAX_CUBES, Math.max(1,
      Math.round(totalSecs / MELT_SECS_BASE)
    ));

    meltSecs = totalSecs;

    iceCubes.forEach(function (c) { if (scene) scene.remove(c.mesh); });
    iceCubes  = [];
    meltedCnt = 0;
    if (waterMesh)    { waterMesh.scale.y = 0.001; waterMesh.position.y = FLOOR_Y; }
    if (waterSurface) { waterSurface.position.y = FLOOR_Y; }

    for (var i = 0; i < cubeCount; i++) {
      (function (idx) {
        setTimeout(function () { createIceCube(); }, idx * 120);
      })(i);
    }

    playAmbient();

    var hint = document.getElementById('hint');
    if (hint) hint.style.opacity = '0';

    var sb = document.getElementById('btn-start');
    if (sb) { sb.style.opacity = '0.35'; sb.style.pointerEvents = 'none'; }
  };

  /* ── Temperature slider ─────────────────────────────────── */
  window.setTemperature = function (val) {
    temperatureLevel = parseInt(val);

    if (currentMode === 'ice') {
      meltSecs = MELT_SECS_BASE / TEMP_MULT[temperatureLevel];
    }

    var lbl = document.getElementById('temp-value-label');
    if (lbl) lbl.textContent = TEMP_LABELS[temperatureLevel];

    var tints = [
      '',
      'rgba(120,190,255,0.04)',
      'rgba(100,175,240,0.02)',
      'rgba(100,180,255,0.0)',
      'rgba(255,180,80,0.03)',
      'rgba(255,130,50,0.06)'
    ];
    document.documentElement.style.setProperty('--temp-tint', tints[temperatureLevel]);
  };

  /* ── Ambient sound ──────────────────────────────────────── */
  window.setSound = function (sound) {
    currentSound = sound;
    document.querySelectorAll('.sound-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.sound === sound);
    });
    stopAllAmbient();
    if (sound !== 'none' && running) playAmbient();
  };

  function playAmbient() {
    if (currentSound === 'none' || !audioNodes[currentSound]) return;
    var el = audioNodes[currentSound];
    el.volume = 0.35;
    var p = el.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stopAllAmbient() {
    ['rain', 'cafe', 'white'].forEach(function (k) {
      if (audioNodes[k]) {
        audioNodes[k].pause();
        audioNodes[k].currentTime = 0;
      }
    });
  }

  /* ── Session Summary ────────────────────────────────────── */
  function showSummary(completed) {
    sessionCompleted = completed;
    stopAllAmbient();

    var modeNames = { ice: 'Ice Melt', pomodoro: 'Pomodoro', deepwork: 'Deep Work' };
    var mm = Math.floor(elapsed / 60);
    var ss = Math.floor(elapsed % 60);

    var seEl    = document.getElementById('sum-mode');
    var stEl    = document.getElementById('sum-time');
    var ssEl    = document.getElementById('sum-status');
    var titleEl = document.getElementById('summary-title');

    if (seEl)    seEl.textContent    = modeNames[currentMode] || currentMode;
    if (stEl)    stEl.textContent    = pad(mm) + ':' + pad(ss);
    if (ssEl)    ssEl.textContent    = completed ? 'Completed ✓' : 'Stopped early';
    if (titleEl) titleEl.textContent = completed ? 'Well done'   : 'Session ended';

    var modal = document.getElementById('summary-modal');
    if (modal) modal.classList.remove('hidden');
  }

  window.startNewSession = function () {
    var modal = document.getElementById('summary-modal');
    if (modal) modal.classList.add('hidden');
    window.resetScene();
  };

  /* ══════════════════════════════════════════════════════════
     PHYSICS
  ══════════════════════════════════════════════════════════ */
  function physics(dt) {
    iceCubes.sort(function (a, b) { return a.mesh.position.y - b.mesh.position.y; });

    for (var i = 0; i < iceCubes.length; i++) {
      var c = iceCubes[i];
      if (c.settled) continue;

      var m  = c.mesh;
      var sc = m.scale.x;
      var hs = c.hs * sc;

      c.vy += GRAVITY * dt;
      m.position.x += c.vx * dt;
      m.position.y += c.vy * dt;
      m.position.z += c.vz * dt;

      var spin = Math.max(0, 1.0 - c.age / 3.5);
      m.rotation.x += c.vRot.x * dt * spin;
      m.rotation.y += c.vRot.y * dt * spin;
      m.rotation.z += c.vRot.z * dt * spin;

      var px   = m.position.x, pz = m.position.z;
      var pd   = Math.sqrt(px * px + pz * pz);
      var wallR = INNER_R - hs;
      if (wallR < 0) wallR = 0;

      if (pd > wallR && pd > 1e-5) {
        var nx = px / pd, nz = pz / pd;
        m.position.x = nx * wallR;
        m.position.z = nz * wallR;
        var vn = c.vx * nx + c.vz * nz;
        if (vn > 0) {
          c.vx -= (1 + RESTITUT) * vn * nx;
          c.vz -= (1 + RESTITUT) * vn * nz;
        }
        playClink();
      }

      var restY = FLOOR_Y + hs;

      for (var j = 0; j < i; j++) {
        var o  = iceCubes[j];
        var om = o.mesh;
        var os = o.hs * om.scale.x;

        var cx = m.position.x - om.position.x;
        var cy = m.position.y - om.position.y;
        var cz = m.position.z - om.position.z;
        var cd = Math.sqrt(cx * cx + cy * cy + cz * cz);
        var sep = (hs + os) * 0.98;

        if (cd < sep && cd > 1e-5) {
          var pen  = sep - cd;
          var nx2  = cx / cd, ny2 = cy / cd, nz2 = cz / cd;
          var push = o.settled ? 1.0 : 0.55;
          m.position.x += nx2 * pen * push;
          m.position.y += ny2 * pen * push;
          m.position.z += nz2 * pen * push;
          if (!o.settled) {
            om.position.x -= nx2 * pen * 0.45;
            om.position.y -= ny2 * pen * 0.45;
            om.position.z -= nz2 * pen * 0.45;
          }
          if (c.vy < -0.08 && ny2 > 0.3) {
            c.vy = Math.abs(c.vy) * RESTITUT;
            playClink();
          }
        }

        var xzd = Math.sqrt(cx * cx + cz * cz);
        if (xzd < (hs + os) * 0.72) {
          restY = Math.max(restY, om.position.y + os + hs);
        }
      }

      if (m.position.y < restY) {
        m.position.y = restY;
        if (c.vy < 0) {
          c.vy = -c.vy * RESTITUT;
          if (Math.abs(c.vy) < 0.04) c.vy = 0;
        }
        c.vx *= (1 - DAMPING * dt * 0.7);
        c.vz *= (1 - DAMPING * dt * 0.7);
      }

      var px2 = m.position.x, pz2 = m.position.z;
      var pd2 = Math.sqrt(px2 * px2 + pz2 * pz2);
      var wr2 = INNER_R - hs;
      if (wr2 < 0) wr2 = 0;
      if (pd2 > wr2 && pd2 > 1e-5) {
        m.position.x = (px2 / pd2) * wr2;
        m.position.z = (pz2 / pd2) * wr2;
      }

      var df = Math.max(0, 1 - DAMPING * dt);
      c.vx *= df; c.vz *= df;
      c.vRot.multiplyScalar(Math.max(0, 1 - 9 * dt));

      var speed = Math.abs(c.vx) + Math.abs(c.vy) + Math.abs(c.vz);
      if (m.position.y <= restY + 0.005 && speed < 0.08) {
        c.settled = true;
        c.vx = c.vy = c.vz = 0;
      }

      c.age += dt;
    }
  }

  /* ── Melt ───────────────────────────────────────────────── */
  function melt(dt) {
    if (!running || iceCubes.length === 0) return;

    var ms = meltSecs;

    for (var i = iceCubes.length - 1; i >= 0; i--) {
      var c = iceCubes[i];

      if (c.settled || currentMode !== 'ice') {
        c.meltAge += dt;
      }

      var frac  = Math.max(0, 1 - c.meltAge / ms);
      var scale = 0.04 + frac * 0.96;
      c.mesh.scale.setScalar(scale);
      c.mesh.material.opacity = 0.40 + frac * 0.42;

      if (frac <= 0) {
        scene.remove(c.mesh);
        iceCubes.splice(i, 1);
        meltedCnt++;
      }
    }

    var liveMelt = 0;
    iceCubes.forEach(function (c) { liveMelt += Math.min(1, c.meltAge / ms); });
    var totalMelt  = meltedCnt + liveMelt;
    var waterFrac  = Math.min(1, totalMelt / MAX_CUBES);
    var waterH     = Math.max(0.003, waterFrac * WATER_MAX);

    waterMesh.scale.y       = waterH;
    waterMesh.position.y    = FLOOR_Y + waterH / 2;
    waterSurface.position.y = FLOOR_Y + waterH;

    if (currentMode === 'ice' && iceCubes.length === 0 && meltedCnt > 0) {
      running = false;
      showSummary(true);
    }
  }

  /* ── Fixed timer tick ───────────────────────────────────── */
  function tickFixedTimer(dt) {
    if (!fixedTimerRunning) return;
    elapsed += dt;

    var remaining = Math.max(0, fixedTimerTarget - elapsed);
    var mm = Math.floor(remaining / 60);
    var ss = Math.floor(remaining % 60);
    var te = document.getElementById('timer');
    if (te) te.textContent = pad(mm) + ':' + pad(ss);

    if (remaining <= 0) {
      fixedTimerRunning = false;
      running           = false;
      showSummary(true);
    }
  }

  /* ── Water waves ────────────────────────────────────────── */
  function waveWater(t) {
    if (!waterSurface) return;
    var geo = waterSurface.geometry;
    var pa  = geo.attributes.position;
    for (var i = 0; i < pa.count; i++) {
      var x = pa.getX(i), z = pa.getZ(i);
      pa.setZ(i, Math.sin(x * 9 + t * 1.1) * 0.003 + Math.cos(z * 11 + t * 0.8) * 0.002);
    }
    pa.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /* ── Camera breathe ─────────────────────────────────────── */
  function breathe(t) {
    camera.position.x = Math.sin(t * 0.07) * 0.03;
    camera.position.y = 1.2 + Math.sin(t * 0.05) * 0.012;
    camera.lookAt(0, -0.1, 0);
  }

  /* ── UI redraw ──────────────────────────────────────────── */
  function redrawUI() {
    if (currentMode === 'ice') {
      var mm = Math.floor(elapsed / 60);
      var ss = Math.floor(elapsed % 60);
      var te = document.getElementById('timer');
      if (te) te.textContent = pad(mm) + ':' + pad(ss);

      var cnt = iceCubes.length;
      var lb  = document.getElementById('ice-count-label');
      if (lb) lb.textContent = cnt === 0 ? '0 cubes remaining'
        : cnt + ' cube' + (cnt !== 1 ? 's' : '') + ' remaining';

      var frac = 0;
      iceCubes.forEach(function (c) { frac += Math.max(0, 1 - c.meltAge / meltSecs); });
      var bar = document.getElementById('ice-bar');
      if (bar) bar.style.width = ((frac / MAX_CUBES) * 100) + '%';

      var hint = document.getElementById('hint');
      if (hint) hint.style.opacity = cnt > 0 ? '0' : '1';

      var btn = document.getElementById('btn-add');
      if (btn) {
        btn.style.opacity       = cnt >= MAX_CUBES ? '0.35' : '1';
        btn.style.pointerEvents = cnt >= MAX_CUBES ? 'none'  : 'all';
      }

      if (cnt > 0 && running) playAmbient();
    }
  }

  /* ── Helpers ────────────────────────────────────────────── */
  function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }

  function setElVisible(id, visible) {
    var el = document.getElementById(id);
    if (!el) return;
    if (visible) el.classList.remove('hidden');
    else         el.classList.add('hidden');
  }

  /* ── Main loop ──────────────────────────────────────────── */
  var uiTick = 0;
  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t  = clock.elapsedTime;

    physics(dt);
    melt(dt);

    if (currentMode === 'ice') {
      if (running) elapsed += dt;
    } else {
      tickFixedTimer(dt);
    }

    waveWater(t);
    breathe(t);

    uiTick += dt;
    if (uiTick > 0.1) { redrawUI(); uiTick = 0; }

    renderer.render(scene, camera);
  }

})();