// Animated page background: paper planes that wander, dodge the cursor and can
// be launched with a click, plus a tennis ball, a basketball and a pickleball
// that bounce around and can be knocked with the cursor. Knocking the
// basketball down through the hoop on the right edge scores a point.
(() => {
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Read the accent colour from the stylesheet so the planes follow the palette.
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace('#', '');
  const accent = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 100).join(', ');

  const rand = (min, max) => min + Math.random() * (max - min);
  const MAX_PLANES = 12;
  const SHOT_WINDOW = 4; // seconds a hit stays live for scoring
  let clock = 0; // seconds since the page loaded
  let width = 0;
  let height = 0;
  let planes = [];
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
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    hoop.rim = width < 700 ? 64 : 86;
    hoop.x2 = width - 8;
    hoop.x1 = hoop.x2 - hoop.rim;
    hoop.y = height * 0.34;
  }

  const makePlane = (x, y, angle, speed) => ({
    x, y, angle,
    speed,
    cruise: rand(35, 110),
    wander: 0,
    targetWander: 0,
    untilTurn: rand(0.5, 2.5),
    size: rand(0.8, 1.25),
    trail: [],
    sinceTrail: 0,
  });

  function seed() {
    const count = width < 700 ? 4 : 6;
    planes = Array.from({ length: count }, () => {
      const p = makePlane(rand(0, width), rand(0, height), rand(-0.9, 0.3), 0);
      p.speed = p.cruise;
      return p;
    });
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

  function movePlane(p, dt) {
    // Every so often pick a new turn rate and speed: a lazy curve, a straight
    // run, or now and then a full loop.
    p.untilTurn -= dt;
    if (p.untilTurn <= 0) {
      const loop = Math.random() < 0.15;
      p.targetWander = loop ? (Math.random() < 0.5 ? -1 : 1) * rand(2.8, 3.8) : rand(-1.5, 1.5);
      p.cruise = rand(35, 110);
      p.untilTurn = loop ? rand(1.2, 2) : rand(0.8, 3.2);
    }
    p.wander += (p.targetWander - p.wander) * Math.min(1, 2.5 * dt);
    p.angle += p.wander * dt;

    if (pointer.active) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 150) {
        // Turn away from the cursor, harder the closer it is.
        let diff = Math.atan2(dy, dx) - p.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const urgency = 1 - dist / 150;
        p.angle += diff * 4 * urgency * dt;
        p.speed = Math.max(p.speed, p.cruise + 120 * urgency);
      }
    }

    p.speed += (p.cruise - p.speed) * Math.min(1, 1.2 * dt);
    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;

    p.sinceTrail += dt;
    if (p.sinceTrail > 0.05) {
      p.sinceTrail = 0;
      p.trail.push(p.x, p.y);
      if (p.trail.length > 90) p.trail.splice(0, 2);
    }

    const m = 40;
    if (p.x > width + m || p.x < -m || p.y > height + m || p.y < -m) {
      p.x = p.x > width + m ? -m : p.x < -m ? width + m : p.x;
      p.y = p.y > height + m ? -m : p.y < -m ? height + m : p.y;
      p.trail = [];
    }
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
    if (b.y > height - b.r) { b.y = height - b.r; b.vy = -Math.abs(b.vy) * 0.9; }

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

  function drawPlane(p) {
    if (p.trail.length > 4) {
      ctx.beginPath();
      ctx.moveTo(p.trail[0], p.trail[1]);
      for (let i = 2; i < p.trail.length; i += 2) ctx.lineTo(p.trail[i], p.trail[i + 1]);
      ctx.setLineDash([2, 8]);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(${accent}, 0.3)`;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.scale(p.size, p.size);
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-11, -9);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-11, 9);
    ctx.closePath();
    ctx.fillStyle = `rgba(${accent}, 0.5)`;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-5, 0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(251, 248, 242, 0.8)';
    ctx.stroke();
    ctx.restore();
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
    planes.forEach(drawPlane);
    drawHoop(false);
    balls.forEach(drawBall);
    drawHoop(true);
    drawPopups();
  }

  // ---- loop and input ------------------------------------------------------

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    clock = now / 1000;
    if (now - pointer.at > 120) { pointer.vx = 0; pointer.vy = 0; }
    planes.forEach((p) => movePlane(p, dt));
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
  seed();
  draw();
  if (still) {
    if (scoreBox) scoreBox.hidden = true;
    window.addEventListener('resize', () => { resize(); seed(); draw(); });
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

  window.addEventListener('pointerdown', (e) => {
    // Clicks on controls and inside the chat keep their normal job.
    if (e.target.closest('a, button, input, select, textarea, label, summary, .chat')) return;
    if (balls.some((b) => kick(b, e.clientX, e.clientY, 26, 520))) return;
    const plane = makePlane(e.clientX, e.clientY, rand(-1.2, -0.2), 320);
    planes.push(plane);
    if (planes.length > MAX_PLANES) planes.shift();
  });

  requestAnimationFrame(frame);
})();
