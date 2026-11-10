// Runs before the page draws, so the colours someone picked show at once with no flash of the other theme.
// Light is the default; "ats.theme" = "dark" keeps the dark one (see src/lib/theme.ts, which changes it later).
(function () {
  var theme = 'light';
  try { if (localStorage.getItem('ats.theme') === 'dark') theme = 'dark'; } catch (e) { /* storage blocked: light */ }
  document.documentElement.setAttribute('data-theme', theme);
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', theme === 'dark' ? '#070B18' : '#F4F6FA');
})();
