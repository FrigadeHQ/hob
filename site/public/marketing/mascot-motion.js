const loop = document.querySelector('.circle-loop');
const toggle = document.querySelector('#circle-motion-toggle');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionElements = [loop, ...document.querySelectorAll('[data-motion-decoration]')];

function setPlaying(playing) {
  motionElements.forEach(element => { element.dataset.playing = String(playing); });
  if (toggle) {
    toggle.textContent = playing ? 'Pause motion' : 'Play motion';
    toggle.setAttribute('aria-pressed', String(playing));
  }
}

setPlaying(!reducedMotion.matches);
toggle?.addEventListener('click', () => setPlaying(loop.dataset.playing !== 'true'));
reducedMotion.addEventListener('change', event => {
  if (event.matches) setPlaying(false);
});
const motionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => { entry.target.dataset.inView = String(entry.isIntersecting); });
});
motionElements.forEach(element => motionObserver.observe(element));
function updateVisibility() {
  motionElements.forEach(element => { element.dataset.hidden = String(document.hidden); });
}
document.addEventListener('visibilitychange', updateVisibility);
updateVisibility();

Promise.all([...loop.querySelectorAll('img')].map(image => image.decode())).then(() => {
  loop.dataset.ready = 'true';
  if (toggle) toggle.disabled = false;
}).catch(() => {
  setPlaying(false);
  if (toggle) toggle.textContent = 'Motion unavailable';
});
