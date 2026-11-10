const header = document.querySelector('[data-header]');
const revealItems = document.querySelectorAll('.reveal');

const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 18);
onScroll();
window.addEventListener('scroll', onScroll, {passive: true});

if ('IntersectionObserver' in window) {
  const observer = new window.IntersectionObserver(
    entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }),
    {threshold: 0.12},
  );
  revealItems.forEach(item => observer.observe(item));
} else {
  revealItems.forEach(item => item.classList.add('visible'));
}
