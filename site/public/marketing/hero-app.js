(() => {
  const frame = document.querySelector('#hero-app');
  if (!frame) return;
  const fit = () => {
    frame.style.transform = `scale(${frame.parentElement.clientWidth / 1280})`;
  };
  new ResizeObserver(fit).observe(frame.parentElement);
  fit();
  let inView = false;
  const sync = () => frame.contentWindow?.postMessage({
    type: 'hob-demo-visibility', visible: inView && !document.hidden,
  }, '*');
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting && entry.intersectionRatio >= .2;
    sync();
  }, { threshold: [0, .2] }).observe(frame);
  frame.addEventListener('load', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('message', event => {
    if (event.source === frame.contentWindow && event.data?.type === 'hob-demo-ready') sync();
  });
})();
