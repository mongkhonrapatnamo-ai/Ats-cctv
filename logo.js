// ats-cctv logo: the SVG mark, the word lockup and their animations.
// Mark = camera body (rounded square) + lens ring with a gap where the red REC light sits,
// a radar sweep inside the lens ("all the time" monitoring) and an iris that follows the pointer.
(function () {
  let uid = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function mark(cls = '') {
    const id = 'lm' + (++uid);
    return `<svg class="logo-mark ${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}r" x1="12" y1="10" x2="52" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22D3EE"/><stop offset=".55" stop-color="#3B82F6"/><stop offset="1" stop-color="#8B5CF6"/>
    </linearGradient>
    <radialGradient id="${id}i" cx="29.5" cy="29.5" r="9" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#C7E0FF"/><stop offset=".5" stop-color="#3B82F6"/><stop offset="1" stop-color="#1E2F7A"/>
    </radialGradient>
    <linearGradient id="${id}s" x1="32" y1="18" x2="44" y2="25" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22D3EE" stop-opacity="0"/><stop offset="1" stop-color="#22D3EE" stop-opacity=".55"/>
    </linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1A2340"/><stop offset="1" stop-color="#0B1022"/>
    </linearGradient>
  </defs>
  <rect class="lm-body" x="2" y="2" width="60" height="60" rx="18" fill="url(#${id}b)"/>
  <circle class="lm-lens" cx="32" cy="32" r="15" fill="#070B18"/>
  <g class="lm-sweep"><path d="M32 32 L32 18 A14 14 0 0 1 44.12 25 Z" fill="url(#${id}s)"/></g>
  <circle class="lm-ring" cx="32" cy="32" r="17" fill="none" stroke="url(#${id}r)" stroke-width="4" stroke-linecap="round"
    pathLength="100" stroke-dasharray="84 16" transform="rotate(-16.2 32 32)"/>
  <g class="lm-eye">
    <circle class="lm-iris" cx="32" cy="32" r="7.5" fill="url(#${id}i)"/>
    <circle class="lm-pupil" cx="32" cy="32" r="3.4" fill="#050814"/>
    <circle class="lm-glint" cx="29.6" cy="29.4" r="1.5" fill="#FFFFFF"/>
  </g>
  <circle class="lm-flash" cx="32" cy="32" r="17" fill="none" stroke="#FFFFFF" stroke-width="2"/>
  <circle class="lm-rec" cx="44.02" cy="19.98" r="3.6" fill="#F43F5E"/>
</svg>`;
  }

  function word() {
    const chars = (s, start) => [...s].map((c, i) => `<span class="ch" style="--i:${start + i}">${c}</span>`).join('');
    return `<span class="logo-word" aria-hidden="true">${chars('ats', 0)}<span class="lw-rec" style="--i:3"></span><span class="lw-cctv">${chars('cctv', 4)}</span></span>`;
  }

  // size: 'sm' (header), 'md', 'xl' (brand hero). tag adds the company line under the word.
  function lockup({ size = 'sm', tag = false, snap = false } = {}) {
    return `<span class="logo logo-${size}${snap ? ' can-snap' : ''}" role="img" aria-label="ats-cctv">
  ${mark()}
  <span class="logo-text">${word()}${tag ? '<span class="logo-tag">ALL THE TIME SERVICES</span>' : ''}</span>
</span>`;
  }

  function replay(el) {
    if (!el || reduce.matches) return;
    el.classList.remove('is-intro');
    void el.offsetWidth;
    el.classList.add('is-intro');
    clearTimeout(el._introTimer);
    el._introTimer = setTimeout(() => el.classList.remove('is-intro'), 2200);
  }

  function snap(el) {
    const m = el.closest('.logo-mark') || el.querySelector('.logo-mark');
    if (!m) return;
    m.classList.remove('is-snap');
    void m.getBoundingClientRect();
    m.classList.add('is-snap');
    setTimeout(() => m.classList.remove('is-snap'), 650);
  }

  // Eye tracking: every visible mark looks toward the pointer. After a few idle
  // seconds (or on touch screens) the marks scan left and right on their own.
  let px = null, py = null, queued = false, idleTimer = null;
  function track() {
    queued = false;
    document.querySelectorAll('.logo-mark').forEach(svg => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(3.4, d / 50);
      svg.style.setProperty('--ex', (dx / d * reach).toFixed(2) + 'px');
      svg.style.setProperty('--ey', (dy / d * reach).toFixed(2) + 'px');
    });
  }
  function setIdle(on) {
    document.documentElement.classList.toggle('logo-idle', on);
  }
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    px = e.clientX; py = e.clientY;
    setIdle(false);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setIdle(true), 3500);
    if (!queued) { queued = true; requestAnimationFrame(track); }
  }, { passive: true });
  setIdle(true);

  window.ATSLogo = { mark, lockup, replay, snap };
})();
