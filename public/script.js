let userName = "";
let iceCubes = [];
let iceImg, gFront, gBack;
let iceInstance;

const MELT_TIME_MS = 720000; 
const INITIAL_SIZE = 90;

// --- 1. UI & NAVIGATION ---
window.addEventListener('DOMContentLoaded', () => {
  setupUI();
});

function setupUI() {
  // Matches your index.html: id="enter-hub-btn"
  const enterBtn = document.getElementById('enter-hub-btn');
  if (enterBtn) {
    enterBtn.onclick = () => {
      userName = document.getElementById('student-name').value || "STUDENT";
      document.getElementById('user-name-display').innerText = userName.toUpperCase();
      showScreen('dashboard');
    };
  }

  // Matches your index.html: id="ice-timer-btn"
  const timerBtn = document.getElementById('ice-timer-btn');
  if (timerBtn) {
    timerBtn.onclick = () => {
      showScreen('ice-timer');
      if (!iceInstance) initIceCanvas();
    };
  }

  // Matches your index.html: id="back-to-dashboard-btn"
  const backBtn = document.getElementById('back-to-dashboard-btn');
  if (backBtn) {
    backBtn.onclick = () => showScreen('dashboard');
  }

  // Matches your index.html: id="add-ice-btn"
  const addBtn = document.getElementById('add-ice-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      spawnIce();
      playClink();
    };
  }

  // Reset Button
  const clearBtn = document.getElementById('clear-ice-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      iceCubes = [];
      document.getElementById('ice-count-display').innerText = "0";
    };
  }
}

function showScreen(id) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  // Show the target one (e.g., dashboard-screen or ice-timer-screen)
  const target = document.getElementById(id + '-screen');
  if (target) {
    target.classList.remove('hidden');
    // Force a display style if CSS 'hidden' class isn't working
    target.style.display = 'flex'; 
  }
}

function playClink() {
  const clink = new Audio('https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3');
  clink.volume = 0.4;
  clink.play().catch(() => {});
}

function spawnIce() {
  const container = document.getElementById('ice-canvas-wrapper');
  if (!container) return;
  iceCubes.push({
    x: container.offsetWidth / 2 + (Math.random() * 20 - 10),
    y: -50,
    vy: 5,
    vx: Math.random() * 4 - 2,
    rot: Math.random() * 360,
    rv: Math.random() * 6 - 3,
    startTime: Date.now()
  });
}

// --- 2. THE PHYSICS ENGINE (p5.js) ---
function initIceCanvas() {
  const sketch = (p) => {
    p.preload = () => {
      // Relative paths - ensure these are in your /public folder
      iceImg = p.loadImage('ice_texture.png');
      gFront = p.loadImage('glass_front.png');
      gBack = p.loadImage('glass_back.png');
    };

    p.setup = () => {
      const container = p.select('#ice-canvas-wrapper');
      let cnv = p.createCanvas(container.width, container.height);
      cnv.parent('ice-canvas-wrapper');
      p.imageMode(p.CENTER);
      p.angleMode(p.DEGREES);
    };

    p.draw = () => {
      p.clear();
      const centerX = p.width / 2;
      const floorY = p.height - 60;

      // DRAW BACK GLASS
      if (gBack && gBack.width > 1) {
        p.image(gBack, centerX, p.height - 180, 280, 350);
      } else {
        p.fill(255, 30);
        p.rect(centerX - 100, p.height - 350, 200, 300, 20);
      }

      // UPDATE & DRAW CUBES
      iceCubes.forEach((cube) => {
        let elapsed = Date.now() - cube.startTime;
        let meltRatio = p.max(0, 1 - (elapsed / MELT_TIME_MS));
        let currentSize = INITIAL_SIZE * p.sqrt(meltRatio);

        cube.vy += 0.7; // Gravity
        cube.y += cube.vy;
        cube.x += cube.vx;
        cube.rot += cube.rv;

        if (cube.y + currentSize/2 > floorY) {
          cube.y = floorY - currentSize/2;
          cube.vy *= -0.3;
          cube.rv *= 0.7;
        }

        p.push();
        p.translate(cube.x, cube.y);
        p.rotate(cube.rot);
        if (iceImg && iceImg.width > 1) {
          p.image(iceImg, 0, 0, currentSize, currentSize);
        } else {
          p.fill(200, 230, 255, 200);
          p.rect(-currentSize/2, -currentSize/2, currentSize, currentSize, 10);
        }
        p.pop();
      });

      // DRAW FRONT GLASS
      if (gFront && gFront.width > 1) {
        p.image(gFront, centerX, p.height - 180, 280, 350);
      }

      document.getElementById('ice-count-display').innerText = iceCubes.length;
    };
  };
  iceInstance = new p5(sketch);
}