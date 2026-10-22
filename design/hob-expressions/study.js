/* Experimental faces stay here; app behavior uses only its existing neutral, smile, blink, and eyebrow. */
const body = '../../app/src/renderer/src/assets/hob-body.png';
const openEyes = [[15,27,5,5],[40,27,5,5]];
const closedEyes = [[15,29,5,2],[40,29,5,2]];
const smile = [[25,35,10,2],[23,33,2,2],[35,33,2,2]];
const flat = [[24,33,12,2]];
const raisedBrow = [[41,21,3,2],[39,23,2,2],[44,23,2,2]];
const happyEyes = [[15,29,1,2],[16,27,3,2],[19,29,1,2],[40,29,1,2],[41,27,3,2],[44,29,1,2]];
const faces = [
  { id:'neutral', name:'Neutral', kind:'Everyday', note:'Present, relaxed, and ready when you are.', eyes:openEyes, mouth:flat },
  { id:'smile', name:'Warm smile', kind:'Welcome', note:'A small hello. Warm without trying too hard.', eyes:openEyes, mouth:smile },
  { id:'curious', name:'Curious', kind:'Setup', note:'One eyebrow up. A little interested in what’s going on.', eyes:openEyes, mouth:flat, brow:raisedBrow },
  { id:'blink', name:'Blink', kind:'A small moment', note:'A quick blink between longer, quieter expressions.', eyes:closedEyes, mouth:flat },
  { id:'thinking', name:'Thinking', kind:'Exploration', note:'A glance to the side while an idea takes shape.', eyes:[[17,26,5,5],[42,26,5,5]], mouth:[[25,34,9,2]] },
  { id:'focused', name:'Focused', kind:'Exploration', note:'A little more intent, without looking cross.', eyes:[[15,28,5,4],[40,28,5,4]], mouth:[[26,34,8,2]] },
  { id:'content', name:'Content', kind:'Exploration', note:'Eyes softened. Everything is in a good place.', eyes:closedEyes, mouth:smile },
  { id:'delighted', name:'Delighted', kind:'Exploration', note:'A happy result, carried by the eyes. The smile stays small.', eyes:happyEyes, mouth:smile },
  { id:'laugh', name:'Laugh', kind:'Exploration', note:'A brief chuckle. A compact smile with no teeth or oversized features.', eyes:happyEyes, mouth:[[24,33,12,2],[25,35,10,2],[27,37,6,1]] },
  { id:'wink', name:'Wink', kind:'Exploration', note:'A quick bit of mischief. Use sparingly.', eyes:[[15,27,5,5],[40,29,5,2]], mouth:smile },
  { id:'confused', name:'Puzzled', kind:'Exploration', note:'One uneven glance, as if a detail needs another look.', eyes:[[15,27,5,5],[40,29,5,3]], mouth:[[24,34,5,2],[29,33,6,2]], brow:raisedBrow },
  { id:'concerned', name:'Concerned', kind:'Exploration', note:'Attentive and gentle when something needs care.', eyes:openEyes, mouth:[[26,34,8,2]], brow:[[15,23,3,2],[18,21,3,2],[39,21,3,2],[42,23,3,2]] },
  { id:'sad', name:'Downcast', kind:'Exploration', note:'A softer frown. Worth comparing, rather than assuming we need it.', eyes:[[15,28,5,4],[40,28,5,4]], mouth:[[25,33,10,2],[23,35,2,2],[35,35,2,2]] },
  { id:'sleepy', name:'Sleepy', kind:'Exploration', note:'Heavy eyelids and a tiny mouth. Resting, not absent.', eyes:[[15,30,5,2],[40,30,5,2]], mouth:[[27,35,6,2]] },
];
const rectangles = (rs) => rs.map(([x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#1c1b22"/>`).join('');
function artwork(face, size) {
  return `<svg class="hob" width="${size}" height="${size}" viewBox="0 0 60 60" shape-rendering="crispEdges" role="img" aria-label="Hob: ${face.name}"><ellipse cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity=".07"/><svg width="60" height="60" viewBox="158 155.5 937 937"><image href="${body}" width="1254" height="1254"/></svg><g class="eyes">${rectangles(face.eyes)}${rectangles(face.brow || [])}</g><g class="mouth">${rectangles(face.mouth)}</g></svg>`;
}
const hero = document.getElementById('hero');
const mode = document.getElementById('mode');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let selected = faces[0], gaze = { x:0,y:0 }, lastMove = 0, faceTimer, glanceTimer;
const buttons = new Map();
for (const face of faces) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'face-option'; button.dataset.face = face.id;
  button.setAttribute('aria-pressed', String(face === selected));
  button.innerHTML = artwork(face, 64) + `<span>${face.name}</span>`;
  button.addEventListener('click', () => { mode.value = 'still'; sync(); select(face, true); });
  document.getElementById('faces').append(button); buttons.set(face.id, button);
}
function look(x, y) {
  gaze = { x,y };
  hero.querySelector('.eyes').setAttribute('transform', `translate(${x} ${y})`);
  hero.querySelector('.mouth').setAttribute('transform', `translate(${Math.round(x / 2)} ${Math.round(y / 2)})`);
}
function select(face, announce = false) {
  selected = face;
  hero.innerHTML = artwork(face, 164);
  look(gaze.x,gaze.y);
  for (const size of [72,48,24]) document.getElementById(`size-${size}`).innerHTML = artwork(face,size);
  document.getElementById('face-name').textContent = face.name;
  document.getElementById('face-kind').textContent = face.kind;
  document.getElementById('face-note').textContent = face.note;
  for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === face.id));
  if (announce) document.getElementById('selection-announcement').textContent = `${face.name} selected.`;
}
function setupFace() {
  const r = Math.random();
  select(faces[r < .16 ? 2 : r < .48 ? 1 : 3]);
  faceTimer = setTimeout(() => { select(faces[0]); faceTimer = setTimeout(setupFace, 2800 + Math.random() * 3000); }, r < .16 ? 1400 : r < .48 ? 1600 : 150);
}
function cycle() {
  select(faces[(faces.indexOf(selected) + 1) % faces.length]);
  faceTimer = setTimeout(cycle, 2800);
}
function move(event) {
  if (mode.value !== 'setup' || reduced.matches || event.pointerType === 'touch') return;
  const box = hero.querySelector('svg').getBoundingClientRect();
  lastMove = Date.now();
  look(Math.round(Math.tanh((event.clientX - box.left - box.width / 2) / 220) * 3), Math.round(Math.tanh((event.clientY - box.top - box.height / 2) / 220) * 2));
}
function sync() {
  clearTimeout(faceTimer); clearInterval(glanceTimer); look(0,0);
  document.removeEventListener('pointermove',move);
  document.getElementById('preview-hint').textContent = reduced.matches && mode.value !== 'still' ? 'Motion is paused by your reduced-motion setting.' : mode.value === 'setup' ? 'Move your cursor. Pause to let Hob look around.' : mode.value === 'cycle' ? 'A new expression every few seconds.' : 'Choose a face below.';
  if (reduced.matches) { if (mode.value === 'setup') select(faces[0]); return; }
  if (mode.value === 'setup') {
    select(faces[0]); lastMove = 0;
    document.addEventListener('pointermove',move);
    faceTimer = setTimeout(setupFace,1500);
    const spots = [[-3,0],[3,0],[0,0],[-2,1],[2,1],[0,-2]];
    glanceTimer = setInterval(() => { if (Date.now() - lastMove > 2500) look(...spots[Math.floor(Math.random() * spots.length)]); },3500);
  } else if (mode.value === 'cycle') faceTimer = setTimeout(cycle,2800);
}
select(selected);
mode.addEventListener('change',sync);
reduced.addEventListener('change',sync);
document.getElementById('theme').addEventListener('change', (event) => { document.documentElement.style.colorScheme = event.target.value === 'system' ? 'light dark' : event.target.value; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(faceTimer); clearInterval(glanceTimer); } else sync(); });
