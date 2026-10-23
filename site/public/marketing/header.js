const siteHeader = document.querySelector('.site-header');
function updateHeaderDivider() {
  siteHeader.dataset.scrolled = String(window.scrollY > 0);
}
window.addEventListener('scroll', updateHeaderDivider, { passive: true });
updateHeaderDivider();
