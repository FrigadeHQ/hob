const releaseRoot = 'https://github.com/FrigadeHQ/hob/releases/latest/download/';
const installers = { Mac: 'Hob-mac-arm64.dmg', Windows: 'Hob-windows-x64.exe', Linux: 'Hob-linux-x86_64.AppImage' };
const platformInfo = navigator.userAgentData?.platform || navigator.userAgent || '';
const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|CrOS/i.test(platformInfo) || (/Mac/i.test(platformInfo) && navigator.maxTouchPoints > 1);
const platform = mobile ? null : /Mac/i.test(platformInfo) ? 'Mac' : /Win/i.test(platformInfo) ? 'Windows' : /Linux/i.test(platformInfo) ? 'Linux' : null;
const downloadMenus = [...document.querySelectorAll('.alternate-downloads')];

document.querySelectorAll('[data-auto-download]').forEach(link => {
  link.href = platform ? releaseRoot + installers[platform] : '#download';
  if (!link.classList.contains('recommended-download')) return;
  link.hidden = !platform;
  if (platform) {
    link.querySelector('span').textContent = `Download for ${platform}`;
    link.querySelector('use').setAttribute('href', `#os-${platform.toLowerCase()}`);
  }
});
for (const menu of downloadMenus) {
  const summary = menu.querySelector('summary');
  if (!platform) {
    summary.classList.add('button');
    summary.querySelector('span').textContent = 'Download Hob';
  }
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { menu.open = false; summary.focus(); }
  });
}
document.addEventListener('click', event => {
  for (const menu of downloadMenus) {
    if (!menu.contains(event.target) || event.target.closest('.download-options a')) menu.open = false;
  }
});

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
if (!reduceMotion.matches && 'IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      if (!reduceMotion.matches && !target.matches(':focus-within')) target.classList.add('section-entered');
      sectionObserver.unobserve(target);
    });
  }, { rootMargin: '0px 0px -32px 0px' });
  document.querySelectorAll('.setup, .work-comparison, .trust-layout, .questions, .closing').forEach(section => sectionObserver.observe(section));
}
