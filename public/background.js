// Animated page background, seen from above like a pond: fish silhouettes
// swim around on their own, and a click on empty space disturbs the water.
// The water is a small wave simulation: ripples spread, cross each other,
// bounce off the edges of the screen, bend the fish beneath them and catch
// the light. Where WebGL is not available, simple rings are drawn instead.
// A tennis ball, a basketball and a pickleball also bounce around and can be
// knocked with the cursor. Knocking the basketball down through the hoop on
// the right edge scores a point.
(() => {
  const view = document.getElementById('sky');
  if (!view) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- water ---------------------------------------------------------------
  // The fish, balls and hoop are drawn on a hidden canvas (the "scene"). The
  // visible canvas then shows that scene through the water surface.

  const VERTEX = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2((aPos.x + 1.0) * 0.5, (1.0 - aPos.y) * 0.5);
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;
  const FRAGMENT = `
    precision mediump float;
    uniform sampler2D uScene;
    uniform sampler2D uWave;
    uniform vec2 uPixel;
    varying vec2 vUv;
    void main() {
      vec2 slope = (texture2D(uWave, vUv).rg - 0.5) * 2.0;
      // Refraction: what lies under a slope appears shifted.
      vec4 colour = texture2D(uScene, vUv + slope * 34.0 * uPixel);
      // Light from the top left: slopes facing it shine, slopes facing away darken.
      float facing = dot(slope, vec2(-0.6, -0.8));
      float shine = smoothstep(0.04, 0.5, facing);
      float shade = smoothstep(0.04, 0.5, -facing);
      float glint = pow(shine, 3.0);
      vec4 dark = vec4(vec3(0.15, 0.13, 0.11), 1.0) * (shade * 0.2);
      colour = dark + colour * (1.0 - dark.a);
      vec4 light = vec4(1.0) * min(1.0, shine * 0.35 + glint * 0.5);
      colour = light + colour * (1.0 - light.a);
      gl_FragColor = colour;
    }`;

  function createWater(target) {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return null;
    const gl = target.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texture = (unit) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    texture(0);
    texture(1);
    gl.uniform1i(gl.getUniformLocation(program, 'uScene'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uWave'), 1);
    const uPixel = gl.getUniformLocation(program, 'uPixel');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.clearColor(0, 0, 0, 0);

    // The water surface is a coarse grid of heights, one cell per CELL pixels.
    const CELL = 5;
    const DAMPING = 0.986;
    let cols = 0;
    let rows = 0;
    let now = new Float32Array(0);
    let before = new Float32Array(0);
    let slopes = new Uint8Array(0);
    let calm = true;
    let owed = 0;

    function encode() {
      for (let y = 1; y < rows - 1; y += 1) {
        for (let x = 1; x < cols - 1; x += 1) {
          const i = y * cols + x;
          const gx = (now[i + 1] - now[i - 1]) * 3;
          const gy = (now[i + cols] - now[i - cols]) * 3;
          slopes[i * 3] = 128 + Math.max(-1, Math.min(1, gx)) * 127;
          slopes[i * 3 + 1] = 128 + Math.max(-1, Math.min(1, gy)) * 127;
        }
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, cols, rows, 0, gl.RGB, gl.UNSIGNED_BYTE, slopes);
    }

    // One step of the wave equation: each cell moves towards the average of
    // its neighbours and overshoots, which is what makes a wave travel.
    function advance() {
      let biggest = 0;
      for (let y = 1; y < rows - 1; y += 1) {
        for (let x = 1; x < cols - 1; x += 1) {
          const i = y * cols + x;
          const v = ((now[i - 1] + now[i + 1] + now[i - cols] + now[i + cols]) * 0.5 - before[i]) * DAMPING;
          before[i] = v;
          if (v > biggest || -v > biggest) biggest = Math.abs(v);
        }
      }
      [now, before] = [before, now];
      // Below this the waves are too faint to see, so the water is at rest.
      if (biggest < 0.015) {
        now.fill(0);
        before.fill(0);
        calm = true;
      }
    }

    return {
      resize(w, h) {
        cols = Math.max(8, Math.ceil(w / CELL));
        rows = Math.max(8, Math.ceil(h / CELL));
        now = new Float32Array(cols * rows);
        before = new Float32Array(cols * rows);
        slopes = new Uint8Array(cols * rows * 3).fill(128);
        calm = true;
        gl.viewport(0, 0, target.width, target.height);
        gl.uniform2f(uPixel, 1 / Math.max(1, w), 1 / Math.max(1, h));
        encode();
      },
      // Pushes the surface down around a point, like a finger or a pebble.
      drop(x, y, strength = 1.3) {
        const cx = Math.round(x / CELL);
        const cy = Math.round(y / CELL);
        const radius = 2.4; // narrow, so several rings follow the first
        for (let dy = -8; dy <= 8; dy += 1) {
          for (let dx = -8; dx <= 8; dx += 1) {
            const px = cx + dx;
            const py = cy + dy;
            if (px < 1 || py < 1 || px >= cols - 1 || py >= rows - 1) continue;
            now[py * cols + px] -= strength * Math.exp(-(dx * dx + dy * dy) / (radius * radius));
          }
        }
        calm = false;
      },
      step(dt) {
        if (calm) return;
        owed = Math.min(owed + dt, 0.05);
        while (owed >= 1 / 60) {
          owed -= 1 / 60;
          if (!calm) advance();
        }
        encode();
      },
      isCalm: () => calm,
      render(scene) {
        gl.activeTexture(gl.TEXTURE0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
  }

  const water = still ? null : createWater(view);
  const canvas = water ? document.createElement('canvas') : view;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Passing the scene through the water every frame is the expensive part,
  // and phones feel it. So the plain scene is what is normally on screen, and
  // the water canvas takes its place only while a ripple is moving.
  let showingWater = false;
  if (water) {
    canvas.className = 'sky-scene';
    canvas.setAttribute('aria-hidden', 'true');
    view.before(canvas);
    view.style.visibility = 'hidden';
  }

  // Read the accent colour from the stylesheet so the fish follow the palette.
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace('#', '');
  const accent = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 100).join(', ');

  const rand = (min, max) => min + Math.random() * (max - min);
  const RIPPLE_LIFE = 2.6; // seconds
  const SHOT_WINDOW = 4; // seconds a hit stays live for scoring
  let clock = 0; // seconds since the page loaded
  let seeded = false;
  let width = 0;
  let height = 0;
  let fish = [];
  let ripples = [];
  let balls = [];
  const pointer = { x: -999, y: -999, vx: 0, vy: 0, active: false, at: 0 };

  const hoop = { x1: 0, x2: 0, y: 0, rim: 0, swish: 0, cooldown: 0 };
  let popups = [];
  let score = 0;
  try { score = Number(localStorage.getItem('hoops-v2')) || 0; } catch { /* storage unavailable */ }
  const scoreBox = document.getElementById('score');
  const scoreValue = document.getElementById('score-value');
  if (scoreValue) scoreValue.textContent = score;

  function resize() {
    // A phone's visible height changes whenever its address bar slides in or
    // out, and rebuilding for that would wipe any ripples. So on touch screens
    // the canvas is made as tall as the screen itself, once, and after that
    // only a change of width (turning the phone) counts as a resize.
    const w = window.innerWidth;
    let h = window.innerHeight;
    const touchScreen = matchMedia('(pointer: coarse)').matches;
    if (touchScreen && window.screen) {
      const { width: sw, height: sh } = window.screen;
      h = Math.max(h, h >= w ? Math.max(sw, sh) : Math.min(sw, sh));
    }
    if (w === width && (h === height || (touchScreen && h < height))) return;
    width = w;
    height = h;
    // Set the size on the page in the same step, so the drawing is never
    // stretched to fit a box of a different shape.
    for (const el of water ? [view, canvas] : [view]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
    // Phones draw at a lower sharpness: far fewer pixels to fill each frame,
    // and soft silhouettes hide the difference.
    const ratio = Math.min(window.devicePixelRatio || 1, touchScreen ? 1.5 : 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (water) {
      view.width = canvas.width;
      view.height = canvas.height;
      water.resize(width, height);
    }
    hoop.rim = width < 700 ? 64 : 86;
    hoop.x2 = width - 8;
    hoop.x1 = hoop.x2 - hoop.rim;
    hoop.y = height * 0.34;
    // A page opened in a background tab can report no size at first, so the
    // fish and balls are placed the first time there is a real size to use.
    if (!seeded && width > 0 && height > 0) {
      seed();
      seeded = true;
    }
  }

  const makeFish = () => {
    const size = rand(0.8, 1.9) * (width < 700 ? 0.75 : 1); // smaller on phones
    const cruise = rand(18, 55);
    return {
      x: rand(0, width),
      y: rand(0, height),
      angle: rand(0, Math.PI * 2),
      speed: cruise,
      cruise,
      wander: 0,
      targetWander: 0,
      untilTurn: rand(0.5, 3),
      phase: rand(0, 6),
      size,
      alpha: 0.14 + 0.16 * Math.min(1, size / 1.9), // smaller fish read as deeper
    };
  };

  function seed() {
    fish = Array.from({ length: width < 700 ? 5 : 8 }, makeFish);
    const radius = width < 700 ? 15 : 20;
    balls = ['tennis', 'basketball', 'pickleball'].map((type, i) => ({
      type,
      r: type === 'basketball' ? radius * 1.25 : radius,
      x: width * (0.25 + i * 0.25),
      y: height * rand(0.2, 0.8),
      vx: rand(-60, 60),
      vy: rand(-60, 60),
      angle: rand(0, 6),
    }));
  }

  // ---- movement ------------------------------------------------------------

  function moveFish(f, dt) {
    // Every few seconds pick a new gentle turn and pace. Now and then a fish
    // darts forward for a moment, then settles again.
    f.untilTurn -= dt;
    if (f.untilTurn <= 0) {
      const dart = Math.random() < 0.12;
      f.targetWander = rand(-0.9, 0.9);
      f.cruise = dart ? rand(90, 140) : rand(18, 55);
      f.untilTurn = dart ? rand(0.4, 0.9) : rand(1.5, 4.5);
    }
    f.wander += (f.targetWander - f.wander) * Math.min(1, 1.5 * dt);
    f.angle += f.wander * dt;
    f.speed += (f.cruise - f.speed) * Math.min(1, 2 * dt);
    f.x += Math.cos(f.angle) * f.speed * dt;
    f.y += Math.sin(f.angle) * f.speed * dt;
    f.phase += dt * (3 + f.speed * 0.09); // the tail beats faster at speed

    const m = 50 * f.size;
    if (f.x > width + m) f.x = -m; else if (f.x < -m) f.x = width + m;
    if (f.y > height + m) f.y = -m; else if (f.y < -m) f.y = height + m;
  }

  function addPoint() {
    score += 1;
    hoop.swish = 0.45;
    hoop.cooldown = 0.7;
    popups.push({ x: hoop.x1 + hoop.rim / 2, y: hoop.y - 14, age: 0 });
    try { localStorage.setItem('hoops-v2', score); } catch { /* storage unavailable */ }
    if (scoreValue) scoreValue.textContent = score;
    if (scoreBox) {
      scoreBox.classList.remove('score--bump');
      void scoreBox.offsetWidth; // restart the animation
      scoreBox.classList.add('score--bump');
    }
  }

  function hitHoop(b, previousY) {
    // The backboard is a wall above and just below the rim.
    if (b.x > hoop.x2 - b.r && b.y > hoop.y - 62 && b.y < hoop.y + 14) {
      b.x = hoop.x2 - b.r;
      b.vx = -Math.abs(b.vx) * 0.9;
    }
    // The front of the rim deflects anything that clips it.
    const dx = b.x - hoop.x1;
    const dy = b.y - hoop.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < b.r + 4) {
      const nx = dx / dist;
      const ny = dy / dist;
      const into = b.vx * nx + b.vy * ny;
      if (into < 0) { b.vx -= 1.8 * into * nx; b.vy -= 1.8 * into * ny; }
      b.x = hoop.x1 + nx * (b.r + 4);
      b.y = hoop.y + ny * (b.r + 4);
    }
    // Nothing passes up through the net: a ball rising into the rim from
    // below bounces back down.
    if (previousY >= hoop.y && b.y < hoop.y && b.x > hoop.x1 && b.x < hoop.x2) {
      b.y = hoop.y + 1;
      b.vy = Math.abs(b.vy) * 0.9;
    }
    // A point: the basketball's centre drops through the rim from above,
    // within a few seconds of the visitor hitting it. Balls drifting through
    // on their own do not count, and each hit can score once.
    const through = previousY <= hoop.y && b.y > hoop.y && b.x > hoop.x1 + 6 && b.x < hoop.x2 - 6;
    const wasShot = clock - (b.hitAt ?? -Infinity) < SHOT_WINDOW;
    if (b.type === 'basketball' && through && wasShot && hoop.cooldown <= 0) {
      b.hitAt = -Infinity;
      addPoint();
    }
  }

  function moveBall(b, dt) {
    const previousY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += (b.vx / b.r) * dt;

    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.9; }
    if (b.x > width - b.r) { b.x = width - b.r; b.vx = -Math.abs(b.vx) * 0.9; }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.9; }
    // The floor is the bottom of what is visible, which on a phone can be
    // higher than the bottom of the canvas.
    const floor = Math.min(height, window.innerHeight || height);
    if (b.y > floor - b.r) { b.y = floor - b.r; b.vy = -Math.abs(b.vy) * 0.9; }

    // Slow down after a hit, but never stop drifting.
    const speed = Math.hypot(b.vx, b.vy) || 1;
    const target = Math.max(28, speed * (1 - 0.6 * dt));
    b.vx *= target / speed;
    b.vy *= target / speed;

    hitHoop(b, previousY);
    if (pointer.active) kick(b, pointer.x, pointer.y, 18, Math.hypot(pointer.vx, pointer.vy));
  }

  // Knocks a ball away from a point if the point is touching it.
  function kick(b, x, y, reach, force) {
    const dx = b.x - x;
    const dy = b.y - y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > b.r + reach) return false;
    const power = Math.min(900, Math.max(Math.hypot(b.vx, b.vy), force, 200));
    b.vx = (dx / dist) * power;
    b.vy = (dy / dist) * power;
    b.x = x + (dx / dist) * (b.r + reach);
    b.y = y + (dy / dist) * (b.r + reach);
    b.hitAt = clock;
    return true;
  }

  function collideBalls() {
    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        const a = balls[i];
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const overlap = a.r + b.r - dist;
        if (overlap <= 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= (nx * overlap) / 2; a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2; b.y += (ny * overlap) / 2;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing <= 0) continue;
        a.vx -= closing * nx; a.vy -= closing * ny;
        b.vx += closing * nx; b.vy += closing * ny;
      }
    }
  }

  // ---- drawing -------------------------------------------------------------

  // Half-widths of the body from nose to tail base.
  const FISH_WIDTHS = [0, 4.6, 6.6, 7.2, 6.6, 5.2, 3.6, 2.2, 1.3];

  function drawFish(f) {
    const n = FISH_WIDTHS.length;
    const step = 5.2;
    // The spine: a wave travels from head to tail, growing as it goes.
    const spine = [];
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      spine.push([(n - 1) * step * 0.45 - i * step, Math.sin(f.phase - t * 3.2) * (0.6 + 5.5 * t * t)]);
    }
    const left = [];
    const right = [];
    for (let i = 0; i < n; i += 1) {
      const a = spine[Math.max(0, i - 1)];
      const b = spine[Math.min(n - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len;
      const ny = (b[0] - a[0]) / len;
      const w = FISH_WIDTHS[i];
      left.push([spine[i][0] + nx * w, spine[i][1] + ny * w]);
      right.push([spine[i][0] - nx * w, spine[i][1] - ny * w]);
    }
    const outline = [...left, ...right.reverse()];

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.scale(f.size, f.size);
    ctx.fillStyle = `rgba(${accent}, ${f.alpha})`;

    // Body: a smooth curve through the outline points.
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i += 1) {
      const next = outline[(i + 1) % outline.length];
      ctx.quadraticCurveTo(outline[i][0], outline[i][1], (outline[i][0] + next[0]) / 2, (outline[i][1] + next[1]) / 2);
    }
    ctx.closePath();
    ctx.fill();

    // Tail fin: follows the last stretch of spine, with a little extra swing.
    const end = spine[n - 1];
    const before = spine[n - 2];
    const dir = Math.atan2(end[1] - before[1], end[0] - before[0]) + Math.sin(f.phase - 3.6) * 0.35;
    const lobe = (spread, length) => [end[0] + Math.cos(dir + spread) * length, end[1] + Math.sin(dir + spread) * length];
    const [ax, ay] = lobe(0.55, 13);
    const [bx, by] = lobe(-0.55, 13);
    const [cx, cy] = lobe(0, 6);
    ctx.beginPath();
    ctx.moveTo(end[0], end[1]);
    ctx.lineTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.closePath();
    ctx.fill();

    // Side fins, sweeping back from just behind the head.
    const [fx, fy] = spine[2];
    const sweep = 0.9 + Math.sin(f.phase * 0.5) * 0.15;
    for (const side of [-1, 1]) {
      const baseY = fy + side * 5.5;
      ctx.beginPath();
      ctx.moveTo(fx, baseY);
      ctx.quadraticCurveTo(fx - 2, baseY + side * 8, fx - Math.cos(sweep) * 9, baseY + side * Math.sin(sweep) * 9);
      ctx.quadraticCurveTo(fx - 6, baseY + side, fx, baseY);
      ctx.fill();
    }
    ctx.restore();
  }

  // Fallback when the water simulation is unavailable: a few rings spreading
  // from the click, each a dark line with a light one just outside it.
  function drawRipple(r) {
    const fade = Math.max(0, 1 - r.age / RIPPLE_LIFE);
    for (let i = 0; i < 4; i += 1) {
      const t = r.age - i * 0.22;
      if (t <= 0) continue;
      const radius = 4 + 200 * (1 - Math.exp(-1.4 * t));
      const strength = fade * fade * (1 - i * 0.18);
      const line = 0.5 + (2.4 - i * 0.45) * fade;
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${accent}, ${0.45 * strength})`;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius + line, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.75 * strength})`;
      ctx.stroke();
    }
  }

  function drawBall(b) {
    const { r } = b;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = { tennis: '#cdd47a', basketball: '#c98d5c', pickleball: '#e2cf7a' }[b.type];
    ctx.fill();
    ctx.clip();
    ctx.lineWidth = Math.max(1.5, r * 0.09);

    if (b.type === 'tennis') {
      ctx.strokeStyle = 'rgba(251, 248, 242, 0.95)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * r * 1.15, 0, r * 0.85, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (b.type === 'basketball') {
      ctx.strokeStyle = 'rgba(38, 34, 28, 0.65)';
      ctx.beginPath();
      ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
      ctx.moveTo(0, -r); ctx.lineTo(0, r);
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * r * 1.3, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(38, 34, 28, 0.3)';
      const hole = (x, y) => { ctx.beginPath(); ctx.arc(x, y, r * 0.11, 0, Math.PI * 2); ctx.fill(); };
      hole(0, 0);
      for (let i = 0; i < 6; i += 1) hole(Math.cos(i * 1.047) * r * 0.42, Math.sin(i * 1.047) * r * 0.42);
      for (let i = 0; i < 10; i += 1) hole(Math.cos(i * 0.628 + 0.3) * r * 0.78, Math.sin(i * 0.628 + 0.3) * r * 0.78);
    }
    ctx.restore();
  }

  function drawHoop(front) {
    const { x1, x2, y, rim } = hoop;
    if (front) {
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#b9764a';
      ctx.stroke();
      return;
    }
    ctx.fillStyle = 'rgba(38, 34, 28, 0.55)';
    ctx.fillRect(x2, y - 62, 6, 76);
    // Net: strands narrow towards the bottom and stretch briefly on a score.
    const drop = rim * 0.55 + hoop.swish * 26;
    const strands = 6;
    ctx.beginPath();
    for (let i = 0; i <= strands; i += 1) {
      ctx.moveTo(x1 + (rim * i) / strands, y);
      ctx.lineTo(x1 + rim * 0.2 + (rim * 0.6 * i) / strands, y + drop);
    }
    for (const t of [0.4, 0.75, 1]) {
      const inset = rim * 0.2 * t;
      ctx.moveTo(x1 + inset, y + drop * t);
      ctx.lineTo(x2 - inset, y + drop * t);
    }
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(38, 34, 28, 0.3)';
    ctx.stroke();
  }

  function drawPopups() {
    ctx.font = "800 24px 'Bricolage Grotesque', system-ui, sans-serif";
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.fillStyle = `rgba(38, 34, 28, ${Math.max(0, 1 - p.age / 1.1)})`;
      ctx.fillText('+1', p.x, p.y - p.age * 46);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    fish.forEach(drawFish);
    ripples.forEach(drawRipple);
    drawHoop(false);
    balls.forEach(drawBall);
    drawHoop(true);
    drawPopups();
    if (!water) return;
    const active = !water.isCalm();
    if (active) water.render(canvas);
    if (active !== showingWater) {
      showingWater = active;
      view.style.visibility = active ? 'visible' : 'hidden';
      canvas.style.visibility = active ? 'hidden' : 'visible';
    }
  }

  // ---- loop and input ------------------------------------------------------

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    clock = now / 1000;
    if (now - pointer.at > 120) { pointer.vx = 0; pointer.vy = 0; }
    fish.forEach((f) => moveFish(f, dt));
    ripples.forEach((r) => { r.age += dt; });
    ripples = ripples.filter((r) => r.age < RIPPLE_LIFE);
    if (water) water.step(dt);
    balls.forEach((b) => moveBall(b, dt));
    collideBalls();
    hoop.swish = Math.max(0, hoop.swish - dt);
    hoop.cooldown = Math.max(0, hoop.cooldown - dt);
    popups.forEach((p) => { p.age += dt; });
    popups = popups.filter((p) => p.age < 1.1);
    draw();
    if (!document.hidden) requestAnimationFrame(frame);
  }

  resize();
  draw();
  if (still) {
    if (scoreBox) scoreBox.hidden = true;
    window.addEventListener('resize', () => { resize(); if (seeded) seed(); draw(); });
    return;
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { last = performance.now(); requestAnimationFrame(frame); }
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now();
    const dt = Math.max(1, now - pointer.at) / 1000;
    pointer.vx = (e.clientX - pointer.x) / dt;
    pointer.vy = (e.clientY - pointer.y) / dt;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = now;
    pointer.active = true;
  });
  document.addEventListener('pointerleave', () => { pointer.active = false; });

  // A click or tap on empty space: knock a ball if one is there, otherwise
  // disturb the water.
  function poke(x, y) {
    if (balls.some((b) => kick(b, x, y, 26, 520))) return;
    if (water) {
      water.drop(x, y);
      return;
    }
    ripples.push({ x, y, age: 0 });
    if (ripples.length > 8) ripples.shift();
  }

  // Clicks on controls and inside the chat keep their normal job.
  const isControl = (target) => Boolean(target.closest?.('a, button, input, select, textarea, label, summary, .chat'));

  // A mouse click acts at once. A finger only counts when it lifts again
  // quickly without having moved, so a swipe to scroll does nothing.
  let touch = null;
  window.addEventListener('pointerdown', (e) => {
    if (isControl(e.target)) return;
    if (e.pointerType === 'mouse') poke(e.clientX, e.clientY);
    else touch = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() };
  });
  window.addEventListener('pointerup', (e) => {
    if (!touch || touch.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - touch.x, e.clientY - touch.y);
    const held = performance.now() - touch.at;
    if (moved < 10 && held < 500) poke(touch.x, touch.y);
    touch = null;
  });
  // The browser cancels the touch when it turns into a scroll.
  window.addEventListener('pointercancel', () => { touch = null; });

  requestAnimationFrame(frame);
})();
