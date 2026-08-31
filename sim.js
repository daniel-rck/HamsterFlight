// Literal transcription of the AS2 logic, 20 Hz ticks (setInterval 50 ms)
const rnd = n => Math.floor(Math.random() * n);   // AS2 random(n)
const HAMSTER_X = 148, PILLOW_X = 140, PILLOW_Y = 740.9;

function jumpPhase(clickTick) {           // returns {y, yvel} at the moment of the 2nd click
  let y = 956, yvel = -(rnd(5) + 10), boost = false, t = 0;
  while (t < clickTick) {
    if (!boost && y < 930) { yvel += -(rnd(5) + 15); boost = true; }
    yvel += yvel < 0 ? 1.5 : 0.75;
    y += yvel;
    if (y >= 956) return null;            // faceplant: missed the window
    t++;
  }
  return { y, yvel };
}

function launch(st) {
  let y = st.y, yv = st.yvel;
  if (y > 759) { y = 759; yv = 0; }              // getPillowCollision clamps y AND kills yvel
  const dx = HAMSTER_X - PILLOW_X + 30;
  const dy = y - PILLOW_Y - 5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ad = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  const ar = ad * Math.PI / 180;
  let vel = 90 - dist;                           // shoot(): _loc3_ = 90 - f
  if (yv < 0) vel += ad <= 90 ? -yv / 2 : yv / 2;
  return { xvel: Math.sin(ar) * vel, yvel: -Math.cos(ar) * vel, vel, ad };
}

function fly(b, { hold, powerups }) {
  let { xvel, yvel } = b, x = HAMSTER_X, y = 759;
  let grav = 0.99, gravPoints = 100, gravButton = false, hit = false;
  let items = [], mark = 650, ticks = 0, maxUp = y;
  while (ticks < 4000) {
    const camX = -x + 150;
    // generatePowerups()
    if (600 - camX >= mark) {
      mark += 150;
      const r = rnd(11);
      const typ = r < 2 ? 'bounce' : r < 5 ? 'speed' : r < 8 ? 'wind' : r === 8 ? 'slide' : r === 9 ? 'rebound' : 'superbounce';
      items.push({ typ, x: 800 - camX + camX + x - 150 + 650 - (x - 150) , y: typ === 'rebound' ? 930 : 840 - rnd(1200) });
      items[items.length - 1].x = x + 650;
    }
    // pickups (approximate 40 px box instead of hitTest on the core shapes)
    if (powerups) for (const it of items) {
      if (it.taken) continue;
      if (Math.abs(it.x - x) < 40 && Math.abs(it.y - y) < 40) {
        it.taken = 1;
        if (it.typ === 'speed') xvel += 20;
        else if (it.typ === 'wind') { yvel -= 8; xvel += 2; }
        else if (it.typ === 'rebound') { xvel = 40; yvel = -40; hit = false; }
        else if (it.typ === 'bounce') it.armed = 'bounce';
        else if (it.typ === 'superbounce') it.armed = 'superbounce';
      }
    }
    const armed = items.find(i => i.armed);
    // hold button -> negative gravity proportional to speed
    gravButton = hold(y, yvel, gravPoints, xvel);
    grav = gravButton && gravPoints > 0 ? -0.17 * xvel : 0.99;
    xvel *= 0.99;
    yvel += grav;
    // checkCollision()
    if (y + yvel >= 950) {
      y = 950; hit = true;
      const angDeg = Math.atan2((y + yvel) - y, xvel) * 180 / Math.PI;
      if (armed) {
        armed.armed = null;
        if (armed.typ === 'superbounce') { xvel *= 1.6; yvel *= -1.5; if (yvel > -50) yvel = -50; }
        else { xvel *= 0.6; yvel *= -0.6; if (yvel > -30) yvel = -30; }
        hit = false;
      } else { y = 949; xvel *= 0.6; yvel /= -2; }
    }
    x += xvel; y += yvel;
    if (y < maxUp) maxUp = y;
    if (gravButton) { gravPoints -= 10; if (gravPoints <= 0) gravPoints = 0; }
    else { gravPoints = Math.min(100, gravPoints + 1); }
    if (xvel < 1 && hit) break;
    ticks++;
  }
  return { feet: Math.floor(x / 100), ticks, seconds: +(ticks * 0.05).toFixed(1), peakUp: Math.round(759 - maxUp) };
}

function shot(clickTick, strategy, powerups = true) {
  const st = jumpPhase(clickTick);
  if (!st) return null;
  if (st.y < 690 || st.y > 800) return { miss: true, feet: 0, y: st.y };
  const b = launch(st);
  return { ...fly(b, { hold: strategy, powerups }), vel: +b.vel.toFixed(1), ang: +b.ad.toFixed(1) };
}

const never = () => false;
const greedy = (y, yvel, gp) => gp > 0;                       // mash the button
const smart  = (y, yvel, gp) => gp > 0 && yvel > -5;          // hold only while not already climbing fast

console.log('tick  y_at_click   vel  angle | no hold        | mash           | smart');
for (let t = 3; t <= 26; t++) {
  const st = jumpPhase(t); if (!st) { console.log(String(t).padStart(4), ' faceplant'); continue; }
  const b = launch(st);
  const a = shot(t, never), c = shot(t, greedy), d = shot(t, smart);
  console.log(String(t).padStart(4), String(Math.round(st.y)).padStart(11), String(b.vel.toFixed(1)).padStart(6),
    String(b.ad.toFixed(0)).padStart(6), '|',
    (a.feet + ' ft').padStart(9), (c.feet + ' ft ' + c.peakUp + 'up').padStart(15), (d.feet + ' ft ' + d.peakUp + 'up').padStart(15));
}
let best = 0, tot = [];
for (let i = 0; i < 300; i++) { const r = shot(8 + rnd(8), smart); if (r) { tot.push(r.feet); if (r.feet > best) best = r.feet; } }
tot.sort((a, b) => a - b);
console.log('\n300 Würfe (smart):  min', tot[0], ' median', tot[Math.floor(tot.length/2)], ' max', best);
