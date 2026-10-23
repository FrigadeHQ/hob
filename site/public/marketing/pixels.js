document.querySelectorAll('canvas.pixel-wall, canvas.hero-pixels').forEach(canvas => {
  const hero = canvas.classList.contains('hero-pixels');
  const vivid = canvas.dataset.flourish === 'vivid';
  const context = canvas.getContext('2d');
  if (!context) return;
  // Frigade's AnimatedDots: 1.5px pixels, 7px spacing, three held states.
  const dither = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const opacity = [0, .12, .4];
  let width = 0, height = 0, elapsed = 0, last = 0, frame = 0;
  let heroPoints = [], accent, gold;

  function paint() {
    context.clearRect(0, 0, width, height);
    const time = elapsed / 1000 * (hero && vivid ? 3 : 1);
    if (hero) {
      for (const point of heroPoints) {
        const wave = Math.sin(point.x * .018 + point.y * .065 + time * .20
          + .65 * Math.sin(point.x * .007 - point.y * .023 + time * .068));
        const state = Math.max(0, Math.min(2, wave * .85 + .68 + point.threshold));
        const lower = Math.floor(state), fraction = state - lower;
        const blend = fraction * fraction * (3 - 2 * fraction);
        const shade = opacity[lower] + (opacity[Math.min(2, lower + 1)] - opacity[lower]) * blend;
        context.fillStyle = point.gold ? gold : accent;
        context.globalAlpha = Math.min(1, point.strength * (.12 + .88 * shade / .4) * (1 + .3 * (shade / .4) ** 3) * (vivid ? 1.25 : 1));
        context.fillRect(point.x, point.y, vivid ? 2.8 : 2.4, vivid ? 2.8 : 2.4);
      }
      return;
    }
    for (let row = 0, y = 3; y < height; row++, y += 7) {
      for (let col = 0, x = 3; x < width; col++, x += 7) {
        const wave = Math.sin(x * .018 + y * .065 + time * .45
          + .65 * Math.sin(x * .007 - y * .023 + time * .15));
        const threshold = dither[(row % 4) * 4 + col % 4] / 16;
        const state = Math.max(0, Math.min(2, Math.floor(wave * .85 + .68 + threshold)));
        context.globalAlpha = opacity[state];
        context.fillRect(x, y, 1.5, 1.5);
      }
    }
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = getComputedStyle(canvas).color;
    if (hero) {
      const styles = getComputedStyle(canvas);
      accent = styles.getPropertyValue('--accent').trim();
      gold = styles.getPropertyValue('--pixel-gold').trim();
      const bounds = canvas.getBoundingClientRect();
      const software = canvas.parentElement.querySelector('.demo-stage').getBoundingClientRect();
      const left = software.left - bounds.left, right = software.right - bounds.left;
      heroPoints = [];
      for (let row = 0, y = 3; y < height; row++, y += 9) {
        for (let col = 0, x = 3; x < width; col++, x += 9) {
          const isLeft = x < width / 2;
          const distance = isLeft ? left - x : x - right;
          if (distance < -36) continue;
          const fullness = Math.max(0, Math.min(1, 1 - distance / Math.max(320, left + 30)));
          const spread = 14 + (vivid ? 82 : 68) * fullness ** 1.6;
          const center = height * (isLeft ? .6 : .57) + (isLeft ? -1 : 1) * (distance * .075 + 12 * Math.sin(distance * .015));
          const noise = Math.sin(col * 127.1 + row * 311.7) * 43758.5453;
          const grain = noise - Math.floor(noise);
          const edge = Math.min(1, y / 60, (height - y) / 60);
          const strength = .7 * Math.exp(-.5 * ((y - center) / spread) ** 2)
            * (.3 + .7 * fullness) * (.45 + .55 * grain) * edge;
          if (strength < .01) continue;
          heroPoints.push({ x, y, strength, gold: grain > .78,
            threshold: dither[(row % 4) * 4 + col % 4] / 16 });
        }
      }
    }
    paint();
  }

  function tick(now) {
    if (last) elapsed += Math.min(now - last, 64);
    last = now;
    paint();
    frame = requestAnimationFrame(tick);
  }

  function updatePlayback() {
    const active = canvas.dataset.playing === 'true'
      && canvas.dataset.inView === 'true' && canvas.dataset.hidden !== 'true';
    if (active && !frame) frame = requestAnimationFrame(tick);
    if (!active) {
      cancelAnimationFrame(frame);
      frame = last = 0;
    }
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  new MutationObserver(updatePlayback).observe(canvas, {
    attributes: true, attributeFilter: ['data-playing', 'data-in-view', 'data-hidden'],
  });
  updatePlayback();
});
