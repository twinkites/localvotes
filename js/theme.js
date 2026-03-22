// theme.js - loaded in <head> to set data-theme before first paint (prevents FOUC).
// Reads localStorage preference; falls back to system preference.
(function () {
  const saved = localStorage.getItem('lv-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
})();
