// ATS-CCTV Service Hub prototype: hash router, views and interactions.
// Starts empty (a fresh install): people add customers, tickets, assets, stock, contracts and PM themselves.
// Records are shared through the artifact's database when the page runs on claude.ai, otherwise kept in this browser.
(function () {
  const D = window.ATS_DATA;
  const L = window.ATSLogo;
  const view = document.getElementById('view');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<i data-lucide="${n}"></i>`;
  const fmt = n => (+n || 0).toLocaleString('th-TH');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SEV_RANK = { crit: 0, high: 1, med: 2, low: 3 };
  const HUES = ['blue', 'violet', 'teal', 'orange', 'pink', 'green', 'amber', 'slate'];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ats.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ats.' + k, JSON.stringify(v)); } catch { /* storage blocked: keep going without it */ } }
  };
  function refreshIcons() {
    if (!window.lucide) return;
    const opts = { attrs: { 'stroke-width': 1.9 } };
    if (lucide.icons) opts.icons = lucide.icons;
    lucide.createIcons(opts);
  }
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  // time: everything is stored as epoch ms or ISO dates (YYYY-MM-DD); th-TH prints Buddhist years
  const DAY = 864e5, HOUR = 36e5;
  const now = () => Date.now();
  const pad = n => String(n).padStart(2, '0');
  const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayStart = (ms = now()) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const parseDay = iso => iso ? new Date(iso + 'T00:00').getTime() : NaN;
  const hm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dateTH = (ms, o = { day: 'numeric', month: 'short', year: 'numeric' }) => isNaN(ms) || ms == null ? '—' : new Date(ms).toLocaleDateString('th-TH', o);
  const shortDay = ms => dateTH(ms, { day: 'numeric', month: 'short' });
  const whenText = ms => { const d = dayStart(ms), t = dayStart(); return d === t ? `วันนี้ ${hm(ms)}` : d === t - DAY ? `เมื่อวาน ${hm(ms)}` : `${shortDay(ms)} ${hm(ms)}`; };
  const dur = ms => { const m = Math.max(0, Math.round(ms / 6e4)); return m < 60 ? `${m} นาที` : m < 2880 ? `${Math.floor(m / 60)}:${pad(m % 60)} ชม.` : `${Math.round(m / 1440)} วัน`; };
  const daysLeft = iso => Math.round((parseDay(iso) - dayStart()) / DAY);
  const addDays = (iso, n) => { const d = new Date(parseDay(iso)); d.setDate(d.getDate() + n); return isoDay(d); };
  const addYears = (iso, n) => { const d = new Date(parseDay(iso)); d.setFullYear(d.getFullYear() + n); return isoDay(d); };
  const monthKey = ms => { const d = new Date(ms); return d.getFullYear() * 12 + d.getMonth(); };
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'; };

  // ---------- records ----------
  // One array per collection. Views read R directly; every change goes through Store.put / Store.del.
  const COLS = ['tickets', 'customers', 'assets', 'moves', 'parts', 'orders', 'quotes', 'contracts', 'pm', 'techs', 'config'];
  const R = Object.fromEntries(COLS.map(c => [c, []]));
  const Store = (() => {
    const KEY = 'ats.records.v1';
    let db = null, mode = 'loading', onChange = () => {}, warned = false;
    const clone = o => JSON.parse(JSON.stringify(o));
    function loadLocal() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
      const base = saved || { techs: clone(D.seed.techs) };
      COLS.forEach(c => { R[c] = Array.isArray(base[c]) ? base[c] : []; });
    }
    function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(R)); } catch { /* full or blocked: the session keeps working in memory */ } }
    function fail(e) {
      const code = e && e.code;
      if (code === 'invalid_argument') toast('บัญชีนี้ดูได้อย่างเดียว บันทึกข้อมูลไม่ได้', 'lock');
      else if (code === 'quota_exceeded') toast('พื้นที่เก็บข้อมูลเต็ม ลบข้อมูลทดสอบเก่าออกก่อน', 'triangle-alert');
      else toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'triangle-alert');
    }
    // one retry for a transient outage; false when the store refused the write
    async function attempt(run) {
      try { await run(); return true; }
      catch (e) {
        if (e && e.code === 'unavailable') { await new Promise(f => setTimeout(f, 400 + Math.random() * 600)); try { await run(); return true; } catch (e2) { fail(e2); return false; } }
        fail(e); return false;
      }
    }
    // writes show at once; a refused write puts the collection back to the last copy the store sent, then throws
    const base = {};
    async function put(c, rec) {
      rec.updatedAt = now();
      const i = R[c].findIndex(x => x.id === rec.id);
      if (i >= 0) R[c][i] = rec; else R[c].push(rec);
      if (mode !== 'db') { saveLocal(); return; }
      const { id, ...body } = rec;
      if (!(await attempt(() => db.collection(c).doc(id).set(clone(body))))) { R[c] = clone(base[c] || []); throw new Error('write refused'); }
    }
    async function del(c, id) {
      R[c] = R[c].filter(x => x.id !== id);
      if (mode !== 'db') { saveLocal(); return; }
      if (!(await attempt(() => db.collection(c).doc(id).delete()))) { R[c] = clone(base[c] || []); throw new Error('delete refused'); }
    }
    // subscribe once per collection; the first full round of snapshots ends the loading screen
    function subscribe() {
      const got = new Set();
      const timer = setTimeout(() => { if (got.size < COLS.length) { warned = true; onChange(true); toast('ยังโหลดข้อมูลไม่ครบ ข้อมูลที่เห็นอาจยังไม่ล่าสุด', 'wifi-off'); } }, 10000);
      COLS.forEach(c => db.collection(c).onSnapshot(snap => {
        R[c] = snap.docs.map(d => ({ ...clone(d.data()), id: d.id }));
        base[c] = clone(R[c]);
        const firstRound = got.size < COLS.length;
        got.add(c);
        if (got.size === COLS.length && firstRound) { clearTimeout(timer); onChange(true); }
        else if (got.size === COLS.length) onChange(false);
      }, e => {
        got.add(c);
        if (e && e.code === 'revoked') toast('สิทธิ์เข้าถึงข้อมูลถูกเปลี่ยน', 'lock');
        if (got.size === COLS.length) { clearTimeout(timer); onChange(true); }
      }));
    }
    async function start(cb) {
      onChange = cb;
      const use = window.claude && typeof window.claude.use === 'function' ? window.claude.use('db') : null;
      if (!use) { mode = 'local'; loadLocal(); cb(true); return; }
      cb(true); // paints the loading state
      try { db = await use; } catch { db = null; }
      if (!db) { mode = 'local'; loadLocal(); cb(true); return; }
      mode = 'db';
      subscribe();
    }
    return { put, del, start, get mode() { return mode; }, get partial() { return warned; } };
  })();

  // lookups that never throw on a missing record
  const NOCUST = { id: '', name: 'ไม่ระบุลูกค้า', contact: '', phone: '', addr: '', sites: [] };
  const cust = id => R.customers.find(c => c.id === id) || NOCUST;
  const tech = id => R.techs.find(t => t.id === id);
  const ticket = id => R.tickets.find(t => t.id === id);
  const asset = id => R.assets.find(a => a.id === id);
  const cfg = () => R.config.find(x => x.id === 'settings') || {};
  const slaH = s => (cfg().sla || {})[s] || D.severities[s].sla;
  const me = () => store.get('me', 'ธีรวัฒน์');
  const isDone = t => t.status === 'เสร็จสิ้น';
  const openTickets = () => R.tickets.filter(t => !isDone(t));
  const contractOf = id => R.contracts.filter(m => m.cust === id && daysLeft(m.end) >= 0).sort((a, b) => a.end.localeCompare(b.end))[0];
  const reach = c => c.phone || 'ยังไม่มีเบอร์โทร';
  // SLA from the due time stamped when the ticket was opened
  function sla(t) {
    const win = Math.max(1, t.dueAt - t.createdAt);
    if (isDone(t)) { const late = (t.closedAt || now()) - t.dueAt; return { done: true, over: late > 0, pct: 0, text: late > 0 ? `ปิดช้า ${dur(late)}` : 'ปิดทันเวลา' }; }
    const left = t.dueAt - now();
    return left < 0 ? { over: true, pct: 100, text: `เกิน ${dur(-left)}` } : { over: false, pct: clamp((now() - t.createdAt) / win * 100, 2, 99), text: `เหลือ ${dur(left)}` };
  }
  const overSla = () => openTickets().filter(t => sla(t).over);
  // a technician is busy while any of their open jobs is under way
  const techState = k => k.leave ? 'leave' : R.tickets.some(t => t.tech === k.id && !isDone(t) && (t.stage >= 1 || t.status === 'กำลังดำเนินการ')) ? 'busy' : 'free';
  const STATE_TEXT = { busy: 'ปฏิบัติงาน', free: 'ว่าง', leave: 'ลา' };
  // what should happen next on a ticket
  function nextStep(t) {
    if (isDone(t)) return ['ปิดงานแล้ว', t.resolution || 'เรียบร้อย'];
    if (!t.tech) return ['มอบหมายช่าง', 'ยังไม่มีช่างรับงาน'];
    if (t.status === 'รออนุมัติ') return ['รอลูกค้าอนุมัติ', 'ส่งใบเสนอราคาก่อนเข้าซ่อม'];
    if (t.status === 'รออะไหล่') return ['ตามอะไหล่', 'ดูใบขอซื้อในหน้าสต็อก'];
    if (t.status === 'รอตรวจรับ') return ['ให้ลูกค้าตรวจรับ', 'แล้วกดปิดงาน'];
    if (sla(t).over) return ['เกิน SLA แล้ว', 'แจ้งลูกค้าและเร่งเข้าหน้างาน'];
    return [['ช่างออกเดินทาง', 'แจ้งถึงหน้างาน', 'เริ่มซ่อม', 'ปิดงาน'][clamp(t.stage || 0, 0, 3)], `นัด ${t.date ? shortDay(parseDay(t.date)) : '—'} · ${t.slot || ''}`];
  }

  const sevPill = s => `<span class="pill t-${s}">${D.severities[s].label}</span>`;
  const stPill = st => `<span class="pill t-${(D.statuses[st] || { tone: 'info' }).tone}">${esc(st)}</span>`;
  const av = (t, cls = '') => t ? `<span class="av av-${t.hue || 'blue'} ${cls}" title="${esc(t.name)}">${esc(t.initial || t.name.slice(0, 1))}</span>` : `<span class="av av-none ${cls}" title="ยังไม่มอบหมาย">?</span>`;
  const typeTag = k => `<span class="tag">${icon(D.types[k].icon)}${D.types[k].short}</span>`;
  const slaCell = t => { const s = sla(t); return `<div class="sla${s.over ? ' over' : ''}"><span>${s.text}</span>${s.done ? '' : `<div class="meter"><i style="width:${s.pct}%"></i></div>`}</div>`; };
  const seg = (key, opts, cur, cls = '') => `<div class="seg ${cls}" data-key="${key}" role="group"><span class="seg-thumb"></span>${opts.map(([v, label]) => `<button type="button" class="seg-btn" data-act="seg" data-v="${v}" aria-pressed="${v === cur}">${label}</button>`).join('')}</div>`;
  const demoBtn = (label, ic, cls = '') => `<button type="button" class="btn ${cls}" data-act="demo" data-v="${esc(label)}">${ic ? icon(ic) : ''}${label}</button>`;
  const actBtn = (act, label, ic, cls = '', v = '') => `<button type="button" class="btn ${cls}" data-act="${act}"${v !== '' ? ` data-v="${esc(v)}"` : ''}>${ic ? icon(ic) : ''}${label}</button>`;
  const emptyBox = (ic, title, sub, actions = '') => `<div class="empty">${icon(ic)}<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${actions ? `<div class="btn-row" style="justify-content:center">${actions}</div>` : ''}</div>`;

  // ---------- state (per view, not saved) ----------
  const SLOTS = ['08:00–12:00', '13:00–16:00', '16:00–18:00', 'ด่วน · เข้าทันที'];
  const blankForm = () => ({
    cust: R.customers[0]?.id || '__new', newName: '', newAddr: '', site: '', reporter: '', phone: '', channel: 'โทรศัพท์', email: '',
    type: 'cctv', asset: '', subject: '', detail: '', sev: 'med', date: isoDay(), slot: SLOTS[0], tech: R.techs.find(k => !k.leave)?.id || '',
    coord: me(), notify: false, quote: false, note: '', consent: false
  });
  const S = {
    skin: store.get('skin', null),
    period: 'month', homeTab: 'open',
    listTab: 'all', listType: 'all', listSev: 'all', listTech: 'all', listQuery: '', listMode: store.get('listMode', 'table'),
    listPage: 1, listPer: 10, listSort: 'desc', selected: new Set(),
    tone: 'polite',
    form: null, formSec: 0, files: [],
    pmDay: null, pmMonth: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); })(),
    assetTab: 'register', assetFilter: 'all', snaps: 0, route: null,
    camSite: '', trackSel: '', maFilter: 'all', custTab: 'list', priceTab: 'cctv',
    notify: store.get('notify', { line: true, sms: false, email: false, sound: true }),
    hideSetup: store.get('hideSetup', false)
  };

  // ---------- skins ----------
  const SKINS = [['light', 'สว่าง'], ['night', 'กลางคืน'], ['aurora', 'ออโรร่า']];
  function hostDark() {
    const t = document.documentElement.dataset.theme;
    return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  const effectiveSkin = () => S.skin || (hostDark() ? 'night' : 'light');
  function applySkin() {
    if (S.skin) document.documentElement.dataset.skin = S.skin;
    else delete document.documentElement.dataset.skin;
    $$('.skin-card').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === effectiveSkin()));
    const segEl = $('#skin-seg');
    if (!segEl) return;
    $$('.seg-btn', segEl).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === effectiveSkin()));
    Seg.place(segEl, true);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!S.skin) applySkin(); });
  new MutationObserver(() => { if (!S.skin) applySkin(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- segmented controls: the thumb hops like the dock ball ----------
  const Seg = {
    place(el, animate) {
      const th = $('.seg-thumb', el);
      const btn = $('[aria-pressed="true"], [aria-current="step"]', el);
      if (!th) return;
      if (!btn || !btn.offsetWidth) { th.style.opacity = btn ? '' : 0; return; }
      th.style.opacity = '';
      const x = btn.offsetLeft, w = btn.offsetWidth;
      const px = th.dataset.x != null ? +th.dataset.x : x, pw = th.dataset.w != null ? +th.dataset.w : w;
      th.dataset.x = x; th.dataset.w = w;
      th.style.width = w + 'px';
      th.style.transform = `translateX(${x}px)`;
      if (animate && !reduce.matches && px !== x) {
        const mw = Math.max(pw, w) + Math.abs(x - px) * 0.18;
        const mx = (px + x) / 2 - (mw - (pw + w) / 2) / 2;
        th.animate([
          { transform: `translateX(${px}px)`, width: pw + 'px' },
          { transform: `translate(${mx}px, -5px) scaleY(.88)`, width: mw + 'px', offset: .45 },
          { transform: `translateX(${x}px) scaleY(1.08)`, width: w + 'px', offset: .78 },
          { transform: `translateX(${x}px)`, width: w + 'px' }
        ], { duration: 540, easing: 'cubic-bezier(.3,.7,.2,1)' });
      }
    },
    all(root = document) { $$('.seg, .stepper', root).forEach(s => Seg.place(s, false)); }
  };

  // ---------- navigation ----------
  // Desktop: a vertical rail. The active item rides a ball that sits in a notch cut into the rail's left edge
  // (the Floating Notch tab bar turned on its side). Hovering the rail widens it to show every name.
  // Phones and touch tablets: the bottom dock, plus the same rail opened as a drawer from the "เมนู" button.
  const NAV = [
    ['ภาพรวม', [['overview', 'ภาพรวม', 'house'], ['command', 'Command Center', 'radar']]],
    ['งานบริการ', [['tickets', 'ใบแจ้งซ่อม', 'wrench'], ['track', 'ติดตามงาน', 'route'], ['pm', 'งาน PM / ปฏิทินงาน', 'calendar-check'], ['ma', 'สัญญาบริการรายปี (MA)', 'file-text']]],
    ['ทรัพย์สิน & คลัง', [['cameras', 'กล้อง CCTV & อุปกรณ์', 'cctv'], ['assets', 'ทะเบียนทรัพย์สิน', 'server'], ['stock', 'สต็อกอะไหล่ & จัดซื้อ', 'package']]],
    ['ลูกค้า & รายงาน', [['customers', 'ลูกค้า & สาขา', 'building-2'], ['reports', 'รายงาน & KPI', 'chart-column']]],
    ['ระบบ', [['settings', 'ตั้งค่า', 'sliders-horizontal'], ['help', 'ช่วยเหลือ', 'circle-help']]]
  ];
  const NAV_ICON = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, , ic]) => [k, ic])));
  const NAV_OF = { detail: 'tickets', new: 'tickets', tv: 'command', brand: null };
  const compact = matchMedia('(max-width: 760px), (hover: none) and (max-width: 1180px)');
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const Rail = (() => {
    const el = $('#rail'), list = $('#rail-list'), bar = $('.rail-bar', el), ball = $('.rail-ball', el), inner = $('.ball-inner', ball);
    const stroke = $('.rail-stroke', el), shadow = $('.rail-shadow', el), svgs = $$('.rail-svg', el);
    list.innerHTML = '<span class="rail-focus" aria-hidden="true"><i></i></span>' + NAV.map(([g, items], gi) =>
      `<div class="rail-group${gi ? '' : ' first'}"><span>${g}</span></div>` + items.map(([k, label, ic]) =>
        `<a class="rail-item" href="#${k}" data-nav="${k}"><span class="ri-icon">${icon(ic)}</span><span class="ri-label">${label}</span><span class="ri-badge" hidden></span></a>`).join('')).join('');
    const items = $$('.rail-item', list), keys = items.map(it => it.dataset.nav), focus = $('.rail-focus', list);
    const R = 24, BX = 11, DEPTH = 37, HALF = 34;
    let idx = -2, cur = { y: 0, d: 0 }, raf = 0, ballIcon = '';

    const centerY = it => list.offsetTop + it.offsetTop + it.offsetHeight / 2 - list.scrollTop;
    const f = n => n.toFixed(1);
    function path(W, H, y, d) {
      const a = Math.min(H - R, y + HALF), b = Math.max(R, y - HALF);
      const side = d < .5 ? `V${R}`
        : `V${f(a)}C0 ${f(y + (a - y) * .5)} ${f(d)} ${f(y + (a - y) * .52)} ${f(d)} ${f(y)}C${f(d)} ${f(y - (y - b) * .52)} 0 ${f(y - (y - b) * .5)} 0 ${f(b)}V${R}`;
      return `M${R} 0H${W - R}A${R} ${R} 0 0 1 ${W} ${R}V${H - R}A${R} ${R} 0 0 1 ${W - R} ${H}H${R}A${R} ${R} 0 0 1 0 ${H - R}${side}A${R} ${R} 0 0 1 ${R} 0Z`;
    }
    function draw(y, x, d) {
      const W = el.offsetWidth, H = el.offsetHeight;
      if (!W || !H) return;
      // in the scrolling phone drawer the active item can be out of view: close the notch and hide the ball
      const inView = y > R && y < H - R;
      ball.style.opacity = inView ? '' : 0;
      if (!inView) d = 0;
      const p = path(W, H, y, d), B = ball.offsetWidth;
      bar.style.clipPath = `path('${p}')`;
      stroke.setAttribute('d', p);
      shadow.setAttribute('d', p);
      svgs.forEach(s => s.setAttribute('viewBox', `0 0 ${W} ${H}`));
      ball.style.transform = `translate(${f(x - B / 2)}px, ${f(y - B / 2)}px)`;
    }
    function setIcon(name) { ballIcon = name; inner.innerHTML = icon(name); refreshIcons(); }
    function go(key, animate) {
      const i = keys.indexOf(key);
      items.forEach((it, k) => { it.classList.toggle('is-active', k === i); if (k === i) it.setAttribute('aria-current', 'page'); else it.removeAttribute('aria-current'); });
      if (i === idx) return;
      const ys = items.map(centerY), prev = idx;
      idx = i;
      const from = prev >= 0 ? ys[prev] : (i >= 0 ? ys[i] : cur.y), to = i >= 0 ? ys[i] : cur.y;
      const fromD = prev >= 0 ? DEPTH : 0, toD = i >= 0 ? DEPTH : 0;
      ball.classList.toggle('is-hidden', i < 0);
      if (i >= 0 && prev < 0) setIcon(NAV_ICON[key]);
      cancelAnimationFrame(raf);
      if (!animate || reduce.matches) {
        inner.style.transition = 'none';
        requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transition = ''; }));
        if (i >= 0) setIcon(NAV_ICON[key]);
        cur = { y: to, d: toD }; draw(to, BX, toD); return;
      }
      const dy = to - from, dur = Math.min(760, 480 + Math.abs(dy) * .5), hop = 7 + Math.min(7, Math.abs(dy) * .03);
      let swapped = i < 0 || prev < 0;
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / dur), e = ease(t);
        const y = from + dy * e, base = fromD + (toD - fromD) * e;
        const depth = i >= 0 && prev >= 0 ? base * (1 - .55 * Math.sin(Math.PI * t)) : base;
        cur = { y, d: depth };
        draw(y, BX - (i >= 0 ? hop * Math.sin(Math.PI * t) : 0), depth);
        if (!swapped && t >= .5) { swapped = true; setIcon(NAV_ICON[key]); }
        if (t < 1) raf = requestAnimationFrame(step);
        else { raf = 0; if (i >= 0) inner.animate([{ transform: 'scale(.84, 1.16)' }, { transform: 'scale(1.05, .95)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' }); }
      };
      raf = requestAnimationFrame(step);
    }
    function redraw() { if (raf) return; if (idx >= 0) cur.y = centerY(items[idx]); draw(cur.y, BX, cur.d); }

    // camera-focus hover: viewfinder brackets glide to the item under the pointer and lock on
    function aim(it) {
      items.forEach(x => x.classList.toggle('is-aim', x === it));
      if (!it) { focus.classList.remove('on'); return; }
      const fresh = !focus.classList.contains('on');
      if (fresh) focus.style.transition = 'none';
      focus.style.transform = `translateY(${it.offsetTop}px)`;
      focus.style.height = it.offsetHeight + 'px';
      if (fresh) { void focus.offsetWidth; focus.style.transition = ''; }
      focus.classList.add('on');
      if (!reduce.matches) {
        $('i', focus).animate([{ transform: 'scale(1.16, 1.3)', opacity: 0 }, { transform: 'scale(.97)', opacity: 1, offset: .65 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
        focus.classList.remove('scan'); void focus.offsetWidth; focus.classList.add('scan');
      }
    }
    list.addEventListener('pointerover', e => { const it = e.target.closest('.rail-item'); if (it && !it.classList.contains('is-aim')) aim(it); });
    list.addEventListener('pointerleave', () => aim(null));
    list.addEventListener('focusin', e => { const it = e.target.closest('.rail-item'); if (it) aim(it); });
    list.addEventListener('scroll', redraw, { passive: true });

    // widen on hover (mouse) or keyboard focus; the page underneath stays where it is
    let tOpen = 0, tClose = 0;
    const setOpen = on => el.classList.toggle('is-open', on);
    el.addEventListener('pointerenter', e => { if (compact.matches || e.pointerType !== 'mouse') return; clearTimeout(tClose); tOpen = setTimeout(() => setOpen(true), 80); });
    el.addEventListener('pointerleave', () => { if (compact.matches) return; clearTimeout(tOpen); tClose = setTimeout(() => setOpen(false), 160); });
    el.addEventListener('focusin', () => { if (!compact.matches) setOpen(true); });
    el.addEventListener('focusout', e => { if (!compact.matches && !el.contains(e.relatedTarget) && !el.matches(':hover')) setOpen(false); });

    function drawer(on) {
      el.classList.toggle('is-drawer', on);
      setOpen(on);
      $('#scrim').hidden = !on;
      if (on) setTimeout(() => {
        const it = items[idx] || items[0];
        list.scrollTop = it.offsetTop - list.clientHeight / 2;
        it.focus({ preventScroll: true });
        redraw();
      }, 60);
    }
    list.addEventListener('click', e => { if (compact.matches && e.target.closest('.rail-item')) drawer(false); });
    new ResizeObserver(redraw).observe(el);
    function badges(map) { items.forEach(it => { const b = $('.ri-badge', it), n = map[it.dataset.nav]; b.hidden = !n; b.textContent = n || ''; }); }
    return { go, redraw, drawer, badges, isDrawer: () => el.classList.contains('is-drawer') };
  })();

  // bottom dock for phones: same hop, horizontal
  const Dock = (() => {
    const el = $('#dock'), bar = $('.dock-bar', el), ball = $('.dock-ball', el), inner = $('.ball-inner', el);
    const items = $$('.dock-item', el), stroke = $('.dock-stroke', el), shadow = $('.dock-shadow', el), svgs = $$('.dock-svg', el);
    const H = 70, R = 24, BALL = 54, BASE_Y = -4, DEPTH = 34, HALF = 50;
    let idx = -2, cur = { x: 0, d: 0 }, raf = 0, ballIcon = '';

    const centers = () => { const r0 = el.getBoundingClientRect(); return items.map(it => { const r = it.getBoundingClientRect(); return r.left - r0.left + r.width / 2; }); };
    function path(W, x, d) {
      const top = d < .5
        ? `H${W - R}`
        : `H${Math.max(R, x - HALF)}C${x - HALF * .5} 0 ${x - HALF * .52} ${d} ${x} ${d}C${x + HALF * .52} ${d} ${x + HALF * .5} 0 ${Math.min(W - R, x + HALF)} 0H${W - R}`;
      return `M0 ${R}A${R} ${R} 0 0 1 ${R} 0${top}A${R} ${R} 0 0 1 ${W} ${R}V${H - R}A${R} ${R} 0 0 1 ${W - R} ${H}H${R}A${R} ${R} 0 0 1 0 ${H - R}Z`;
    }
    function draw(x, y, d) {
      const W = el.clientWidth;
      if (!W) return;
      const p = path(W, x, d);
      bar.style.clipPath = `path('${p}')`;
      stroke.setAttribute('d', p);
      shadow.setAttribute('d', p);
      svgs.forEach(s => s.setAttribute('viewBox', `0 0 ${W} ${H}`));
      ball.style.transform = `translate(${(x - BALL / 2).toFixed(1)}px, ${(y - BALL / 2).toFixed(1)}px)`;
    }
    function setIcon(name) { ballIcon = name; inner.innerHTML = icon(name); refreshIcons(); }
    // i: dock slot, or -1 to hide the ball. ic: icon shown in the ball (the "เมนู" slot shows the current page's icon)
    function go(i, animate, ic) {
      items.forEach((it, k) => { it.classList.toggle('is-active', k === i); if (k === i && it.tagName === 'A') it.setAttribute('aria-current', 'page'); else it.removeAttribute('aria-current'); });
      ic = ic || (i >= 0 ? items[i].dataset.icon : '');
      if (i === idx) { if (ic && ic !== ballIcon) setIcon(ic); return; }
      const xs = centers(), prev = idx;
      idx = i;
      const from = prev >= 0 ? xs[prev] : (i >= 0 ? xs[i] : cur.x);
      const to = i >= 0 ? xs[i] : cur.x;
      const fromD = prev >= 0 ? DEPTH : 0, toD = i >= 0 ? DEPTH : 0;
      ball.classList.toggle('is-hidden', i < 0);
      if (i >= 0 && prev < 0) setIcon(ic);
      cancelAnimationFrame(raf);
      if (!animate || reduce.matches || !el.offsetWidth) {
        inner.style.transition = 'none';
        requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transition = ''; }));
        if (i >= 0) setIcon(ic);
        cur = { x: to, d: toD }; draw(to, BASE_Y, toD); return;
      }
      const dx = to - from, dur = Math.min(780, 500 + Math.abs(dx) * 0.55), hop = 16 + Math.min(26, Math.abs(dx) * 0.09);
      let swapped = i < 0 || prev < 0;
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / dur), e = ease(t);
        const x = from + dx * e;
        const base = fromD + (toD - fromD) * e;
        const depth = i >= 0 && prev >= 0 ? base * (1 - .55 * Math.sin(Math.PI * t)) : base;
        const lift = i >= 0 ? hop * Math.sin(Math.PI * t) : 0;
        cur = { x, d: depth };
        draw(x, BASE_Y - lift, depth);
        if (!swapped && t >= .5) { swapped = true; setIcon(ic); }
        if (t < 1) raf = requestAnimationFrame(step);
        else if (i >= 0) inner.animate([{ transform: 'scale(1.16, .84)' }, { transform: 'scale(.95, 1.05)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      };
      raf = requestAnimationFrame(step);
    }
    function redraw() { if (idx >= 0) cur.x = centers()[idx]; draw(cur.x, BASE_Y, cur.d); }
    function ripple(it) {
      if (reduce.matches) return;
      const r0 = el.getBoundingClientRect(), r = it.getBoundingClientRect();
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.left = (r.left - r0.left + r.width / 2) + 'px';
      s.style.top = '26px';
      el.append(s);
      setTimeout(() => s.remove(), 650);
    }
    el.addEventListener('click', e => { const it = e.target.closest('.dock-item'); if (it) ripple(it); });
    addEventListener('resize', redraw);
    return { go, redraw };
  })();
  compact.addEventListener('change', () => { Rail.drawer(false); Rail.redraw(); Dock.redraw(); });

  // ---------- shared pieces ----------
  const bySev = (a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.dueAt - b.dueAt;
  const firstOfMonth = (off = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + off, 1).getTime(); };
  const PERIODS = {
    today: ['วันนี้', () => dayStart()],
    week: ['7 วันล่าสุด', () => dayStart() - 6 * DAY],
    month: ['เดือนนี้', () => firstOfMonth()],
    year: ['ปีนี้', () => new Date(new Date().getFullYear(), 0, 1).getTime()]
  };
  function stats(from) {
    const closed = R.tickets.filter(t => isDone(t) && t.closedAt >= from), rated = closed.filter(t => t.rating);
    const hrs = closed.map(t => (t.closedAt - t.createdAt) / HOUR);
    return {
      created: R.tickets.filter(t => t.createdAt >= from).length, closed: closed.length, ontimeN: closed.filter(t => t.closedAt <= t.dueAt).length,
      mttr: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
      ontime: closed.length ? closed.filter(t => t.closedAt <= t.dueAt).length / closed.length * 100 : null,
      sat: rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : null, reviews: rated.length
    };
  }
  const one = v => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('th-TH');
  const pmIn = (from, to) => R.pm.filter(p => { const d = parseDay(p.date); return d >= from && d < to; });
  const pmSoon = () => pmIn(dayStart(), dayStart() + 7 * DAY).filter(p => !p.done).sort((a, b) => a.date.localeCompare(b.date));
  const lowParts = () => R.parts.filter(p => +p.qty < +p.min);
  const maSoon = () => R.contracts.filter(m => { const d = daysLeft(m.end); return d >= 0 && d <= 60; }).sort((a, b) => a.end.localeCompare(b.end));
  const cams = () => R.assets.filter(a => a.type === 'cctv');
  function camSites() {
    const by = {};
    cams().forEach(a => { (by[a.cust] = by[a.cust] || []).push(a); });
    return Object.entries(by).map(([id, list]) => ({ cust: id, name: cust(id).name, cams: list.length, off: list.filter(a => a.status === 'offline').length, ...spot(id) }));
  }
  // a stable made-up position for a customer on the radar and the map (no GPS yet)
  function spot(id) {
    const h = hash(id);
    let x = 12 + h % 76, y = 14 + (h >>> 7) % 72;
    if (Math.abs(x - 50) < 10 && Math.abs(y - 50) < 10) x += x < 50 ? -14 : 14;
    return { x, y };
  }
  function techStats(k, from) {
    const closed = R.tickets.filter(t => t.tech === k.id && isDone(t) && t.closedAt >= from), rated = closed.filter(t => t.rating);
    return { closed: closed.length, ontime: closed.length ? Math.round(closed.filter(t => t.closedAt <= t.dueAt).length / closed.length * 100) : null, score: rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : null };
  }

  function ringSVG(v, id, i) {
    const C = 2 * Math.PI * 31;
    return `<svg viewBox="0 0 74 74" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--r${i}a)"/><stop offset="1" style="stop-color:var(--r${i}b)"/></linearGradient></defs>
      <circle class="track" cx="37" cy="37" r="31" fill="none" stroke-width="8"/>
      <circle class="bar" cx="37" cy="37" r="31" fill="none" stroke="url(#${id})" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}" data-to="${(C * (1 - v / 100)).toFixed(2)}"/></svg>`;
  }
  function fillRings(root = view) {
    requestAnimationFrame(() => requestAnimationFrame(() => $$('circle.bar[data-to]', root).forEach(c => c.setAttribute('stroke-dashoffset', c.dataset.to))));
  }
  function rings() {
    const m = firstOfMonth(), s = stats(m), plan = pmIn(m, firstOfMonth(1)), done = plan.filter(p => p.done).length;
    const c = cams(), on = c.filter(a => a.status === 'online').length, made = R.tickets.filter(t => t.createdAt >= m), shut = made.filter(isDone).length;
    return [
      { label: 'PM ตามแผน', v: plan.length ? done / plan.length * 100 : null, note: plan.length ? `เสร็จ ${done} จาก ${plan.length} งาน` : 'ยังไม่มีแผน PM เดือนนี้' },
      { label: 'ผ่าน SLA', v: s.ontime, note: s.closed ? `ปิดทันเวลา ${s.ontimeN} จาก ${s.closed} งาน` : 'ยังไม่มีงานที่ปิด' },
      { label: 'กล้องออนไลน์', v: c.length ? on / c.length * 100 : null, note: c.length ? `${on} จาก ${c.length} ตัว` : 'ยังไม่มีกล้องในทะเบียน' },
      { label: 'ปิดงานได้', v: made.length ? shut / made.length * 100 : null, note: made.length ? `ปิด ${shut} จาก ${made.length} งานที่เข้าเดือนนี้` : 'ยังไม่มีงานเข้าเดือนนี้' }
    ];
  }
  const ringsHTML = pre => `<div class="rings">${rings().map((r, i) => `<div class="ring inner"><div class="ring-box">${ringSVG(r.v || 0, pre + i, i + 1)}<span class="ring-pct">${r.v == null ? '—' : one(r.v) + '%'}</span></div><div><div class="ring-label">${r.label}</div><div class="ring-note">${r.note}</div></div></div>`).join('')}</div>`;

  // ---------- charts ----------
  function smooth(pts) {
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }
  const niceMax = v => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p; };
  const ticks = max => [0, .25, .5, .75, 1].map(f => f * max).filter(Number.isInteger);
  // the last 12 months, this month last
  function series() {
    const d = new Date(), ms = [...Array(12)].map((_, i) => new Date(d.getFullYear(), d.getMonth() - 11 + i, 1)), keys = ms.map(m => monthKey(m.getTime()));
    const tin = keys.map(() => 0), tout = keys.map(() => 0), down = keys.map(() => 0);
    R.tickets.forEach(t => {
      const i = keys.indexOf(monthKey(t.createdAt)); if (i >= 0) tin[i]++;
      if (isDone(t)) { const j = keys.indexOf(monthKey(t.closedAt)); if (j >= 0) { tout[j]++; down[j] += (t.closedAt - t.createdAt) / HOUR; } }
    });
    return { labels: ms.map(m => m.toLocaleDateString('th-TH', { month: 'short' })), full: ms.map(m => m.toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })), tin, tout, down: down.map(v => Math.round(v * 10) / 10) };
  }
  const TR = { W: 720, H: 250, l: 34, r: 14, t: 16, b: 30, max: 4 };
  let SER = null;
  const tx = i => TR.l + i * (TR.W - TR.l - TR.r) / 11;
  const ty = v => TR.t + (1 - v / TR.max) * (TR.H - TR.t - TR.b);
  function areaChart() {
    SER = series();
    TR.max = niceMax(Math.max(...SER.tin, ...SER.tout));
    const A = SER.tin.map((v, i) => [tx(i), ty(v)]), B = SER.tout.map((v, i) => [tx(i), ty(v)]), base = ty(0);
    const area = pts => smooth(pts) + `L${tx(11)} ${base}L${tx(0)} ${base}Z`;
    return `<svg viewBox="0 0 ${TR.W} ${TR.H}" role="img" aria-label="กราฟงานเข้าและงานที่ปิดได้ 12 เดือนล่าสุด">
      <defs>
        <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--chart-a);stop-opacity:.4"/><stop offset="1" style="stop-color:var(--chart-a);stop-opacity:0"/></linearGradient>
        <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--chart-b);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--chart-b);stop-opacity:0"/></linearGradient>
      </defs>
      ${ticks(TR.max).map(v => `<line class="gridline" x1="${TR.l}" x2="${TR.W - TR.r}" y1="${ty(v)}" y2="${ty(v)}"/><text x="${TR.l - 8}" y="${ty(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      <path d="${area(A)}" fill="url(#ga)"/>
      <path d="${area(B)}" fill="url(#gb)"/>
      <path d="${smooth(A)}" fill="none" style="stroke:var(--chart-a)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="${smooth(B)}" fill="none" style="stroke:var(--chart-b)" stroke-width="2.6" stroke-linecap="round"/>
      ${SER.labels.map((m, i) => `<text x="${tx(i)}" y="${TR.H - 8}" text-anchor="middle">${m}</text>`).join('')}
      <line class="guide" x1="0" x2="0" y1="${TR.t}" y2="${base}" style="stroke:var(--line-2)" stroke-width="1.5" stroke-dasharray="3 4"/>
      <circle class="dot-a" r="5.5" style="fill:var(--chart-a);stroke:var(--inner-2)" stroke-width="3"/>
      <circle class="dot-b" r="5.5" style="fill:var(--chart-b);stroke:var(--inner-2)" stroke-width="3"/>
      <rect class="hit" x="${TR.l}" y="0" width="${TR.W - TR.l - TR.r}" height="${TR.H}" fill="transparent"/>
    </svg>`;
  }
  function trendAt(i) {
    const box = $('#trend');
    if (!box || !SER) return;
    const svg = $('svg', box), tip = $('.tip', box), x = tx(i);
    $('.guide', svg).setAttribute('x1', x); $('.guide', svg).setAttribute('x2', x);
    $('.dot-a', svg).setAttribute('cx', x); $('.dot-a', svg).setAttribute('cy', ty(SER.tin[i]));
    $('.dot-b', svg).setAttribute('cx', x); $('.dot-b', svg).setAttribute('cy', ty(SER.tout[i]));
    tip.hidden = false;
    tip.innerHTML = `<b>${SER.full[i]}</b><br><i style="background:var(--chart-a)"></i>งานเข้า ${SER.tin[i]}<br><i style="background:var(--chart-b)"></i>ปิดงานได้ ${SER.tout[i]}`;
    placeTip(tip, svg, x / TR.W, ty(SER.tin[i]) / TR.H, i);
  }
  // tooltip above the point, or below it when the chart is too short to fit it above (phones)
  function placeTip(tip, svg, fx, fy, i) {
    const top = fy * svg.getBoundingClientRect().height;
    tip.style.left = (fx * 100) + '%';
    tip.style.top = top + 'px';
    tip.style.transform = `translate(${i <= 1 ? '-18%' : i >= 10 ? '-82%' : '-50%'}, ${top - tip.offsetHeight - 14 < 0 ? '14px' : 'calc(-100% - 14px)'})`;
  }
  function wireTrend() {
    const svg = $('#trend svg');
    if (!svg) return;
    trendAt(11);
    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * TR.W;
      trendAt(clamp(Math.round((x - TR.l) / ((TR.W - TR.l - TR.r) / 11)), 0, 11));
    });
    svg.addEventListener('pointerleave', () => trendAt(11));
  }
  const daily = () => [...Array(14)].map((_, i) => { const from = dayStart() - (13 - i) * DAY; return { n: R.tickets.filter(t => t.createdAt >= from && t.createdAt < from + DAY).length, d: new Date(from) }; });
  function barChart() {
    const days = daily(), W = 320, H = 150, l = 6, r = 6, t = 16, b = 22, n = days.length, max = niceMax(Math.max(...days.map(x => x.n)));
    const stepW = (W - l - r) / n, bw = 9, y = v => H - b - (v / max) * (H - t - b);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="จำนวนงานเข้ารายวัน 14 วันล่าสุด">
      <defs><linearGradient id="gbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs>
      ${ticks(max).map(v => `<line class="gridline" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}
      ${days.map(({ n: v, d }, i) => {
        const x = l + i * stepW + (stepW - bw) / 2, today = i === n - 1, h = Math.max(v ? 3 : 0, H - b - y(v));
        return `<rect x="${x.toFixed(1)}" y="${(H - b - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="4.5" fill="url(#gbar)" opacity="${today ? 1 : .45}"><title>${shortDay(d.getTime())} · ${v} งาน</title></rect>`
          + (today ? `<text x="${x + bw / 2}" y="${H - b - h - 6}" text-anchor="middle" style="fill:var(--ink);font-weight:600">${v}</text>` : '')
          + (i % 2 === 1 || today ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle"${today ? ' style="fill:var(--ink);font-weight:600"' : ''}>${today ? 'วันนี้' : d.getDate()}</text>` : '');
      }).join('')}
    </svg>`;
  }
  function gauge(v, reviews) {
    return `<div class="gauge"><svg viewBox="0 0 200 112" aria-hidden="true"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--r3a)"/><stop offset=".6" style="stop-color:var(--r1a)"/><stop offset="1" style="stop-color:var(--r1b)"/></linearGradient></defs>
      <path class="track" d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke-width="14" stroke-linecap="round"/>
      ${v == null ? '' : `<path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round" pathLength="100" stroke-dasharray="${(v - 1) / 4 * 100} 100"/>`}
    </svg><div class="gauge-val"><b>${v == null ? '—' : v.toFixed(1)}</b><span class="muted small">${reviews ? `จาก ${fmt(reviews)} คะแนน` : 'ยังไม่มีคะแนน'}</span></div></div>
    <div class="gauge-scale"><span>1</span><span>5</span></div>`;
  }

  // ---------- views ----------
  const VIEWS = {}, AFTER = {};
  const mini = (label, val, foot) => `<div class="mini glass"><span class="mini-label">${label}</span><span class="mini-val">${val}</span><span class="mini-foot">${foot}</span></div>`;
  const pageHead = (crumb, ic, title, sub, actions = '') => `<section class="page-head"><div><div class="eyebrow"><a href="#overview">หน้าหลัก</a> / ${crumb}</div><h1 class="ph-title"><span class="title-chip">${icon(ic)}</span>${title}</h1><p class="ph-sub">${sub}</p></div>${actions ? `<div class="ph-actions">${actions}</div>` : ''}</section>`;
  const kpiTile = (label, ic, chip, value, unit, foot, cls = 's3') => `<article class="card glass kpi ${cls}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="chip-icon ${chip}">${icon(ic)}</span></div><div class="kpi-value">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="kpi-foot">${foot}</div></article>`;
  const modePill = () => Store.mode === 'db' ? `<span class="pill t-ok mode-pill">${icon('cloud')}ข้อมูลใช้ร่วมกันผ่านลิงก์นี้</span>` : `<span class="pill t-med mode-pill">${icon('hard-drive')}บันทึกในเบราว์เซอร์นี้เท่านั้น</span>`;
  // red = needs action now; counts come straight from the records
  function alerts() {
    const off = cams().filter(a => a.status === 'offline').length;
    return [
      { icon: 'timer', tone: 'crit', text: 'ใบงานเกิน SLA', count: overSla().length, go: 'tickets' },
      { icon: 'video-off', tone: 'high', text: 'กล้องออฟไลน์', count: off, go: 'cameras' },
      { icon: 'calendar-check', tone: 'info', text: 'งาน PM ใน 7 วัน', count: pmSoon().length, go: 'pm' },
      { icon: 'file-clock', tone: 'med', text: 'สัญญา MA หมดใน 60 วัน', count: maSoon().length, go: 'ma' },
      { icon: 'package', tone: 'low', text: 'อะไหล่ต่ำกว่าขั้นต่ำ', count: lowParts().length, go: 'stock' }
    ].filter(a => a.count);
  }
  const radarBox = () => { const s = camSites(); return `<div class="radar" role="img" aria-label="เรดาร์สถานะกล้อง ${s.length} สถานที่ จุดสีแดงคือมีกล้องออฟไลน์"><div class="radar-sweep"></div>
    ${s.map(x => `<span class="blip${x.off ? ' off' : ''}" style="left:${x.x}%;top:${x.y}%" title="${esc(x.name)} · ${x.cams} ตัว${x.off ? ' · ออฟไลน์ ' + x.off : ''}"></span>${x.off ? `<span class="blip-label" style="left:${x.x}%;top:${x.y}%">${x.off}</span>` : ''}`).join('')}</div>`; };
  const offList = () => camSites().filter(s => s.off).map(s => `<div class="inner off-row">${icon('video-off')}<span>${esc(s.name)}</span><b>${s.off} ตัว</b></div>`).join('');
  const stockRow = p => `<div class="stock-row"><div class="stock-top"><span class="cell-main">${esc(p.name)}</span><b class="${+p.qty === 0 ? 'zero' : 'low'}">${p.qty} / ${p.min}</b></div><div class="meter low"><i style="width:${clamp(p.qty / p.min * 100, 4, 100)}%"></i></div><span class="hint">เหลือ ${p.qty} ${esc(p.unit)} · ขั้นต่ำ ${p.min} ${esc(p.unit)}</span></div>`;
  const timers = [];
  const stopTimers = () => timers.splice(0).forEach(clearInterval);

  // first-run checklist on the home page
  function setupSteps() {
    return [
      ['ตรวจข้อมูลบริษัทและทีมช่าง', 'settings', R.techs.length > 0],
      ['เพิ่มลูกค้ารายแรก', 'customers', R.customers.length > 0],
      ['ลงทะเบียนอุปกรณ์ของลูกค้า', 'assets', R.assets.length > 0],
      ['แจ้งซ่อมใบแรก', 'new', R.tickets.length > 0],
      ['ปิดงานใบแรก', 'tickets', R.tickets.some(isDone)],
      ['ทำสัญญา MA หรือวางแผน PM', 'ma', R.contracts.length + R.pm.length > 0]
    ];
  }
  function setupCard() {
    const steps = setupSteps(), done = steps.filter(s => s[2]).length;
    if (S.hideSetup || done === steps.length) return '';
    return `<article class="card glass s12 setup"><div class="card-head"><div><h2 class="card-title">${icon('rocket')}เริ่มใช้งานระบบ</h2><p class="card-sub">ระบบยังว่างอยู่ ลองทำตามนี้ทีละข้อเพื่อทดสอบทุกหน้า · ทำแล้ว ${done} จาก ${steps.length}</p></div>
      <button type="button" class="link" data-act="hide-setup">ซ่อน</button></div>
      <div class="meter"><i style="width:${done / steps.length * 100}%"></i></div>
      <ol class="setup-list">${steps.map(([t, go, ok], i) => `<li><a class="setup-step inner${ok ? ' ok' : ''}" href="#${go}"><span class="setup-n">${ok ? icon('check') : i + 1}</span><span>${t}</span>${ok ? '' : icon('chevron-right')}</a></li>`).join('')}</ol></article>`;
  }

  function kpis() {
    const open = openTickets(), over = overSla(), [label, from] = PERIODS[S.period], s = stats(from());
    const n = v => open.filter(t => t.sev === v).length, today = R.tickets.filter(t => t.createdAt >= dayStart()).length;
    return kpiTile('ใบงานเปิดอยู่', 'clipboard-list', '', open.length, 'ใบ', `<span class="delta${today ? ' bad' : ''}">+${today} วันนี้</span>วิกฤต ${n('crit')} · สูง ${n('high')} · อื่น ๆ ${n('med') + n('low')}`)
      + kpiTile('เกิน SLA', 'timer', 'c-crit', over.length, 'ใบ', over.length ? `<span class="delta bad">${over.filter(t => t.sev === 'crit').length} วิกฤต</span>ควรจัดการก่อน` : 'ทุกงานยังอยู่ในเวลา')
      + kpiTile(`ปิดงานแล้ว · ${label}`, 'check-check', 'c-ok', fmt(s.closed), 'ใบ', `เข้ามา ${fmt(s.created)} ใบในช่วงเดียวกัน`)
      + kpiTile('เวลาซ่อมเฉลี่ย', 'wrench', 'c-warm', one(s.mttr), 'ชม.', s.mttr == null ? 'ยังไม่มีงานที่ปิด' : `ตั้งแต่แจ้งจนปิดงาน · ${label}`);
  }
  function homeRows() {
    let rows = S.homeTab === 'done' ? R.tickets.filter(isDone).sort((a, b) => b.closedAt - a.closedAt) : openTickets().sort(bySev);
    if (SEV_RANK[S.homeTab] != null) rows = rows.filter(t => t.sev === S.homeTab);
    if (!rows.length) return `<tr><td colspan="8">${R.tickets.length ? emptyBox('party-popper', 'ไม่มีใบงานในกลุ่มนี้', '') : emptyBox('clipboard-plus', 'ยังไม่มีใบงานในระบบ', 'ลองแจ้งซ่อมใบแรกเพื่อดูว่าข้อมูลไหลไปทุกหน้าอย่างไร', '<a class="btn btn-primary btn-sm" href="#new">' + icon('plus') + 'แจ้งซ่อมใหม่</a>')}</td></tr>`;
    return rows.map(t => {
      const c = cust(t.cust), k = tech(t.tech), [step, why] = nextStep(t);
      return `<tr data-act="open" data-v="${t.id}">
        <td>${sevPill(t.sev)}</td>
        <td class="tabnum muted">${whenText(t.createdAt)}</td>
        <td class="wo">${t.id}</td>
        <td><div class="cell-main">${esc(t.title)}</div><div class="cell-sub">${esc(c.name)} · ${esc(t.site)}</div></td>
        <td>${slaCell(t)}</td>
        <td><div class="ai-cell"><span class="ai-who">${icon('arrow-right-circle')}${step}</span><span>${esc(why)}</span></div></td>
        <td><div class="tech-cell">${av(k, 'av-sm')}${k ? esc(k.short) : '<span class="faint">ยังไม่มอบหมาย</span>'}</div></td>
        <td>${stPill(t.status)}</td></tr>`;
    }).join('');
  }
  function homeTabs() {
    const open = openTickets(), n = s => open.filter(t => t.sev === s).length;
    const c = v => `<span class="count">${v}</span>`;
    return seg('homeTab', [['open', 'เปิดอยู่' + c(open.length)], ['crit', 'วิกฤต' + c(n('crit'))], ['high', 'สูง' + c(n('high'))], ['med', 'ปานกลาง' + c(n('med'))], ['low', 'ต่ำ' + c(n('low'))], ['done', 'ปิดแล้ว' + c(R.tickets.filter(isDone).length)]], S.homeTab, 'seg-sm');
  }
  const LINES = [['cctv', 'CCTV & Security', ['cctv', 'access']], ['net', 'IT & Network', ['net', 'pc', 'other']], ['ac', 'Air Service', ['ac']]];

  VIEWS.overview = () => {
    const [label, from] = PERIODS[S.period], s = stats(from());
    const c = cams(), on = c.filter(a => a.status === 'online').length;
    const urgent = openTickets().filter(t => t.sev === 'crit' || t.sev === 'high' || sla(t).over).sort((a, b) => a.dueAt - b.dueAt).slice(0, 5);
    const month = R.tickets.filter(t => t.createdAt >= firstOfMonth()), team = R.techs.map(k => ({ k, st: techState(k), ...techStats(k, firstOfMonth()) })).sort((a, b) => b.closed - a.closed);
    const busy = team.filter(x => x.st === 'busy').length, sevColor = { crit: 'var(--crit)', high: 'var(--high)', med: 'var(--med)', low: 'var(--low)' };
    const open = openTickets();
    return `<div class="page">
    <section class="page-head">
      <div><div class="eyebrow">ภาพรวมงานบริการ · ${dateTH(now(), { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</div><h1 class="ph-title">${greet()} คุณ${esc(me())}</h1>
        <p class="ph-sub">${R.tickets.length ? `มีใบงานเปิดอยู่ ${open.length} ใบ${overSla().length ? ` และ ${overSla().length} ใบเกิน SLA ควรจัดการก่อน` : ' ทุกใบยังอยู่ในเวลา SLA'}` : 'ระบบเพิ่งเริ่มต้น ยังไม่มีข้อมูลงาน'} ${modePill()}</p></div>
      <div class="ph-actions">${seg('period', Object.entries(PERIODS).map(([k, [l]]) => [k, l === '7 วันล่าสุด' ? '7 วัน' : l]), S.period, 'seg-sm')}
        <a class="btn btn-primary" href="#new">${icon('plus')}แจ้งซ่อมใหม่</a></div>
    </section>
    <section class="grid">
      ${setupCard()}
      <div class="grid s12" id="kpis">${kpis()}</div>

      <article class="card glass s7 radar-card">
        <div class="radar-copy">
          <span class="live">สถานะกล้องทั้งหมด · สด</span>
          <div class="radar-big">${fmt(on)}<small> / ${fmt(c.length)} ตัวออนไลน์</small></div>
          <p class="muted">${c.length ? `ออฟไลน์ ${c.filter(a => a.status === 'offline').length} ตัว · มีปัญหา ${c.filter(a => a.status === 'warn').length} ตัว · จาก ${camSites().length} สถานที่` : 'ยังไม่มีกล้องในทะเบียน เพิ่มกล้องที่หน้า ทะเบียนทรัพย์สิน แล้วสถานะจะขึ้นที่นี่'}</p>
          <div class="off-list">${offList()}</div>
          <div class="btn-row"><a class="btn btn-primary btn-sm" href="#cameras">${icon('cctv')}ดูกล้องทั้งหมด</a><a class="btn btn-sm" href="#assets">${icon('plus')}เพิ่มอุปกรณ์</a></div>
        </div>
        ${radarBox()}
      </article>

      <article class="card glass s5">
        <div class="card-head"><div><h2 class="card-title">ตัวชี้วัดเดือนนี้</h2><p class="card-sub">คำนวณจากข้อมูลในระบบ</p></div></div>
        ${ringsHTML('rg')}
      </article>

      <article class="card glass s8">
        <div class="card-head"><div><h2 class="card-title">แนวโน้มงานแจ้งซ่อม</h2><p class="card-sub">งานที่เข้ามาเทียบกับงานที่ปิดได้ · 12 เดือนล่าสุด</p></div>
          <div class="legend"><span><i style="background:var(--chart-a)"></i>งานเข้า</span><span><i style="background:var(--chart-b)"></i>ปิดงานได้</span></div></div>
        <div class="chart" id="trend">${areaChart()}<div class="tip" hidden></div></div>
      </article>

      <article class="card glass s4">
        <div class="card-head"><div><h2 class="card-title">งานเข้ารายวัน</h2><p class="card-sub">14 วันล่าสุด · วันนี้ ${daily()[13].n} งาน</p></div></div>
        <div class="chart">${barChart()}</div>
        <div class="bars-stats">
          ${LINES.map(([ic, l, types]) => { const n = month.filter(t => types.includes(t.type)).length, pct = month.length ? Math.round(n / month.length * 100) : 0; return `<div class="bstat"><div class="bstat-top"><span class="chip-icon">${icon(D.types[ic].icon)}</span>${l}</div><b>${n} <span class="muted small">งาน · ${pct}%</span></b><div class="meter"><i style="width:${pct}%"></i></div></div>`; }).join('')}
          <div class="bstat"><div class="bstat-top"><span class="chip-icon">${icon('users')}</span>ช่างที่ออกงาน</div><b>${busy} <span class="muted small">จาก ${R.techs.length} คน</span></b><div class="meter"><i style="width:${R.techs.length ? busy / R.techs.length * 100 : 0}%"></i></div></div>
        </div>
      </article>

      <article class="card glass s5">
        <div class="card-head"><div><h2 class="card-title">งานด่วน</h2><p class="card-sub">${urgent.length ? `${urgent.length} งานที่ควรถึงหน้างานก่อน เรียงตามเวลา SLA` : 'ไม่มีงานด่วนตอนนี้'}</p></div><a class="link" href="#tickets">ดูทั้งหมด ${icon('chevron-right')}</a></div>
        <div class="jobs">${urgent.map(t => { const k2 = tech(t.tech); return `<a class="job inner" href="#${t.id.toLowerCase()}" style="--sev:${sevColor[t.sev]}">
          <span class="chip-icon ${t.sev === 'crit' ? 'c-crit' : 'c-warm'}">${icon(D.types[t.type].icon)}</span>
          <span style="min-width:0"><span class="job-title">${esc(t.title)}</span><span class="job-meta">${t.id} · ${esc(cust(t.cust).name)} · ${esc(t.site)}</span></span>
          <span class="job-side">${sevPill(t.sev)}<span>${av(k2, 'av-sm')}</span><span>${sla(t).text}</span></span></a>`; }).join('') || emptyBox('coffee', 'ยังไม่มีงานด่วน', '')}</div>
      </article>

      <article class="card glass s4">
        <div class="card-head"><div><h2 class="card-title">ทีมช่างเดือนนี้</h2><p class="card-sub">${R.techs.length} คน · ปฏิบัติงาน ${busy} · ว่าง ${team.filter(x => x.st === 'free').length}</p></div><a class="link" href="#settings">จัดการ ${icon('chevron-right')}</a></div>
        <div class="team">${team.slice(0, 5).map(({ k, st, closed, score }) => `<div class="team-row">${av(k)}<div style="min-width:0"><div class="team-name">${esc(k.name)}</div><div class="team-meta"><span class="state ${st}"></span>${esc(k.team || '')} · ${STATE_TEXT[st]}${score ? ` · คะแนน ${one(score)}` : ''}</div></div><div class="team-num">${closed}</div></div>`).join('') || emptyBox('user-plus', 'ยังไม่มีช่าง', '')}</div>
      </article>

      <article class="card glass s3">
        <div class="card-head"><div><h2 class="card-title">ความพึงพอใจลูกค้า</h2><p class="card-sub" id="gauge-sub">${label} · ให้คะแนนตอนปิดงาน</p></div></div>
        <div id="gauge">${gauge(s.sat, s.reviews)}</div>
      </article>

      <article class="card glass s12">
        <div class="card-head"><div><h2 class="card-title">ใบงานที่ต้องจัดการ</h2><p class="card-sub">เรียงตามความเร่งด่วน แล้วตามเวลา SLA ที่เหลือ</p></div>
          <div class="card-actions"><a class="btn btn-sm" href="#tickets">${icon('list')}ใบงานทั้งหมด</a></div></div>
        <div class="seg-scroll" id="home-tabs">${homeTabs()}</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>ระดับ</th><th>แจ้งเมื่อ</th><th>เลขที่</th><th>ปัญหา</th><th>SLA</th><th>ขั้นต่อไป</th><th>ช่าง</th><th>สถานะ</th></tr></thead><tbody id="home-rows">${homeRows()}</tbody></table></div>
        <div class="tbl-foot"><span>แตะแถวเพื่อเปิดใบงาน</span><a class="link" href="#tickets">ไปหน้าใบแจ้งซ่อมทั้งหมด ${icon('arrow-right')}</a></div>
      </article>
    </section></div>`;
  };
  AFTER.overview = () => { fillRings(); wireTrend(); };

  // tickets list (Figma "ATS Repair List")
  const GROUPS = [['all', 'ทั้งหมด'], ['pending', 'รอดำเนินการ'], ['doing', 'กำลังดำเนินการ'], ['parts', 'รออะไหล่'], ['over', 'เกิน SLA'], ['done', 'เสร็จสิ้น']];
  const inGroup = (t, g) => g === 'all' || (g === 'over' ? sla(t).over && !isDone(t) : D.statuses[t.status].group === g);
  function listFiltered(ignoreTab) {
    const q = S.listQuery.trim().toLowerCase();
    return R.tickets.filter(t => {
      if (!ignoreTab && !inGroup(t, S.listTab)) return false;
      if (S.listType !== 'all' && t.type !== S.listType) return false;
      if (S.listSev !== 'all' && t.sev !== S.listSev) return false;
      if (S.listTech !== 'all' && (S.listTech === 'none' ? t.tech : t.tech !== S.listTech)) return false;
      if (!q) return true;
      const c = cust(t.cust), k = tech(t.tech);
      return [t.id, t.title, t.site, c.name, k && k.name, t.status, t.reporter, t.phone].join(' ').toLowerCase().includes(q);
    });
  }
  const filtersOn = () => S.listQuery || S.listType !== 'all' || S.listSev !== 'all' || S.listTech !== 'all';
  function listTabs() {
    const base = listFiltered(true);
    return seg('listTab', GROUPS.map(([g, l]) => [g, `${l}<span class="count${g === 'over' ? ' hot' : ''}">${base.filter(t => inGroup(t, g)).length}</span>`]), S.listTab, 'seg-sm');
  }
  function listRows() {
    const dir = S.listSort === 'asc' ? 1 : -1;
    return listFiltered().sort((a, b) => (a.createdAt - b.createdAt) * dir);
  }
  function listBody() {
    const all = listRows();
    if (!R.tickets.length) return emptyBox('clipboard-plus', 'ยังไม่มีใบแจ้งซ่อม', 'ใบงานที่แจ้งเข้ามาจะแสดงที่นี่ พร้อมเวลา SLA ที่นับถอยหลังจริง', `<a class="btn btn-primary btn-sm" href="#new">${icon('plus')}แจ้งซ่อมใบแรก</a>`);
    if (!all.length) return emptyBox('search-x', 'ไม่พบใบงานที่ตรงกับตัวกรอง', 'ลองล้างคำค้นหรือเลือกแท็บ "ทั้งหมด"', `<button class="btn btn-sm" data-act="clear-filters">ล้างตัวกรอง</button>`);
    if (S.listMode === 'board') {
      return `<div class="board">${GROUPS.slice(1).filter(([g]) => g !== 'over').map(([g, l]) => {
        const items = all.filter(t => D.statuses[t.status].group === g);
        return `<div class="col inner"><div class="col-head"><span>${l}</span><span class="tag">${items.length}</span></div>
          ${items.map(t => { const k = tech(t.tech), s = sla(t); return `<div class="kcard inner" data-act="open" data-v="${t.id}" role="link" tabindex="0">
            <div class="kcard-top"><span class="wo" style="color:var(--accent-ink);font-weight:600">${t.id}</span>${sevPill(t.sev)}</div>
            <div class="kcard-title">${esc(t.title)}</div><div class="cell-sub">${esc(cust(t.cust).name)} · ${esc(t.site)}</div>
            <div class="kcard-foot"><span class="tech-cell">${av(k, 'av-sm')}${k ? esc(k.short) : 'ยังไม่มอบหมาย'}</span><span${s.over ? ' style="color:var(--crit-fg)"' : ''}>${s.text}</span></div></div>`; }).join('') || '<div class="faint small" style="padding:8px 4px">ไม่มีใบงาน</div>'}</div>`;
      }).join('')}</div>`;
    }
    const pages = Math.max(1, Math.ceil(all.length / S.listPer));
    S.listPage = clamp(S.listPage, 1, pages);
    const from = (S.listPage - 1) * S.listPer, rows = all.slice(from, from + S.listPer);
    const allSel = rows.every(t => S.selected.has(t.id));
    return `<div class="table-wrap"><table class="tbl tbl-list"><thead><tr>
        <th style="width:36px"><input type="checkbox" class="check" data-act="selall" aria-label="เลือกทั้งหมดในหน้านี้"${allSel ? ' checked' : ''}></th>
        <th>เลขที่ / ประเภท</th><th>ลูกค้า / อาการเสีย</th><th>ความเร่งด่วน</th><th>ช่างผู้รับผิดชอบ</th><th>สถานะ</th>
        <th><button type="button" class="th-sort" data-act="sort" aria-label="เรียงตามวันที่แจ้ง">วันที่แจ้ง${icon(S.listSort === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow')}</button></th>
        <th class="ta-r">SLA</th></tr></thead><tbody>
      ${rows.map(t => { const c = cust(t.cust), k = tech(t.tech); return `<tr data-act="open" data-v="${t.id}"${S.selected.has(t.id) ? ' class="is-sel"' : ''}>
        <td><input type="checkbox" class="check" data-act="sel" data-v="${t.id}" aria-label="เลือก ${t.id}"${S.selected.has(t.id) ? ' checked' : ''}></td>
        <td><div class="wo">${t.id}</div><div style="margin-top:4px">${typeTag(t.type)}</div></td>
        <td><div class="cell-main">${esc(c.name)}</div><div class="cell-sub">${esc(t.title)} · ${esc(t.site)}</div></td>
        <td>${sevPill(t.sev)}</td>
        <td><div class="tech-cell">${av(k, 'av-sm')}${k ? esc(k.name) : '<span class="faint">ยังไม่มอบหมาย</span>'}</div></td>
        <td>${stPill(t.status)}</td>
        <td class="tabnum"><div>${dateTH(t.createdAt)}</div><div class="cell-sub">${hm(t.createdAt)} น.</div></td>
        <td class="ta-r">${slaCell(t)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="tbl-foot"><span>แสดง ${from + 1}–${from + rows.length} จาก ${all.length} รายการ</span>
        <span class="tb-spacer"></span>
        <label class="per">แถวต่อหน้า <select data-flt="listPer">${[5, 10, 20].map(n => `<option${n === S.listPer ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <div class="pager"><button type="button" data-act="page" data-v="${S.listPage - 1}" aria-label="หน้าก่อน"${S.listPage <= 1 ? ' disabled' : ''}>${icon('chevron-left')}</button>${[...Array(pages)].map((_, i) => `<button type="button" data-act="page" data-v="${i + 1}"${i + 1 === S.listPage ? ' aria-current="page"' : ''}>${i + 1}</button>`).join('')}<button type="button" data-act="page" data-v="${S.listPage + 1}" aria-label="หน้าถัดไป"${S.listPage >= pages ? ' disabled' : ''}>${icon('chevron-right')}</button></div></div>`;
  }
  function bulkBar() {
    const n = S.selected.size;
    return n ? `<div class="bulkbar"><span class="bulk-n">${icon('check-check')}เลือกแล้ว ${n} รายการ</span>${[['bulk-tech', 'มอบหมายช่าง', 'user-plus'], ['bulk-status', 'เปลี่ยนสถานะ', 'refresh-cw'], ['bulk-delete', 'ลบ', 'trash-2']].map(([a, l, ic]) => `<button type="button" class="bulk-btn" data-act="${a}">${icon(ic)}${l}</button>`).join('')}<span class="tb-spacer"></span><button type="button" class="bulk-btn ghost" data-act="sel-clear">${icon('x')}ยกเลิกการเลือก</button></div>` : '';
  }
  function updateList(keepTabs) {
    const body = $('#list-body');
    if (!body) return;
    body.innerHTML = listBody();
    $('#bulk').innerHTML = bulkBar();
    $('#clear-flt').hidden = !filtersOn();
    if (!keepTabs) { $('#list-tabs').innerHTML = listTabs(); Seg.place($('#list-tabs .seg'), false); }
    refreshIcons();
  }
  const fsel = (key, label, opts) => `<label class="fsel"><span>${label}:</span><select data-flt="${key}">${opts.map(([v, l]) => `<option value="${v}"${S[key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${icon('chevron-down')}</label>`;
  VIEWS.tickets = () => {
    const today = R.tickets.filter(t => t.createdAt >= dayStart()), m = stats(firstOfMonth()), d = stats(dayStart());
    return `<div class="page">
    ${pageHead('ใบแจ้งซ่อม', 'wrench', 'ใบแจ้งซ่อมทั้งหมด', 'จัดการ ติดตาม และมอบหมายใบงานทั้งหมดในที่เดียว · เวลา SLA นับจากตอนเปิดใบงาน', `<a class="btn btn-primary" href="#new">${icon('plus')}แจ้งซ่อมใหม่</a>`)}
    <section class="grid">
      ${kpiTile('แจ้งเข้าวันนี้', 'wrench', '', today.length, 'ใบงาน', `เปิดอยู่ทั้งหมด ${openTickets().length} ใบ`)}
      ${kpiTile('ปิดงานวันนี้', 'circle-check', 'c-ok', d.closed, 'ใบงาน', `เดือนนี้ ${m.closed} ใบ`)}
      ${kpiTile('เวลาปิดงานเฉลี่ย', 'clock', 'c-teal', one(m.mttr), 'ชม.', m.mttr == null ? 'ยังไม่มีงานที่ปิด' : 'เดือนนี้')}
      ${kpiTile('ผ่าน SLA เดือนนี้', 'shield-check', 'c-violet', one(m.ontime), '%', m.closed ? `${m.ontimeN} จาก ${m.closed} งานที่ปิด` : 'ยังไม่มีงานที่ปิด')}
    </section>
    <section class="list-tabs-row">
      <div class="seg-scroll" id="list-tabs">${listTabs()}</div>
      ${seg('listMode', [['table', icon('table-2') + 'ตาราง'], ['board', icon('kanban') + 'บอร์ด']], S.listMode, 'seg-sm')}
    </section>
    <section class="card glass list-card">
      <div class="toolbar">
        <label class="search-field">${icon('search')}<span class="sr">ค้นหาใบงาน</span><input id="q" type="search" placeholder="ค้นหาเลขใบงาน, ลูกค้า, ผู้แจ้ง…" value="${esc(S.listQuery)}" autocomplete="off"></label>
        ${fsel('listType', 'ประเภท', [['all', 'ทั้งหมด'], ...Object.entries(D.types).map(([k, v]) => [k, v.short])])}
        ${fsel('listSev', 'ความเร่งด่วน', [['all', 'ทั้งหมด'], ...Object.entries(D.severities).map(([k, v]) => [k, v.label])])}
        ${fsel('listTech', 'ช่าง', [['all', 'ทั้งหมด'], ['none', 'ยังไม่มอบหมาย'], ...R.techs.map(t => [t.id, t.short])])}
        <button type="button" class="link" id="clear-flt" data-act="clear-filters"${filtersOn() ? '' : ' hidden'}>ล้างตัวกรอง</button>
      </div>
      <div id="bulk">${bulkBar()}</div>
      <div id="list-body">${listBody()}</div>
    </section></div>`;
  };

  // Command Center (Figma "ATS Dashboard — Command Center")
  function ccKpis() {
    const open = openTickets(), over = overSla(), [label, from] = PERIODS[S.period], s = stats(from());
    const plan = pmIn(firstOfMonth(), firstOfMonth(1)), c = cams(), on = c.filter(a => a.status === 'online').length;
    return kpiTile('ใบงานเปิดอยู่', 'clipboard-list', '', open.length, 'ใบงาน', `<span class="delta">+${R.tickets.filter(t => t.createdAt >= dayStart()).length}</span>เข้ามาวันนี้`, 's2')
      + kpiTile('เกิน SLA', 'timer', 'c-crit', over.length, 'ใบงาน', over.length ? '<span class="delta bad">ต้องเร่งดำเนินการ</span>' : 'อยู่ในเวลาทั้งหมด', 's2')
      + kpiTile('MTTR เฉลี่ย', 'clock', 'c-teal', one(s.mttr), 'ชม.', label, 's2')
      + kpiTile('PM ตามแผน', 'calendar-check', 'c-ok', plan.length ? one(plan.filter(p => p.done).length / plan.length * 100) : '—', '%', `${plan.filter(p => p.done).length} / ${plan.length} งาน เดือนนี้`, 's2')
      + kpiTile('กล้องออนไลน์', 'cctv', 'c-violet', c.length ? one(on / c.length * 100) : '—', '%', `${fmt(on)} / ${fmt(c.length)} ตัว`, 's2')
      + kpiTile('ความพึงพอใจ', 'smile', 'c-warm', s.sat == null ? '—' : s.sat.toFixed(1), '/ 5', s.reviews ? `จาก ${fmt(s.reviews)} คะแนน` : 'ยังไม่มีคะแนน', 's2');
  }
  const CB = { W: 720, H: 260, l: 34, r: 40, t: 18, b: 30, maxL: 4, maxR: 4 };
  const cbStep = (CB.W - CB.l - CB.r) / 12, cbx = i => CB.l + cbStep * (i + .5);
  const cbyl = v => CB.t + (1 - v / CB.maxL) * (CB.H - CB.t - CB.b), cbyr = v => CB.t + (1 - v / CB.maxR) * (CB.H - CB.t - CB.b);
  function comboChart() {
    SER = series();
    CB.maxL = niceMax(Math.max(...SER.tin)); CB.maxR = niceMax(Math.max(...SER.down));
    const base = cbyl(0), bw = 20;
    return `<svg viewBox="0 0 ${CB.W} ${CB.H}" role="img" aria-label="ใบแจ้งซ่อมรายเดือนและชั่วโมงซ่อมรวม 12 เดือนล่าสุด">
      <defs><linearGradient id="gcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--chart-a)"/><stop offset="1" style="stop-color:var(--chart-a);stop-opacity:.3"/></linearGradient></defs>
      ${ticks(CB.maxL).map(v => `<line class="gridline" x1="${CB.l}" x2="${CB.W - CB.r}" y1="${cbyl(v)}" y2="${cbyl(v)}"/><text x="${CB.l - 8}" y="${cbyl(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${[0, CB.maxR / 2, CB.maxR].map(v => `<text x="${CB.W - CB.r + 8}" y="${cbyr(v) + 4}">${v} ชม.</text>`).join('')}
      ${SER.tin.map((v, i) => `<rect class="cbar" data-i="${i}" x="${cbx(i) - bw / 2}" y="${cbyl(v).toFixed(1)}" width="${bw}" height="${(base - cbyl(v)).toFixed(1)}" rx="6" fill="url(#gcb)"/>`).join('')}
      <path d="${smooth(SER.down.map((v, i) => [cbx(i), cbyr(v)]))}" fill="none" style="stroke:var(--chart-b)" stroke-width="2.6" stroke-linecap="round"/>
      ${SER.down.map((v, i) => `<circle class="cdot" data-i="${i}" cx="${cbx(i)}" cy="${cbyr(v).toFixed(1)}" r="3.5" style="fill:var(--inner-2);stroke:var(--chart-b)" stroke-width="2"/>`).join('')}
      ${SER.labels.map((m, i) => `<text x="${cbx(i)}" y="${CB.H - 8}" text-anchor="middle">${m}</text>`).join('')}
      <rect x="${CB.l}" y="0" width="${CB.W - CB.l - CB.r}" height="${CB.H}" fill="transparent"/>
    </svg>`;
  }
  function comboAt(i) {
    const box = $('#combo');
    if (!box || !SER) return;
    $$('.cbar', box).forEach(r => r.classList.toggle('on', +r.dataset.i === i));
    $$('.cdot', box).forEach(c => c.setAttribute('r', +c.dataset.i === i ? 6 : 3.5));
    const tip = $('.tip', box);
    tip.hidden = false;
    tip.innerHTML = `<b>${SER.full[i]}</b><br><i style="background:var(--chart-a)"></i>ใบแจ้งซ่อม ${SER.tin[i]} ใบ<br><i style="background:var(--chart-b)"></i>ชั่วโมงซ่อมรวม ${SER.down[i]} ชม.`;
    placeTip(tip, $('svg', box), cbx(i) / CB.W, Math.min(cbyl(SER.tin[i]), cbyr(SER.down[i])) / CB.H, i);
  }
  const mixData = () => { const m = R.tickets.filter(t => t.createdAt >= firstOfMonth()); return Object.entries(D.types).map(([k, v]) => ({ type: k, label: v.label, jobs: m.filter(t => t.type === k).length })); };
  function donut() {
    const mix = mixData(), total = mix.reduce((s, m) => s + m.jobs, 0), r = 64, C = 2 * Math.PI * r;
    let acc = 0;
    const segs = total ? mix.map((m, i) => {
      if (!m.jobs) return '';
      const len = C * m.jobs / total;
      const s = `<circle class="dseg" data-i="${i}" cx="80" cy="80" r="${r}" fill="none" style="stroke:var(--m${i + 1})" stroke-width="20" stroke-dasharray="${Math.max(.5, len - 2.5).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"/>`;
      acc += len;
      return s;
    }).join('') : '';
    return `<div class="donut"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="${r}" fill="none" style="stroke:var(--line)" stroke-width="20"/><g transform="rotate(-90 80 80)">${segs}</g></svg><div class="donut-c" id="donut-c"><b>${total}</b><span>ใบงาน</span></div></div>
      <div class="mix-list">${mix.map((m, i) => `<div class="mix-row" data-mix="${i}"><i style="background:var(--m${i + 1})"></i><span>${m.label}</span><b>${m.jobs}</b><span class="faint">${total ? Math.round(m.jobs / total * 100) : 0}%</span></div>`).join('')}</div>`;
  }
  VIEWS.command = () => {
    const open = openTickets(), watch = open.slice().sort((a, b) => a.dueAt - b.dueAt).slice(0, 6);
    const team = R.techs.map(k => ({ k, st: techState(k) })), busy = team.filter(x => x.st === 'busy').length, free = team.filter(x => x.st === 'free').length;
    const stTone = { busy: ['ปฏิบัติงาน', 't-info'], free: ['ว่าง', 't-ok'], leave: ['ลา', 't-low'] };
    const soonPm = pmSoon(), low = lowParts().sort((a, b) => a.qty / a.min - b.qty / b.min).slice(0, 4), soonMa = maSoon(), al = alerts();
    const total = mixData().reduce((s, m) => s + m.jobs, 0);
    return `<div class="page">
    ${pageHead('Command Center', 'radar', 'ศูนย์บัญชาการงานบริการ', `ภาพรวมงานแจ้งซ่อม · งาน PM · ทรัพย์สิน · สัญญาบริการ · อัปเดต ${dateTH(now())} เวลา ${hm(now())} น.`,
      `${seg('period', Object.entries(PERIODS).map(([k, [l]]) => [k, l === '7 วันล่าสุด' ? '7 วัน' : l]), S.period, 'seg-sm')}<a class="btn" href="#tv">${icon('tv')}Service TV</a>`)}
    <section class="alert-bar glass">
      <span class="chip-icon ${al.length ? 'c-warm' : 'c-ok'}">${icon(al.length ? 'siren' : 'shield-check')}</span><b class="alert-title">${al.length ? 'ต้องดำเนินการด่วน' : 'ไม่มีเรื่องด่วน'}</b>
      <div class="a-chips">${al.map(a => `<button type="button" class="a-chip" data-act="go" data-v="${a.go}"><i class="dot-${a.tone}"></i><b>${a.count}</b>${a.text}</button>`).join('') || '<span class="muted small">ทุกอย่างเรียบร้อย</span>'}</div>
      <a class="link" href="#tickets">ดูใบงาน ${icon('chevron-right')}</a>
    </section>
    <section class="grid">
      <div class="grid s12" id="cc-kpis">${ccKpis()}</div>
      <article class="card glass s8"><div class="card-head"><div><h2 class="card-title">แนวโน้มใบแจ้งซ่อม & ชั่วโมงซ่อม</h2><p class="card-sub">12 เดือนล่าสุด · ชี้ที่กราฟเพื่อดูตัวเลข</p></div>
        <div class="legend"><span><i style="background:var(--chart-a)"></i>ใบแจ้งซ่อม (ใบ)</span><span><i class="ln" style="background:var(--chart-b)"></i>ชั่วโมงซ่อมรวม</span></div></div>
        <div class="chart" id="combo">${comboChart()}<div class="tip" hidden></div></div></article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">สัดส่วนงานตามประเภทบริการ</h2><p class="card-sub">เดือนนี้ · ทั้งหมด ${total} ใบงาน</p></div></div>
        <div class="mix" id="mix">${donut()}</div></article>
      <article class="card glass s8"><div class="card-head"><div><h2 class="card-title">ใบงานที่ต้องติดตาม (ใกล้ / เกิน SLA)</h2><p class="card-sub">เรียงตามเวลา SLA คงเหลือ · ${watch.length} จาก ${open.length} ใบงานที่เปิดอยู่</p></div><a class="link" href="#tickets">ดูทั้งหมด ${icon('chevron-right')}</a></div>
        ${watch.length ? `<div class="table-wrap"><table class="tbl" style="min-width:720px"><thead><tr><th>เลขที่ / ประเภท</th><th>ลูกค้า / สถานที่</th><th>ช่างผู้รับผิดชอบ</th><th>สถานะ</th><th class="ta-r">SLA คงเหลือ</th></tr></thead><tbody>
        ${watch.map(t => { const k = tech(t.tech); return `<tr data-act="open" data-v="${t.id}"><td><div class="wo">${t.id}</div><div style="margin-top:4px">${typeTag(t.type)}</div></td><td><div class="cell-main">${esc(cust(t.cust).name)}</div><div class="cell-sub">${esc(t.site)} · ${esc(t.title)}</div></td><td><div class="tech-cell">${av(k, 'av-sm')}${k ? esc(k.short) : '<span style="color:var(--vio-fg)">ยังไม่มอบหมาย</span>'}</div></td><td>${stPill(t.status)}</td><td class="ta-r">${slaCell(t)}</td></tr>`; }).join('')}
        </tbody></table></div>` : emptyBox('clipboard-check', 'ไม่มีใบงานเปิดอยู่', '', `<a class="btn btn-sm" href="#new">${icon('plus')}แจ้งซ่อมใหม่</a>`)}</article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">ทีมช่างวันนี้</h2><p class="card-sub">${R.techs.length} คน · ปฏิบัติงาน ${busy} · ว่าง ${free} · ลา ${R.techs.length - busy - free}</p></div></div>
        <div class="team">${team.slice(0, 6).map(({ k, st }) => { const job = R.tickets.find(t => t.tech === k.id && !isDone(t)); return `<div class="team-row">${av(k)}<div style="min-width:0"><div class="team-name">${esc(k.name)}</div><div class="team-meta">${job ? `${job.id} · ${esc(cust(job.cust).name)}` : esc(k.team || '')}</div></div><span class="pill ${stTone[st][1]}">${stTone[st][0]}</span></div>`; }).join('')}</div>
        <div class="complete"><div class="complete-top"><span>ช่างที่ออกงานตอนนี้</span><b>${R.techs.length ? Math.round(busy / R.techs.length * 100) : 0}%</b></div><div class="meter"><i style="width:${R.techs.length ? busy / R.techs.length * 100 : 0}%"></i></div></div></article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">งาน PM ที่ถึงกำหนด (7 วัน)</h2><p class="card-sub">${soonPm.length} งาน · ตามแผนบำรุงรักษา</p></div><a class="link" href="#pm">ปฏิทิน ${icon('chevron-right')}</a></div>
        <div class="pm-list">${soonPm.map(pmItem).join('') || emptyBox('calendar', 'ไม่มีงาน PM ใน 7 วันนี้', '')}</div></article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">อะไหล่ใกล้หมดสต็อก</h2><p class="card-sub">ต่ำกว่าจุดสั่งซื้อขั้นต่ำ (Min)</p></div><a class="link" href="#stock">สต็อก ${icon('chevron-right')}</a></div>
        <div class="stock-list">${low.map(stockRow).join('') || emptyBox('package-check', 'สต็อกพอใช้ทุกรายการ', R.parts.length ? '' : 'ยังไม่มีอะไหล่ในระบบ')}</div></article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">สัญญาบริการ MA ใกล้หมดอายุ</h2><p class="card-sub">ภายใน 60 วัน · มูลค่ารวม ${fmt(soonMa.reduce((s, m) => s + +m.value, 0))} ฿</p></div><a class="link" href="#ma">สัญญา ${icon('chevron-right')}</a></div>
        <div class="pm-list">${soonMa.map(m => { const d = daysLeft(m.end); return `<div class="contract inner"><div style="min-width:0"><div class="cell-main">${esc(cust(m.cust).name)}</div><div class="cell-sub">${esc(m.plan)} · ${fmt(m.value)} ฿/ปี</div></div><span class="pill ${d <= 30 ? 't-crit' : d <= 45 ? 't-high' : 't-violet'}">เหลือ ${d} วัน</span></div>`; }).join('') || emptyBox('file-check', 'ไม่มีสัญญาที่ใกล้หมดอายุ', '')}</div></article>
    </section>
    <p class="foot">© ${new Date().getFullYear() + 543} ${D.company.name} · ATS Service Hub · โทร ${D.company.phone}</p></div>`;
  };
  AFTER.command = () => {
    comboAt(11);
    const svg = $('#combo svg');
    svg.addEventListener('pointermove', e => { const r = svg.getBoundingClientRect(); comboAt(clamp(Math.floor(((e.clientX - r.left) / r.width * CB.W - CB.l) / cbStep), 0, 11)); });
    svg.addEventListener('pointerleave', () => comboAt(11));
    const mix = $('#mix'), data = mixData(), total = data.reduce((s, m) => s + m.jobs, 0);
    const pick = i => {
      $$('.dseg', mix).forEach(s => s.classList.toggle('dim', i != null && +s.dataset.i !== i));
      $$('.mix-row', mix).forEach(r => r.classList.toggle('on', +r.dataset.mix === i));
      const m = data[i];
      $('#donut-c').innerHTML = m ? `<b>${m.jobs}</b><span>${esc(m.label)}</span>` : `<b>${total}</b><span>ใบงาน</span>`;
    };
    mix.addEventListener('pointerover', e => { const t = e.target.closest('[data-mix], .dseg'); if (t) pick(+(t.dataset.mix ?? t.dataset.i)); });
    mix.addEventListener('pointerleave', () => pick(null));
  };

  // Service TV: the wall-screen version of the Command Center
  const clockText = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  VIEWS.tv = () => {
    const open = openTickets(), c = cams(), on = c.filter(a => a.status === 'online').length, busy = R.techs.filter(k => techState(k) === 'busy').length;
    const urgent = open.slice().sort(bySev).slice(0, 5);
    const tile = (label, val, unit, ic, cls = '') => `<article class="card glass tv-tile s3 ${cls}"><span class="chip-icon ${cls === 'hot' ? 'c-crit' : ''}">${icon(ic)}</span><span class="kpi-label">${label}</span><b>${val}<small>${unit}</small></b></article>`;
    const feed = R.tickets.flatMap(t => (t.log || []).map(l => ({ ...l, id: t.id }))).sort((a, b) => b.t - a.t).slice(0, 8).map(l => `${whenText(l.t)} · ${l.id} · ${l.text}`);
    if (!feed.length) feed.push('ยังไม่มีความเคลื่อนไหว · แจ้งซ่อมใบแรกแล้วรายการจะวิ่งที่แถบนี้');
    return `<div class="page tv">
    <section class="tv-head glass"><div class="tv-brand">${L.lockup({ size: 'sm' })}<span class="live">Service TV · สด</span></div>
      <div class="tv-clock"><b id="tv-clock">${clockText()}</b><span>${dateTH(now(), { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="ph-actions"><button type="button" class="btn" data-act="fullscreen">${icon('maximize')}เต็มจอ</button><a class="btn" href="#command">${icon('arrow-left')}Command Center</a></div></section>
    <section class="grid">
      ${tile('งานเปิดอยู่', open.length, 'ใบงาน', 'clipboard-list')}${tile('เกิน SLA', overSla().length, 'ใบงาน', 'timer', overSla().length ? 'hot' : '')}
      ${tile('กล้องออนไลน์', c.length ? one(on / c.length * 100) : '—', c.length ? '%' : '', 'cctv')}${tile('ช่างปฏิบัติงาน', `${busy}/${R.techs.length}`, 'คน', 'users')}
      <article class="card glass s5 tv-radar">${radarBox()}<div class="off-list">${offList() || '<span class="muted small">ไม่มีกล้องออฟไลน์</span>'}</div></article>
      <article class="card glass s7"><h2 class="card-title">งานด่วนตอนนี้</h2><div class="tv-jobs">${urgent.map(t => { const k2 = tech(t.tech), s = sla(t); return `<a class="tv-job inner" href="#${t.id.toLowerCase()}"><span class="tv-sev sev-${t.sev}"></span><div style="min-width:0"><b>${esc(t.title)}</b><span>${t.id} · ${esc(cust(t.cust).name)} · ${k2 ? esc(k2.short) : 'ยังไม่มอบหมาย'}</span></div><span class="tv-sla${s.over ? ' over' : ''}">${s.text}</span></a>`; }).join('') || emptyBox('coffee', 'ไม่มีงานเปิดอยู่', '')}</div></article>
    </section>
    <div class="ticker glass"><span class="ticker-label">${icon('radio')}ล่าสุด</span><div class="ticker-track"><div class="ticker-move">${[...feed, ...feed].map(x => `<span>${esc(x)}</span>`).join('')}</div></div></div></div>`;
  };
  AFTER.tv = () => { timers.push(setInterval(() => { const c = $('#tv-clock'); if (c) c.textContent = clockText(); }, 1000)); };

  // running numbers per month: WO-6911-0001, QT-6911-001, PR-6911-001 (Buddhist year)
  function nextNo(prefix, list) {
    const d = new Date(), p = `${prefix}-${String(d.getFullYear() + 543).slice(2)}${pad(d.getMonth() + 1)}-`;
    const max = list.filter(x => x.id.startsWith(p)).reduce((m, x) => Math.max(m, +x.id.slice(p.length) || 0), 0);
    return p + String(max + 1).padStart(prefix === 'WO' ? 4 : 3, '0');
  }
  const logLine = (k, text, sub = '') => ({ t: now(), k, text, sub, by: me() });

  // ---------- modal forms (shared by every "add / edit" button) ----------
  const mfield = (name, label, control, { req = false, full = false, hint = '', err = '' } = {}) =>
    `<div class="field${full ? ' full' : ''}" data-field="${name}"><label for="m-${name}">${label}${req ? '<span class="req">*</span>' : ''}</label>${control}${hint ? `<span class="hint">${hint}</span>` : ''}${err ? `<span class="ferr">${err}</span>` : ''}</div>`;
  const mi = (name, v = '', attrs = '') => `<input id="m-${name}" name="${name}" value="${esc(v)}" autocomplete="off" ${attrs}>`;
  const mt = (name, v = '', rows = 3) => `<textarea id="m-${name}" name="${name}" rows="${rows}">${esc(v)}</textarea>`;
  const msel = (name, opts, cur) => `<select id="m-${name}" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const custOpts = (blank = '') => [...(blank ? [['', blank]] : []), ...R.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'th')).map(c => [c.id, c.name])];
  const techOpts = blank => [...(blank ? [['', blank]] : []), ...R.techs.map(k => [k.id, `${k.name}${k.leave ? ' (ลา)' : ''}`])];
  const typeOpts = () => Object.entries(D.types).map(([k, v]) => [k, v.label]);
  const siteList = (id, c) => `<datalist id="${id}">${(c.sites || []).map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;

  // ---------- new ticket form (Figma "ATS Repair Form") ----------
  const STEPS = ['ข้อมูลลูกค้า & สถานที่', 'อุปกรณ์ & อาการเสีย', 'ความเร่งด่วน & นัดหมาย', 'ตรวจสอบ & ยืนยัน'];
  const SEV_ICON = { crit: 'zap', high: 'triangle-alert', med: 'clock', low: 'calendar' };
  const assetsOf = c => R.assets.filter(a => a.cust === c);
  const field = (name, label, control, { req = false, err = '', full = false, hint = '', icon: ic = '' } = {}) =>
    `<div class="field${full ? ' full' : ''}" data-field="${name}"><label for="f-${name}">${label}${req ? '<span class="req">*</span>' : ''}</label>${ic ? `<span class="ctl">${icon(ic)}${control}</span>` : control}${hint ? `<span class="hint">${hint}</span>` : ''}${err ? `<span class="ferr">${err}</span>` : ''}</div>`;
  const inp = (name, attrs = '') => `<input id="f-${name}" data-f="${name}" value="${esc(S.form[name])}" ${attrs}>`;
  const sel = (name, opts) => `<select id="f-${name}" data-f="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(S.form[name]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const counter = (name, max) => `<span class="counter" id="cnt-${name}">${S.form[name].length} / ${max}</span>`;
  const secHead = (i, desc) => `<div class="sec-head"><span class="sec-n">${i + 1}</span><div><h2 class="card-title">${STEPS[i]}</h2><p class="card-sub">${desc}</p></div></div>`;
  const isNewCust = () => S.form.cust === '__new';

  function addrBox() {
    if (isNewCust()) return `<span class="chip-icon soft">${icon('user-plus')}</span><div style="min-width:0"><div class="cell-main">ลูกค้าใหม่</div><div class="hint">เมื่อกดส่ง ระบบจะบันทึกลูกค้ารายนี้ไว้ในหน้า ลูกค้า & สาขา ให้ด้วย</div></div>`;
    const c = cust(S.form.cust), m = contractOf(c.id);
    return `<span class="chip-icon soft">${icon('map-pin')}</span><div style="min-width:0"><div class="cell-main">${c.addr ? esc(c.addr) : '<span class="faint">ยังไม่มีที่อยู่ในระบบ</span>'}</div><div class="hint">${m ? `สัญญา ${esc(m.plan)} · ถึง ${dateTH(parseDay(m.end))}` : 'ยังไม่มีสัญญา MA · คิดค่าบริการตามจริง'}${c.contact ? ` · ผู้ติดต่อ ${esc(c.contact)}` : ''}</div></div>${m ? '<span class="pill t-ok">อยู่ในสัญญา MA</span>' : '<span class="pill t-med">นอกสัญญา</span>'}`;
  }
  const newCustBox = () => isNewCust() ? `<div class="fgrid">${field('newName', 'ชื่อลูกค้า / บริษัท', inp('newName', 'autocomplete="off" placeholder="เช่น บจก. ตัวอย่าง หรือ คุณสมชาย"'), { req: true, icon: 'building-2', err: 'กรอกชื่อลูกค้า' })}${field('newAddr', 'ที่อยู่ (ไม่บังคับ)', inp('newAddr', 'autocomplete="off" placeholder="ตำบล อำเภอ จังหวัด"'), { icon: 'map-pin' })}</div>` : '';
  const siteField = () => field('site', 'สาขา / สถานที่ติดตั้ง', inp('site', 'list="site-list" autocomplete="off" placeholder="เช่น สำนักงานใหญ่, คลังสินค้า"') + siteList('site-list', isNewCust() ? {} : cust(S.form.cust)), { req: true, icon: 'map-pin', err: 'กรอกสถานที่' });
  function assetField() {
    const f = S.form, list = isNewCust() ? [] : assetsOf(f.cust), a = asset(f.asset);
    return field('asset', 'อุปกรณ์ / ทรัพย์สินที่เสีย', sel('asset', [['', list.length ? 'ไม่ทราบ / ให้ช่างตรวจหน้างาน' : 'ยังไม่มีอุปกรณ์ในทะเบียน'], ...list.map(x => [x.id, `${x.code} · ${x.name}`])]),
      { icon: 'box', hint: a ? `${esc(a.site || '')} · ประกันถึง ${a.warranty ? dateTH(parseDay(a.warranty)) : '—'}` : list.length ? 'เลือกเพื่อดูประวัติซ่อมด้านขวา' : 'เพิ่มอุปกรณ์ได้ที่หน้า ทะเบียนทรัพย์สิน' })
      + `<div class="field"><label for="f-assetid">รหัสทรัพย์สิน</label><span class="ctl">${icon('tag')}<input id="f-assetid" value="${esc(a ? a.code : '—')}" readonly></span></div>`;
  }
  const techSuggest = () => { const k = tech(S.form.tech); return k ? `${STATE_TEXT[techState(k)]} · ${esc(k.team || '')}${k.phone ? ' · ' + esc(k.phone) : ''}` : 'มอบหมายทีหลังได้ในหน้าใบงาน'; };
  function formHTML() {
    const f = S.form;
    return `
      <section class="card glass form-sec" id="sec-0" data-sec="0">${secHead(0, R.customers.length ? 'เลือกลูกค้าจากรายชื่อ หรือเลือก ลูกค้าใหม่ แล้วพิมพ์ชื่อเอง' : 'ยังไม่มีลูกค้าในระบบ พิมพ์ชื่อลูกค้าใหม่ได้เลย')}
        <div class="fgrid">
          ${field('cust', 'ลูกค้า / บริษัท', sel('cust', [...custOpts(), ['__new', '＋ ลูกค้าใหม่ (พิมพ์ชื่อเอง)']]), { req: true, icon: 'building-2', err: 'เลือกลูกค้าก่อน' })}
          <div id="site-field">${siteField()}</div>
          <div class="full" id="new-cust">${newCustBox()}</div>
          ${field('reporter', 'ชื่อผู้แจ้ง', inp('reporter', 'autocomplete="off" placeholder="เช่น คุณวรรณา (ฝ่ายอาคาร)"'), { req: true, icon: 'user', err: 'กรอกชื่อผู้แจ้ง เพื่อให้ช่างติดต่อกลับได้' })}
          ${field('phone', 'เบอร์โทรติดต่อ', inp('phone', 'inputmode="tel" autocomplete="off" placeholder="0xx-xxx-xxxx"'), { req: true, icon: 'phone', err: 'กรอกเบอร์โทร 9–10 หลัก' })}
          <div class="field"><span class="flabel">ช่องทางที่รับแจ้ง</span>${seg('form.channel', [['โทรศัพท์', icon('phone') + 'โทรศัพท์'], ['LINE', icon('message-circle') + 'LINE'], ['สแกน QR', icon('qr-code') + 'QR'], ['เว็บแจ้งซ่อม', icon('globe') + 'เว็บ']], f.channel, 'seg-sm seg-fill')}</div>
          ${field('email', 'อีเมล (ไม่บังคับ)', inp('email', 'type="email" autocomplete="off" placeholder="name@company.com"'), { icon: 'mail' })}
        </div>
        <div class="note-box inner" id="addr-box">${addrBox()}</div>
      </section>

      <section class="card glass form-sec" id="sec-1" data-sec="1">${secHead(1, 'เลือกประเภทงานและอุปกรณ์ที่เสีย พร้อมแนบรูปเพื่อให้ช่างเตรียมอะไหล่ได้ถูกต้อง')}
        <div class="field" data-field="type"><span class="flabel">ประเภทงาน<span class="req">*</span></span>
          <div class="opt-grid">${Object.entries(D.types).map(([k, v]) => `<label class="opt"><input type="radio" name="type" data-f="type" value="${k}"${f.type === k ? ' checked' : ''}><span class="chip-icon">${icon(v.icon)}</span><span><span class="opt-t">${v.label}</span><br><span class="opt-d">${v.hint}</span></span></label>`).join('')}</div></div>
        <div class="fgrid fgrid-asset" id="asset-field">${assetField()}</div>
        ${field('subject', 'หัวข้ออาการเสีย', inp('subject', 'autocomplete="off" maxlength="120" placeholder="เช่น กล้องดับ 4 จุด บริเวณลานจอดรถ"'), { req: true, full: true, err: 'สรุปอาการสั้น ๆ อย่างน้อย 5 ตัวอักษร' })}
        <div class="field" data-field="detail"><label for="f-detail">รายละเอียดอาการ</label><textarea id="f-detail" data-f="detail" rows="3" maxlength="500" placeholder="เกิดขึ้นเมื่อไร มีอะไรเปลี่ยนไปก่อนหน้านั้น">${esc(f.detail)}</textarea>${counter('detail', 500)}</div>
        <div class="field"><span class="flabel">แนบรูปภาพ / วิดีโอ</span>
          <div class="drop" id="drop" role="button" tabindex="0">${icon('cloud-upload')}<b style="color:var(--ink)">ลากไฟล์มาวางที่นี่ หรือ <span style="color:var(--accent-ink)">คลิกเพื่อเลือกไฟล์</span></b><span class="hint">ต้นแบบนี้เก็บเฉพาะชื่อไฟล์ ยังไม่ได้อัปโหลดรูปขึ้นระบบ</span></div>
          <input type="file" id="files" accept="image/*,video/*" multiple hidden>
          <div class="thumbs" id="thumbs">${thumbs()}</div></div>
      </section>

      <section class="card glass form-sec" id="sec-2" data-sec="2">${secHead(2, 'ระดับความเร่งด่วนกำหนดเวลา SLA ให้อัตโนมัติ (แก้ชั่วโมงได้ที่หน้าตั้งค่า)')}
        <div class="field" data-field="sev"><span class="flabel">ระดับความเร่งด่วน<span class="req">*</span></span>
          <div class="opt-grid sev-grid">${Object.entries(D.severities).map(([k, v]) => `<label class="opt sev-opt sev-${k}"><input type="radio" name="sev" data-f="sev" value="${k}"${f.sev === k ? ' checked' : ''}><span class="sev-ic">${icon(SEV_ICON[k])}</span><span><span class="opt-t">${v.label} · ${slaH(k)} ชม.</span><br><span class="opt-d">${esc(v.slaText.split('·')[1] || '')}</span></span></label>`).join('')}</div></div>
        <div class="fgrid">
          ${field('date', 'วันที่นัดเข้าตรวจ', inp('date', `type="date" min="${isoDay()}"`), { req: true, icon: 'calendar', err: 'เลือกวันที่นัด' })}
          ${field('slot', 'ช่วงเวลา', sel('slot', SLOTS.map(s => [s, s])), { icon: 'clock' })}
          ${field('tech', 'มอบหมายช่าง', sel('tech', [['', 'ยังไม่มอบหมาย'], ...R.techs.map(t => [t.id, `${t.name} · ${STATE_TEXT[techState(t)]}`])]), { icon: 'user', hint: `<span id="tech-hint" class="ai-hint">${techSuggest()}</span>` })}
          ${field('coord', 'ผู้รับเรื่อง', inp('coord', 'autocomplete="off"'), { icon: 'users' })}
        </div>
      </section>

      <section class="card glass form-sec" id="sec-3" data-sec="3">${secHead(3, 'ตรวจสอบข้อมูลด้านขวาให้ถูกต้องก่อนส่ง')}
        <div class="toggles inner">
          <div class="toggle"><span><b>แจ้งเตือนลูกค้าทาง LINE / SMS</b><br><span class="hint">ยังไม่ได้เชื่อม LINE จริง · ใช้ปุ่มคัดลอกข้อความในหน้าใบงานแทนได้</span></span><span class="switch"><input type="checkbox" data-f="notify"${f.notify ? ' checked' : ''} aria-label="แจ้งเตือนลูกค้าทาง LINE / SMS"><span></span></span></div>
          <div class="toggle"><span><b>ต้องออกใบเสนอราคาก่อนเข้าซ่อม</b><br><span class="hint">ใบงานจะขึ้นสถานะ รออนุมัติ จนกว่าลูกค้าตกลง</span></span><span class="switch"><input type="checkbox" data-f="quote"${f.quote ? ' checked' : ''} aria-label="ต้องออกใบเสนอราคาก่อนเข้าซ่อม"><span></span></span></div>
        </div>
        <div class="field" data-field="note"><label for="f-note">หมายเหตุภายใน (ลูกค้าไม่เห็น)</label><textarea id="f-note" data-f="note" rows="2" maxlength="500">${esc(f.note)}</textarea>${counter('note', 500)}</div>
        <label class="consent inner" data-field="consent"><input type="checkbox" data-f="consent"${f.consent ? ' checked' : ''}><span>ยืนยันว่าข้อมูลถูกต้อง และลูกค้ายินยอมให้ทีมช่างเข้าพื้นที่ตามวันเวลานัดหมาย<span class="ferr">ติ๊กยืนยันก่อนส่งใบแจ้งซ่อม</span></span></label>
        <div class="form-nav"><span class="hint">${icon('info')}เมื่อกดส่ง ระบบจะสร้างใบงาน ${nextNo('WO', R.tickets)} และเริ่มนับเวลา SLA ทันที</span>
          <span class="btn-row"><button type="button" class="btn" data-act="form-reset">${icon('eraser')}ล้างฟอร์ม</button><button type="button" class="btn btn-primary" data-act="submit">${icon('send')}ส่งใบแจ้งซ่อม</button></span></div>
      </section>`;
  }
  function thumbs() {
    return S.files.map((x, i) => `<div class="thumb">${x.url ? `<img src="${x.url}" alt="${esc(x.name)}">` : `${icon('film')}<span>${esc(x.name)}</span>`}<button type="button" data-act="rm-file" data-v="${i}" aria-label="ลบไฟล์ ${esc(x.name)}">${icon('x')}</button></div>`).join('');
  }
  // which required fields are still wrong, per section
  function problems() {
    const f = S.form;
    return [
      [!f.cust && 'cust', isNewCust() && !f.newName.trim() && 'newName', !f.site.trim() && 'site', !f.reporter.trim() && 'reporter', !/^\d{9,10}$/.test(f.phone.replace(/\D/g, '')) && 'phone'].filter(Boolean),
      [!f.type && 'type', f.subject.trim().length < 5 && 'subject'].filter(Boolean),
      [!f.sev && 'sev', !f.date && 'date'].filter(Boolean),
      [!f.consent && 'consent'].filter(Boolean)
    ];
  }
  function completeness() {
    const f = S.form;
    const checks = [f.cust && (!isNewCust() || f.newName.trim()), f.site.trim(), f.reporter.trim(), /\d{9,10}/.test(f.phone.replace(/\D/g, '')), f.type, f.subject.trim().length >= 5, f.detail.trim(), f.sev, f.date, f.tech, f.consent];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }
  const dueText = () => { const due = now() + slaH(S.form.sev) * HOUR; return `${dateTH(due)} · ${hm(due)} น.`; };
  function summaryCard() {
    const f = S.form, k = tech(f.tech), p = completeness(), sv = D.severities[f.sev];
    const row = (dt, dd) => `<div class="sum-row"><dt>${dt}</dt><dd${dd ? '' : ' class="empty-v"'}>${dd || 'ยังไม่ได้กรอก'}</dd></div>`;
    return `<div class="card-head"><h2 class="card-title">สรุปใบแจ้งซ่อม</h2><span class="pill t-low no-dot">ร่าง</span></div>
      <div class="wo-box inner"><span class="hint">เลขที่ใบงาน</span><b>${nextNo('WO', R.tickets)}</b><span class="hint">สร้างอัตโนมัติเมื่อกดส่ง</span></div>
      <div class="sla-box sev-${f.sev}"><span class="sev-ic">${icon(SEV_ICON[f.sev])}</span><div><b>${sv.label} · SLA ${slaH(f.sev)} ชั่วโมง</b><span>ต้องเข้าหน้างานภายใน ${dueText()}</span></div></div>
      <dl class="sum-list">${row('ลูกค้า', esc(isNewCust() ? f.newName.trim() && f.newName.trim() + ' (ใหม่)' : cust(f.cust).name)) + row('สถานที่', esc(f.site)) + row('ประเภทงาน', esc(D.types[f.type].label)) + row('อุปกรณ์', f.asset ? esc(asset(f.asset)?.code || '') : 'ให้ช่างตรวจหน้างาน')
        + row('นัดหมาย', f.date ? `${dateTH(parseDay(f.date), { day: '2-digit', month: 'short', year: 'numeric' })} · ${esc(f.slot)}` : '') + row('ช่าง', k ? esc(k.name) : 'ยังไม่มอบหมาย')}</dl>
      <div class="complete"><div class="complete-top"><span>ความครบถ้วนของข้อมูล</span><b>${p}%</b></div><div class="meter"><i style="width:${p}%"></i></div></div>`;
  }
  // repair history of the chosen device, or of the customer when no device is picked
  function historyCard() {
    const f = S.form, a = asset(f.asset);
    if (isNewCust()) return `<h2 class="card-title">ประวัติซ่อม</h2><p class="card-sub">ลูกค้าใหม่ ยังไม่มีประวัติ</p>`;
    const list = R.tickets.filter(t => a ? t.asset === a.id : t.cust === f.cust).sort((x, y) => y.createdAt - x.createdAt);
    const title = a ? `${esc(a.code)} · ${esc(a.name)}` : esc(cust(f.cust).name);
    if (!list.length) return `<h2 class="card-title">ประวัติซ่อม${a ? 'อุปกรณ์นี้' : 'ของลูกค้า'}</h2><p class="card-sub">${title} · ยังไม่มีประวัติซ่อมในระบบ</p>`;
    const recent = list.filter(t => t.createdAt > now() - 90 * DAY).length;
    return `<div><h2 class="card-title">ประวัติซ่อม${a ? 'อุปกรณ์นี้' : 'ของลูกค้า'}</h2><p class="card-sub">${title} · ${list.length} ใบงาน</p></div>
      <ol class="hist">${list.slice(0, 5).map(t => { const k = tech(t.tech); return `<li><span class="hist-dot"></span><div><span class="hint">${dateTH(t.createdAt)} · ${t.id}</span><div class="cell-main">${esc(t.title)}</div><span class="hint">${k ? esc(k.short) : 'ยังไม่มอบหมาย'} · ${esc(t.status)}${t.closedAt ? ` · ใช้เวลา ${dur(t.closedAt - t.createdAt)}` : ''}</span></div></li>`; }).join('')}</ol>
      ${recent >= 2 ? `<div class="tip-box">${icon('lightbulb')}<span>แจ้งซ่อม ${recent} ครั้งใน 90 วัน ควรเพิ่มในรอบงาน PM</span></div>` : ''}`;
  }
  function stepState() {
    const bad = problems();
    $$('.step', $('#stepper')).forEach((b, i) => {
      const ok = !bad[i].length;
      b.classList.toggle('is-done', ok);
      $('.step-n', b).innerHTML = ok ? icon('check') : i + 1;
    });
    refreshIcons();
  }
  function renderSummary() {
    const box = $('#summary');
    if (!box) return;
    box.innerHTML = summaryCard();
    refreshIcons();
    stepState();
  }
  function renderSide() {
    if (!$('#hist')) return;
    $('#hist').innerHTML = historyCard();
    renderSummary();
  }
  function setStep(i, animate) {
    const st = $('#stepper');
    if (!st || S.formSec === i && animate) return;
    S.formSec = i;
    $$('.step', st).forEach((b, k) => { if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    Seg.place(st, animate);
  }
  // the stepper follows whichever section is under the sticky bar
  function spy() {
    if (!$('#stepper')) return;
    const line = $('#stepper').getBoundingClientRect().bottom + 40;
    let i = 0;
    $$('.form-sec', view).forEach((s, k) => { if (s.getBoundingClientRect().top < line) i = k; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) i = STEPS.length - 1;
    setStep(i, true);
  }
  function validateAll() {
    const bad = problems(), all = bad.flat();
    $$('[data-field]', view).forEach(el => el.classList.toggle('has-error', all.includes(el.dataset.field)));
    stepState();
    if (all.length) {
      const el = $(`[data-field="${all[0]}"]`, view);
      el.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => $('input, select, textarea', el)?.focus({ preventScroll: true }), reduce.matches ? 0 : 350);
      toast(`ยังขาดข้อมูล ${all.length} ช่อง · ดูช่องที่ขึ้นสีแดง`, 'triangle-alert');
    }
    return !all.length;
  }
  function setupDrop() {
    const drop = $('#drop'), input = $('#files');
    if (!drop) return;
    drop.onclick = () => input.click();
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('is-over'); };
    drop.ondragleave = () => drop.classList.remove('is-over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); };
    input.onchange = () => { addFiles(input.files); input.value = ''; };
  }
  function addFiles(list) {
    let skipped = 0;
    [...list].forEach(file => {
      if (S.files.length >= 10 || file.size > 20 * 1024 * 1024 || !/^(image|video)\//.test(file.type)) { skipped++; return; }
      const item = { name: file.name, url: '' };
      S.files.push(item);
      if (file.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = () => { item.url = r.result; $('#thumbs') && ($('#thumbs').innerHTML = thumbs(), refreshIcons()); };
        r.readAsDataURL(file);
      }
    });
    if (skipped) toast(`ข้ามไป ${skipped} ไฟล์ · รับเฉพาะรูปหรือวิดีโอไม่เกิน 20MB และรวมไม่เกิน 10 ไฟล์`, 'triangle-alert');
    $('#thumbs').innerHTML = thumbs();
    refreshIcons();
  }
  VIEWS.new = () => {
    if (!S.form) S.form = blankForm();
    return `<div class="page">
    <section class="page-head">
      <div><div class="eyebrow"><a href="#overview">หน้าหลัก</a> / <a href="#tickets">ใบแจ้งซ่อม</a> / แจ้งซ่อมใหม่</div><h1 class="ph-title"><span class="title-chip">${icon('file-plus-2')}</span>แจ้งซ่อมใหม่</h1>
        <p class="ph-sub">กรอกข้อมูลให้ครบ ระบบจะสร้างเลขใบงานและเริ่มนับเวลา SLA ทันที · ช่องที่มี <span class="req">*</span> จำเป็นต้องกรอก</p></div>
      <div class="ph-actions"><a class="btn" href="#tickets">ยกเลิก</a><button type="button" class="btn btn-primary" data-act="submit">${icon('send')}ส่งใบแจ้งซ่อม</button></div>
    </section>
    <nav class="stepper glass" id="stepper" aria-label="ขั้นตอนการแจ้งซ่อม"><span class="seg-thumb"></span>
      ${STEPS.map((s, i) => `<button type="button" class="step" data-act="step" data-v="${i}"${i === S.formSec ? ' aria-current="step"' : ''}><span class="step-n">${i + 1}</span><span class="step-t">ขั้นที่ ${i + 1}<b>${s}</b></span></button>`).join('')}
    </nav>
    <div class="form-layout">
      <form class="form-col" id="form" novalidate>${formHTML()}</form>
      <aside class="side-col">
        <article class="card glass summary" id="summary">${summaryCard()}</article>
        <article class="card glass" id="hist">${historyCard()}</article>
        <article class="card glass help-card"><span class="chip-icon c-warm">${icon('headset')}</span><div><b>ต้องการความช่วยเหลือด่วน?</b><span>โทร ${D.company.phone} · LINE: ${D.company.line} · ${D.company.hours}</span></div></article>
      </aside>
    </div></div>`;
  };
  AFTER.new = () => { setupDrop(); stepState(); setStep(S.formSec, false); $('#form').addEventListener('submit', e => e.preventDefault()); };

  async function submitForm() {
    if (!validateAll()) return;
    const f = S.form, site = f.site.trim();
    let cid = f.cust;
    if (isNewCust()) {
      const c = { id: uid('c'), name: f.newName.trim(), kind: 'ลูกค้าทั่วไป', contact: f.reporter.trim(), phone: f.phone.trim(), email: f.email.trim(), addr: f.newAddr.trim(), sites: [site], note: '', createdAt: now() };
      try { await Store.put('customers', c); } catch { return; }
      cid = c.id;
    } else {
      const c = cust(cid);
      if (c.id && !(c.sites || []).includes(site)) { c.sites = [...(c.sites || []), site]; Store.put('customers', c).catch(() => {}); }
    }
    const k = tech(f.tech), id = nextNo('WO', R.tickets), t0 = now();
    const t = {
      id, type: f.type, sev: f.sev, title: f.subject.trim(), detail: f.detail.trim(), cust: cid, site, reporter: f.reporter.trim(), phone: f.phone.trim(), email: f.email.trim(),
      channel: f.channel, asset: f.asset, date: f.date, slot: f.slot, tech: k ? k.id : null, coord: f.coord.trim() || me(), note: f.note.trim(), notify: f.notify, quote: f.quote,
      files: S.files.map(x => x.name), status: f.quote ? 'รออนุมัติ' : k ? 'รอนัดหมาย' : 'รอมอบหมาย', stage: 0, createdAt: t0, dueAt: t0 + slaH(f.sev) * HOUR,
      log: [logLine(f.sev === 'crit' ? 'crit' : '', `รับแจ้งทาง${f.channel}`, `${f.reporter.trim()} · รับเรื่องโดย ${f.coord.trim() || me()}`), ...(k ? [logLine('', `มอบหมายช่าง${k.name}`, `นัด ${dateTH(parseDay(f.date))} · ${f.slot}`)] : [])]
    };
    try { await Store.put('tickets', t); } catch { return; }
    S.form = null; S.formSec = 0; S.files = [];
    location.hash = id.toLowerCase();
    toast(`สร้างใบงาน ${id} แล้ว`);
  }

  // ---------- ticket detail ----------
  const STAGES = ['รับงาน', 'เดินทาง', 'ถึงหน้างาน', 'กำลังซ่อม', 'ปิดงาน'];
  const STAGE_NEXT = ['ช่างออกเดินทาง', 'ถึงหน้างานแล้ว', 'เริ่มซ่อม', 'ปิดงาน'];
  function message(t) {
    const c = cust(t.cust), k = tech(t.tech), who = (t.reporter || c.contact || 'ลูกค้า').split(/[·(]/)[0].trim();
    const techText = k ? `ช่าง${k.name.split(' ')[0]}เป็นผู้ดูแลงานนี้${k.phone ? ` (โทร ${k.phone})` : ''}` : 'ทีมกำลังเลือกช่างที่ว่างที่สุด';
    const when = t.date ? `นัดเข้าตรวจ ${dateTH(parseDay(t.date))} ช่วง ${t.slot}` : '';
    if (isDone(t)) return { polite: `เรียน${who} งาน "${t.title}" (${t.id}) ซ่อมเสร็จเรียบร้อยแล้วครับ ${t.resolution ? 'รายละเอียด: ' + t.resolution + ' ' : ''}หากพบปัญหาแจ้งได้ที่ ${D.company.phone} หรือ LINE ${D.company.line} ครับ`, short: `งาน ${t.id} ซ่อมเสร็จแล้วครับ`, friendly: `${who}ครับ งาน "${t.title}" เสร็จเรียบร้อยแล้วนะครับ มีอะไรทักมาได้ตลอดเลยครับ 🙏` }[S.tone];
    return {
      polite: `เรียน${who} ทีม ATS รับเรื่อง "${t.title}" ที่${t.site} แล้ว เลขที่ใบงาน ${t.id} ${techText} ${when} และจะแจ้งความคืบหน้าให้ทราบเป็นระยะครับ`,
      short: `รับเรื่องแล้ว ${t.id} · ${techText}${when ? ' · ' + when : ''}`,
      friendly: `${who}ครับ ได้รับเรื่อง "${t.title}" แล้วนะครับ ${techText} ${when} มีอะไรเพิ่มเติมทักมาได้ตลอดเลยครับ`
    }[S.tone];
  }
  const tlTime = ms => dayStart(ms) === dayStart() ? hm(ms) : shortDay(ms);
  function timeline(t) {
    const items = (t.log || []).slice().sort((a, b) => a.t - b.t);
    if (!isDone(t)) { const [step, why] = nextStep(t); items.push({ t: null, k: 'next', text: `ถัดไป: ${step}`, sub: why }); }
    return items.map(l => `<li class="tl ${l.k || ''}"><span class="tl-time">${l.t ? tlTime(l.t) : 'ถัดไป'}</span><span class="tl-dot"><i></i></span><div><div class="tl-title">${esc(l.text)}</div><div class="tl-sub">${esc(l.sub || '')}${l.by && l.t ? ` · ${esc(l.by)}` : ''}</div></div></li>`).join('');
  }
  function nextPanel(t) {
    const [step, why] = nextStep(t), free = R.techs.filter(k => !k.leave).sort((a, b) => (techState(a) === 'free' ? -1 : 0) - (techState(b) === 'free' ? -1 : 0)).slice(0, 3);
    let actions;
    if (isDone(t)) actions = `<div class="done-box">${icon('check-circle-2')}ปิดงานเมื่อ ${dateTH(t.closedAt)} ${hm(t.closedAt)} น.${t.rating ? ` · ลูกค้าให้ ${t.rating} ดาว` : ''}</div>${actBtn('reopen', 'เปิดงานอีกครั้ง', 'rotate-ccw', 'btn-sm btn-ghost', t.id)}`;
    else if (!t.tech) actions = free.length ? `<div class="btn-row">${free.map(k => actBtn('assign', k.name, 'user-plus', 'btn-sm', `${t.id}|${k.id}`)).join('')}</div>` : `<a class="btn btn-sm" href="#settings">${icon('user-plus')}เพิ่มช่างก่อน</a>`;
    else if (t.status === 'รออะไหล่') actions = `<div class="btn-row"><a class="btn btn-sm" href="#stock">${icon('package')}ไปหน้าสต็อก</a>${actBtn('set-status', 'อะไหล่มาแล้ว', 'package-check', 'btn-sm btn-primary', `${t.id}|กำลังดำเนินการ`)}</div>`;
    else if (t.status === 'รออนุมัติ') actions = actBtn('set-status', 'ลูกค้าอนุมัติแล้ว', 'check', 'btn-sm btn-primary', `${t.id}|รอนัดหมาย`);
    else if (t.status === 'รอตรวจรับ') actions = actBtn('close-job', 'ลูกค้าตรวจรับแล้ว · ปิดงาน', 'check-check', 'btn-sm btn-primary', t.id);
    else actions = actBtn('stage-next', STAGE_NEXT[clamp(t.stage || 0, 0, 3)], 'arrow-right', 'btn-sm btn-primary', t.id);
    return `<div class="ai-head"><span class="ai-badge">${icon('list-checks')}สิ่งที่ควรทำต่อ</span>${sla(t).over && !isDone(t) ? '<span class="pill t-crit">เกิน SLA</span>' : ''}</div><div class="ai-title">${esc(step)}</div><p class="muted small">${esc(why)}</p>${actions}`;
  }
  const stageBar = t => `<div class="trk-steps big">${STAGES.map((s, i) => `<i class="${i < (t.stage || 0) ? 'done' : i === (t.stage || 0) ? 'now' : ''}" title="${s}"></i>`).join('')}</div><div class="stage-labels">${STAGES.map((s, i) => `<span${i === (t.stage || 0) ? ' class="on"' : ''}>${s}</span>`).join('')}</div>`;
  VIEWS.detail = r => {
    const t = ticket(r.id);
    if (!t) return `<div class="page"><section class="card glass">${emptyBox('file-question', `ไม่พบใบงาน ${esc(r.id)}`, 'อาจถูกลบไปแล้ว หรือยังโหลดข้อมูลไม่เสร็จ', `<a class="btn" href="#tickets">กลับไปหน้าใบแจ้งซ่อม</a>`)}</section></div>`;
    const c = cust(t.cust), k = tech(t.tech), s = sla(t), a = asset(t.asset);
    const info = (label, val) => `<div class="info"><span class="info-label">${label}</span><span class="info-val">${val}</span></div>`;
    const stat = (label, val, sub, bad) => `<article class="card glass stat s3"><span class="kpi-label">${label}</span><span class="stat-val${bad ? ' bad' : ''}">${val}</span><span class="muted small">${sub}</span></article>`;
    const statusSel = `<select class="inline-sel" data-tk="status" data-v="${t.id}" aria-label="สถานะ">${Object.keys(D.statuses).map(st => `<option${st === t.status ? ' selected' : ''}>${st}</option>`).join('')}</select>`;
    const techSel = `<select class="inline-sel" data-tk="tech" data-v="${t.id}" aria-label="ช่างผู้รับผิดชอบ"><option value="">ยังไม่มอบหมาย</option>${R.techs.map(x => `<option value="${x.id}"${x.id === t.tech ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    return `<div class="page">
    <section class="detail-head">
      <div style="display:flex;gap:12px;align-items:flex-start;min-width:0"><a class="icon-btn back" href="#tickets" aria-label="กลับไปหน้าใบแจ้งซ่อม">${icon('arrow-left')}</a>
        <div style="min-width:0"><div class="eyebrow"><a href="#tickets">ใบแจ้งซ่อม</a> / ${t.id} / ${D.types[t.type].short}</div>
        <h1 class="ph-title">${esc(t.title)}</h1></div></div>
      <div class="ph-actions">${actBtn('del-ticket', 'ลบ', 'trash-2', 'btn-ghost', t.id)}${isDone(t) ? '' : actBtn('close-job', 'ปิดงาน', 'check', 'btn-primary', t.id)}</div>
    </section>
    <section class="info-strip glass">
      ${info('ระดับ', sevPill(t.sev))}${info('สถานะ', statusSel)}
      ${info('ลูกค้า', `<span class="av av-sm av-slate">${esc(c.name.replace(/^(บจก\.|หจก\.|คุณ)\s*/, '').slice(0, 1))}</span><span>${esc(c.name)}</span>`)}
      ${info('ช่างผู้รับผิดชอบ', techSel)}
      ${info('เปิดเมื่อ', `<span>${whenText(t.createdAt)} · ${esc(t.channel || '')}</span>`)}
      ${info('ผู้แจ้ง', `<span>${esc(t.reporter)}${t.phone ? ` · <a class="link" href="tel:${esc(t.phone.replace(/[^\d+]/g, ''))}">${esc(t.phone)}</a>` : ''}</span>`)}
    </section>
    <section class="grid">
      ${stat('SLA', s.text, `${D.severities[t.sev].label} · ครบกำหนด ${shortDay(t.dueAt)} ${hm(t.dueAt)} น.`, s.over)}
      ${stat('นัดหมาย', t.date ? shortDay(parseDay(t.date)) : '—', esc(t.slot || 'ยังไม่นัด'))}
      ${stat('ขั้นตอนงาน', STAGES[t.stage || 0], k ? esc(k.name) : 'ยังไม่มีช่าง')}
      ${stat('อุปกรณ์', a ? esc(a.code) : '—', a ? esc(a.name) : 'ให้ช่างตรวจหน้างาน')}
    </section>
    <section class="grid">
      <article class="card glass s4"><div class="card-head"><h2 class="card-title">ไทม์ไลน์</h2><span class="faint small">${(t.log || []).length} รายการ</span></div><ol class="timeline" id="tl">${timeline(t)}</ol>
        <div class="note-add"><textarea id="note-in" rows="2" placeholder="เพิ่มบันทึก เช่น โทรคุยกับลูกค้าแล้ว"></textarea>${actBtn('add-note', 'บันทึก', 'plus', 'btn-sm', t.id)}</div></article>
      <article class="card glass s4"><div class="card-head"><h2 class="card-title">ความคืบหน้า</h2></div>${stageBar(t)}
        ${t.detail ? `<div class="quote inner"><b>รายละเอียดจากผู้แจ้ง</b>${esc(t.detail)}</div>` : ''}
        ${t.note ? `<div class="quote inner"><b>หมายเหตุภายใน</b>${esc(t.note)}</div>` : ''}
        ${t.resolution ? `<div class="quote inner"><b>สรุปการแก้ไข</b>${esc(t.resolution)}${t.partUsed ? `<br><span class="hint">ใช้อะไหล่ ${esc(t.partUsed)}</span>` : ''}</div>` : ''}
        ${(t.files || []).length ? (t.files || []).map(n => `<div class="file-row inner">${icon('paperclip')}<span>${esc(n)}</span></div>`).join('') : ''}
        <div class="file-row inner">${icon('map-pin')}<span>${esc(t.site)} · ${esc(c.name)}</span>${contractOf(c.id) ? '<span class="pill t-ok" style="margin-left:auto">MA</span>' : ''}</div>
        ${c.addr ? `<div class="hint">${esc(c.addr)}</div>` : ''}</article>
      <div class="s4" style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <article class="card glass ai-panel" id="next">${nextPanel(t)}</article>
        <article class="card glass"><div class="card-head"><div><span class="ai-badge">${icon('message-circle')}ข้อความถึงลูกค้า</span><div class="card-sub">ถึง ${esc(t.reporter || c.contact || c.name)}</div></div></div>
          <div class="msg inner" id="msg">${esc(message(t))}</div>
          <div class="tone-row">น้ำเสียง ${seg('tone', [['polite', 'สุภาพ'], ['short', 'กระชับ'], ['friendly', 'เป็นกันเอง']], S.tone, 'seg-sm')}</div>
          <div class="btn-row">${actBtn('copy-msg', 'คัดลอกข้อความ', 'copy', 'btn-primary btn-sm')}<span class="hint">แล้ววางใน LINE ของลูกค้า</span></div></article>
      </div>
    </section></div>`;
  };

  // ---------- PM ----------
  const pmItem = p => { const k = tech(p.tech), d = parseDay(p.date); return `<button type="button" class="pm-item inner" data-act="pm-edit" data-v="${p.id}"><div class="pm-date"><b>${new Date(d).getDate()}</b><span>${dateTH(d, { month: 'short' })}</span></div><div style="min-width:0"><div class="cell-main">${esc(p.title)}</div><div class="cell-sub">${p.cust ? esc(cust(p.cust).name) : 'ไม่ระบุลูกค้า'} · ${k ? esc(k.short) : 'ยังไม่ระบุช่าง'}</div></div>${p.done ? '<span class="pill t-ok">เสร็จแล้ว</span>' : typeTag(p.type)}</button>`; };
  function pmItems() {
    const list = (S.pmDay ? R.pm.filter(p => p.date === S.pmDay) : pmIn(dayStart(), dayStart() + 7 * DAY)).sort((a, b) => a.done - b.done || a.date.localeCompare(b.date));
    if (!list.length) return emptyBox('calendar-x', S.pmDay ? `ไม่มีงาน PM วันที่ ${dateTH(parseDay(S.pmDay), { day: 'numeric', month: 'short' })}` : 'ไม่มีงาน PM ใน 7 วันข้างหน้า', 'กด เพิ่มงาน PM เพื่อวางแผนบำรุงรักษา');
    return list.map(pmItem).join('');
  }
  VIEWS.pm = () => {
    const m0 = new Date(S.pmMonth), y = m0.getFullYear(), mo = m0.getMonth(), days = new Date(y, mo + 1, 0).getDate(), offset = m0.getDay(), today = isoDay();
    const cells = [...Array(offset)].map(() => '<span class="cal-day blank"></span>').join('') + [...Array(days)].map((_, i) => {
      const iso = isoDay(new Date(y, mo, i + 1)), items = R.pm.filter(p => p.date === iso);
      return `<button type="button" class="cal-day${iso === today ? ' today' : ''}" data-act="pmday" data-v="${iso}" aria-pressed="${S.pmDay === iso}" aria-label="${i + 1}${items.length ? ` · งาน PM ${items.length} งาน` : ''}">${i + 1}<span class="cal-dots">${items.slice(0, 4).map(p => `<i${p.done ? ' class="done"' : ''}></i>`).join('')}</span></button>`;
    }).join('');
    const plan = pmIn(S.pmMonth, new Date(y, mo + 1, 1).getTime()), soon = maSoon();
    return `<div class="page">
    ${pageHead('งาน PM', 'calendar-check', 'งาน PM · บำรุงรักษาตามแผน', 'วางรอบตรวจเช็กตามสัญญา MA แล้วกดที่งานเพื่อติ๊กว่าเสร็จ', actBtn('pm-add', 'เพิ่มงาน PM', 'plus', 'btn-primary'))}
    <section class="grid">
      <article class="card glass s7"><div class="card-head"><div><h2 class="card-title">${m0.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</h2><p class="card-sub">${plan.length} งานในเดือนนี้ · เสร็จ ${plan.filter(p => p.done).length} · แตะวันที่เพื่อดูงาน</p></div>
        <div class="btn-row">${actBtn('pm-month', '', 'chevron-left', 'btn-sm', -1)}${actBtn('pm-month', 'เดือนนี้', '', 'btn-sm', 0)}${actBtn('pm-month', '', 'chevron-right', 'btn-sm', 1)}</div></div>
        <div class="cal">${['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => `<span class="cal-dow">${d}</span>`).join('')}${cells}</div>
        <div class="legend" style="margin-top:12px"><span><i style="background:var(--accent)"></i>ตามแผน</span><span><i style="background:var(--ok)"></i>เสร็จแล้ว</span></div></article>
      <div class="s5" style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <article class="card glass"><div class="card-head"><div><h2 class="card-title" id="pm-title">${S.pmDay ? `งาน PM วันที่ ${dateTH(parseDay(S.pmDay), { day: 'numeric', month: 'short' })}` : 'งาน PM ที่ถึงกำหนด (7 วัน)'}</h2><p class="card-sub">กดที่งานเพื่อแก้ไขหรือติ๊กว่าเสร็จ</p></div>
          <button class="link" data-act="pmday" data-v=""${S.pmDay ? '' : ' hidden'} id="pm-all">ดู 7 วันข้างหน้า</button></div>
          <div class="pm-list" id="pm-list">${pmItems()}</div></article>
        <article class="card glass"><div class="card-head"><div><h2 class="card-title">สัญญา MA ใกล้หมดอายุ</h2><p class="card-sub">ภายใน 60 วัน · มูลค่ารวม ${fmt(soon.reduce((s, m) => s + +m.value, 0))} ฿</p></div><a class="link" href="#ma">สัญญา ${icon('chevron-right')}</a></div>
          ${soon.map(x => `<div class="contract inner"><div><div class="cell-main">${esc(cust(x.cust).name)}</div><div class="cell-sub">${esc(x.plan)} · ${fmt(x.value)} ฿/ปี</div></div><span class="pill t-med">${dateTH(parseDay(x.end))}</span></div>`).join('') || emptyBox('file-check', 'ไม่มีสัญญาที่ใกล้หมดอายุ', '')}</article>
      </div>
    </section></div>`;
  };

  // ---------- live job tracking (positions are made up until the technician app sends GPS) ----------
  const activeJobs = () => openTickets().filter(t => t.tech).sort((a, b) => (b.stage || 0) - (a.stage || 0) || a.dueAt - b.dueAt);
  const stageTone = s => ['t-low', 't-info', 't-ok', 't-violet', 't-ok'][s] || 't-low';
  function trackList() {
    const jobs = activeJobs();
    if (!jobs.length) return emptyBox('route', 'ยังไม่มีงานที่มอบหมายช่าง', 'งานที่มีช่างรับแล้วจะขึ้นที่นี่ ให้ช่างกดเปลี่ยนขั้นตอนได้');
    return jobs.map(t => {
      const k = tech(t.tech), st = t.stage || 0;
      return `<div class="trk inner${S.trackSel === t.id ? ' on' : ''}" data-act="track-sel" data-v="${t.id}" role="button" tabindex="0">
        <span class="trk-top">${av(k)}<span style="min-width:0"><span class="cell-main">${esc(k ? k.name : '')}</span><span class="cell-sub">${t.id} · ${esc(cust(t.cust).name)}</span></span><span class="pill ${stageTone(st)}">${STAGES[st]}</span></span>
        <span class="trk-steps">${STAGES.map((_, i) => `<i class="${i < st ? 'done' : i === st ? 'now' : ''}"></i>`).join('')}</span>
        <span class="trk-foot"><span>${icon('clock')}${t.date ? shortDay(parseDay(t.date)) : ''} ${esc(t.slot || '')}</span><span class="trk-what">${esc(t.title)}</span></span>
        <span class="btn-row">${actBtn('stage-next', STAGE_NEXT[clamp(st, 0, 3)], 'arrow-right', 'btn-sm', t.id)}<a class="btn btn-sm btn-ghost" href="#${t.id.toLowerCase()}">เปิดใบงาน</a></span></div>`;
    }).join('');
  }
  function trackMap() {
    const roads = ['M0 50 C 20 47, 40 53, 100 45', 'M48 0 C 45 30, 51 70, 53 100', 'M0 21 C 30 25, 60 17, 100 27', 'M8 100 C 20 70, 32 58, 60 40 S 90 12, 100 8', 'M0 79 C 30 74, 70 83, 100 76'];
    const jobs = activeJobs(), HQ = { x: 50, y: 50 };
    const sites = [...new Set([...jobs.map(t => t.cust), ...camSites().map(s => s.cust)])].filter(Boolean);
    const pinAt = t => { const p = spot(t.cust || t.id), st = t.stage || 0; return st === 1 ? { x: (HQ.x + p.x) / 2, y: (HQ.y + p.y) / 2 } : st >= 2 ? { x: p.x + 3, y: p.y - 4 } : { x: HQ.x - 6 + (hash(t.id) % 12), y: HQ.y + 8 }; };
    return `<svg class="map-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${roads.map(d => `<path class="road" d="${d}"/>`).join('')}
        ${jobs.filter(t => (t.stage || 0) === 1).map(t => { const p = spot(t.cust || t.id); return `<path class="route${t.id === S.trackSel ? ' on' : ''}" d="M${HQ.x} ${HQ.y} L${p.x} ${p.y}"/>`; }).join('')}
      </svg>
      <span class="map-water" aria-hidden="true">อ่าวพัทยา</span>
      ${sites.map(id => { const p = spot(id), off = camSites().find(s => s.cust === id)?.off; return `<span class="site-pin${off ? ' off' : ''}" style="left:${p.x}%;top:${p.y}%" title="${esc(cust(id).name)}">${icon('building-2')}</span>`; }).join('')}
      <span class="hq-pin" style="left:${HQ.x}%;top:${HQ.y}%" title="สำนักงานใหญ่ ATS · นาเกลือ">${icon('house')}</span>
      ${jobs.map(t => { const k = tech(t.tech), p = pinAt(t), on = t.id === S.trackSel; return `<button type="button" class="tech-pin${on ? ' on' : ''}${(t.stage || 0) === 1 ? ' moving' : ''}" data-act="track-sel" data-v="${t.id}" style="left:${p.x}%;top:${p.y}%" aria-label="${esc(k.name)} · ${STAGES[t.stage || 0]}"><span class="av av-sm av-${k.hue}">${esc(k.initial)}</span>${on ? `<span class="pin-tag">${esc(k.short)} · ${STAGES[t.stage || 0]}</span>` : ''}</button>`; }).join('')}`;
  }
  VIEWS.track = () => {
    const jobs = activeJobs(), n = s => jobs.filter(t => (t.stage || 0) === s).length;
    if (!S.trackSel && jobs[0]) S.trackSel = jobs[0].id;
    return `<div class="page">
    ${pageHead('ติดตามงาน', 'route', 'ติดตามงานช่าง', 'ช่างกดเปลี่ยนขั้นตอน (ออกเดินทาง → ถึงหน้างาน → เริ่มซ่อม → ปิดงาน) แล้วทุกหน้าจะอัปเดตตาม')}
    <section class="stat-row">${mini('งานที่มีช่างรับ', jobs.length, `ช่าง ${new Set(jobs.map(t => t.tech)).size} คน`)}${mini('รอออกเดินทาง', n(0), 'รับงานแล้ว')}${mini('กำลังเดินทาง', n(1), 'ระหว่างทาง')}${mini('ถึงหน้างาน / ซ่อม', n(2) + n(3), 'อยู่ที่ลูกค้า')}${mini('ปิดงานวันนี้', R.tickets.filter(t => isDone(t) && t.closedAt >= dayStart()).length, 'ใบงาน')}</section>
    <section class="grid">
      <article class="card glass s8"><div class="card-head"><div><h2 class="card-title">แผนที่งานวันนี้</h2><p class="card-sub">บางละมุง · พัทยา · ศรีราชา · ตำแหน่งบนแผนที่เป็นภาพจำลองจนกว่าจะเชื่อมแอปช่าง</p></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>ช่าง</span><span><i style="background:var(--ok)"></i>ลูกค้า</span><span><i style="background:var(--crit)"></i>มีกล้องออฟไลน์</span></div></div>
        <div class="map" id="map">${trackMap()}</div></article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">งานที่กำลังทำ</h2><p class="card-sub">${jobs.length} งาน · แตะเพื่อดูบนแผนที่</p></div></div><div class="trk-list" id="trk-list">${trackList()}</div></article>
    </section></div>`;
  };

  // ---------- annual service contracts ----------
  function maState(m) { const d = daysLeft(m.end); return d < 0 ? ['หมดอายุแล้ว', 't-low'] : d <= 30 ? ['ใกล้หมดอายุ', 't-crit'] : d <= 60 ? ['เตรียมต่ออายุ', 't-high'] : ['ใช้งานอยู่', 't-ok']; }
  const pmUsed = m => R.pm.filter(p => p.cust === m.cust && p.done && p.date >= m.start && p.date <= m.end).length;
  function maRows() {
    const list = R.contracts.filter(m => { const d = daysLeft(m.end); return S.maFilter === 'all' || (S.maFilter === 'soon' ? d >= 0 && d <= 60 : S.maFilter === 'ok' ? d > 60 : d < 0); }).sort((a, b) => a.end.localeCompare(b.end));
    if (!R.contracts.length) return `<tr><td colspan="8">${emptyBox('file-plus', 'ยังไม่มีสัญญาบริการรายปี', R.customers.length ? 'สร้างสัญญาแรกเพื่อให้ระบบนับวันหมดอายุและรอบ PM ให้' : 'เพิ่มลูกค้าก่อน แล้วค่อยสร้างสัญญา', R.customers.length ? actBtn('ma-add', 'สร้างสัญญาใหม่', 'plus', 'btn-primary btn-sm') : '<a class="btn btn-sm" href="#customers">ไปหน้าลูกค้า</a>')}</td></tr>`;
    return list.map(m => {
      const c = cust(m.cust), st = maState(m), d = daysLeft(m.end), used = pmUsed(m), visits = +m.visits || 0;
      return `<tr><td><div class="cell-main">${esc(c.name)}</div><div class="cell-sub">${esc(c.contact || '—')} · ${esc(reach(c))}</div></td><td>${esc(m.plan)}</td><td class="tabnum">${fmt(m.value)} ฿</td>
        <td class="tabnum"><div>${dateTH(parseDay(m.start))} – ${dateTH(parseDay(m.end))}</div><div class="cell-sub">${d >= 0 ? `เหลือ ${d} วัน` : `หมดมาแล้ว ${-d} วัน`}</div></td>
        <td><div class="use"><span>${used} / ${visits} รอบ</span><div class="meter"><i style="width:${visits ? clamp(used / visits * 100, 0, 100) : 0}%"></i></div></div></td>
        <td class="tabnum">${m.sla || '—'} ชม.</td><td><span class="pill ${st[1]}">${st[0]}</span></td>
        <td><div class="btn-row">${d <= 60 ? actBtn('renew', 'ต่ออายุ', 'refresh-cw', 'btn-sm btn-primary', m.id) : ''}${actBtn('ma-edit', 'แก้ไข', 'pencil', 'btn-sm btn-ghost', m.id)}</div></td></tr>`;
    }).join('') || `<tr><td colspan="8">${emptyBox('file-check', 'ไม่มีสัญญาในกลุ่มนี้', '')}</td></tr>`;
  }
  VIEWS.ma = () => {
    const live = R.contracts.filter(m => daysLeft(m.end) >= 0), total = live.reduce((s, m) => s + +m.value, 0), soon = maSoon(), expired = R.contracts.length - live.length;
    const used = live.reduce((s, m) => s + pmUsed(m), 0), visits = live.reduce((s, m) => s + (+m.visits || 0), 0);
    return `<div class="page">
    ${pageHead('สัญญาบริการรายปี (MA)', 'file-text', 'สัญญาบริการรายปี (MA)', 'มูลค่าสัญญา รอบ PM ที่ทำไปแล้ว และสัญญาที่ต้องต่ออายุ · รอบ PM นับจากงาน PM ของลูกค้ารายนั้นที่ติ๊กเสร็จ', actBtn('ma-add', 'สร้างสัญญาใหม่', 'plus', 'btn-primary'))}
    <section class="grid">
      ${kpiTile('สัญญาที่ใช้งาน', 'file-text', '', live.length, 'สัญญา', `จากลูกค้า ${R.customers.length} ราย`)}
      ${kpiTile('มูลค่ารวมต่อปี', 'hand-coins', 'c-ok', fmt(total), '฿', `${live.length} สัญญาที่ยังไม่หมดอายุ`)}
      ${kpiTile('ใกล้หมดอายุ (60 วัน)', 'clock-alert', 'c-warm', soon.length, 'สัญญา', `มูลค่า ${fmt(soon.reduce((s, m) => s + +m.value, 0))} ฿`)}
      ${kpiTile('รอบ PM ที่ทำแล้ว', 'calendar-check', 'c-violet', visits ? Math.round(used / visits * 100) : '—', visits ? '%' : '', `${used} จาก ${visits} รอบ`)}
    </section>
    <section class="card glass"><div class="card-head"><div><h2 class="card-title">รายการสัญญา</h2><p class="card-sub">เรียงตามวันหมดอายุ</p></div>
      <div class="seg-scroll">${seg('maFilter', [['all', `ทั้งหมด<span class="count">${R.contracts.length}</span>`], ['soon', `ใกล้หมดอายุ<span class="count hot">${soon.length}</span>`], ['ok', `ใช้งานปกติ<span class="count">${live.length - soon.length}</span>`], ['expired', `หมดอายุ<span class="count">${expired}</span>`]], S.maFilter, 'seg-sm')}</div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>ลูกค้า</th><th>แผนบริการ</th><th>มูลค่า / ปี</th><th>ระยะสัญญา</th><th>รอบ PM</th><th>SLA</th><th>สถานะ</th><th></th></tr></thead><tbody id="ma-rows">${maRows()}</tbody></table></div></section></div>`;
  };

  // ---------- CCTV & devices ----------
  const ASSET_ST = { online: ['ออนไลน์', 'ok'], warn: ['มีปัญหา', 'high'], offline: ['ออฟไลน์', 'crit'] };
  function wall() {
    const list = cams().filter(a => a.cust === S.camSite).slice(0, 12), s = camSites().find(x => x.cust === S.camSite), t = hm(now());
    if (!list.length) return emptyBox('cctv', 'ยังไม่มีกล้องให้แสดง', '');
    return `<div class="wall">${list.map(a => { const off = a.status === 'offline'; return `<button type="button" class="cam${off ? ' off' : ''}" data-act="report" data-v="${a.id}" title="${esc(a.name)}"><span class="cam-ch">${esc(a.code)}</span>${off ? `<b>NO SIGNAL</b><span class="cam-t">ขาดการเชื่อมต่อ</span>` : a.status === 'warn' ? `<span class="cam-live warn">มีปัญหา</span><span class="cam-t">${esc(a.note || '')}</span>` : `<span class="cam-live">LIVE</span><span class="cam-t">${t}</span>`}</button>`; }).join('')}</div>
      <div class="hint">${esc(s ? s.name : '')} · ออฟไลน์ ${s ? s.off : 0} จาก ${s ? s.cams : 0} ตัว · ภาพจำลอง แตะกล้องที่มีปัญหาเพื่อแจ้งซ่อม</div>`;
  }
  VIEWS.cameras = () => {
    const c = cams(), on = c.filter(a => a.status === 'online').length, off = c.filter(a => a.status === 'offline').length, warn = c.filter(a => a.status === 'warn').length, sites = camSites();
    if (sites.length && !sites.some(s => s.cust === S.camSite)) S.camSite = (sites.find(s => s.off) || sites[0]).cust;
    const rec = R.assets.filter(a => /nvr|dvr/i.test(a.name + ' ' + a.code));
    return `<div class="page">
    ${pageHead('กล้อง CCTV & อุปกรณ์', 'cctv', 'กล้อง CCTV & อุปกรณ์', `สถานะกล้องจากทะเบียนทรัพย์สิน (ประเภท กล้องวงจรปิด) · ${sites.length} สถานที่`, `${actBtn('asset-add', 'เพิ่มกล้อง', 'plus', '', 'cctv')}<a class="btn btn-primary" href="#new">${icon('wrench')}แจ้งซ่อมกล้อง</a>`)}
    <section class="stat-row">
      ${mini('กล้องทั้งหมด', fmt(c.length), `${sites.length} สถานที่`)}${mini('ออนไลน์', `<span style="color:var(--ok-fg)">${fmt(on)}</span>`, c.length ? `${one(on / c.length * 100)}%` : '—')}
      ${mini('ออฟไลน์', `<span style="color:var(--crit-fg)">${off}</span>`, `${sites.filter(s => s.off).length} สถานที่`)}${mini('มีปัญหา', warn, 'ยังใช้งานได้')}${mini('NVR / DVR', rec.length, `ปกติ ${rec.filter(a => a.status === 'online').length}`)}
    </section>
    ${c.length ? `<section class="grid">
      <article class="card glass s5 radar-card cam-radar"><div class="radar-copy"><span class="live">สถานะกล้องทั้งหมด · สด</span>
        <div class="radar-big">${fmt(on)}<small> / ${fmt(c.length)} ตัวออนไลน์</small></div>
        <div class="off-list">${offList()}</div></div>${radarBox()}</article>
      <article class="card glass s7"><div class="card-head"><div><h2 class="card-title">ผนังกล้อง</h2><p class="card-sub">เลือกสถานที่</p></div>
        <div class="seg-scroll">${seg('camSite', sites.map(s => [s.cust, `${esc(s.name)}${s.off ? `<span class="count hot">${s.off}</span>` : ''}`]), S.camSite, 'seg-sm')}</div></div>
        <div id="wall">${wall()}</div></article>
      <article class="card glass s12"><div class="card-head"><div><h2 class="card-title">กล้องแยกตามสถานที่</h2><p class="card-sub">สีแดงคือมีกล้องออฟไลน์</p></div></div>
        <div class="site-grid">${sites.sort((a, b) => b.off - a.off).map(s => { const ok = s.cams - s.off; return `<div class="site inner"><div class="site-top"><span class="site-name">${esc(s.name)}</span>${s.off ? `<span class="pill t-crit">${s.off} ออฟไลน์</span>` : '<span class="pill t-ok">ปกติ</span>'}</div><div class="site-num">${ok}<span class="muted small"> / ${s.cams} ตัว</span></div><div class="meter${s.off ? ' low' : ''}"><i style="width:${ok / s.cams * 100}%"></i></div></div>`; }).join('')}</div></article>
    </section>` : `<section class="card glass">${emptyBox('cctv', 'ยังไม่มีกล้องในทะเบียน', R.customers.length ? 'เพิ่มกล้องของลูกค้า แล้วสถานะออนไลน์ / ออฟไลน์จะแสดงที่นี่' : 'เพิ่มลูกค้าก่อน แล้วค่อยเพิ่มกล้อง', R.customers.length ? actBtn('asset-add', 'เพิ่มกล้องตัวแรก', 'plus', 'btn-primary btn-sm', 'cctv') : '<a class="btn btn-sm" href="#customers">ไปหน้าลูกค้า</a>')}</section>`}</div>`;
  };

  // ---------- asset register + loans, transfers, moves ----------
  const nextPm = id => R.pm.filter(p => p.cust === id && !p.done && p.date >= isoDay()).sort((a, b) => a.date.localeCompare(b.date))[0];
  const moveState = m => m.kind === 'ยืม' && m.status === 'กำลังยืม' && m.due && m.due < isoDay() ? 'เกินกำหนดคืน' : m.status;
  function assetRows() {
    const rows = R.assets.filter(a => S.assetFilter === 'all' || a.status === S.assetFilter).sort((a, b) => (a.status === 'online') - (b.status === 'online') || a.code.localeCompare(b.code));
    if (!rows.length) return `<tr><td colspan="8">${R.assets.length ? emptyBox('search-x', 'ไม่มีอุปกรณ์ในกลุ่มนี้', '') : emptyBox('server', 'ยังไม่มีอุปกรณ์ในทะเบียน', R.customers.length ? 'ลงทะเบียนกล้อง NVR แอร์ คอมพิวเตอร์ ฯลฯ ของลูกค้า เพื่อดูประวัติซ่อมและประกัน' : 'เพิ่มลูกค้าก่อน แล้วค่อยลงทะเบียนอุปกรณ์', R.customers.length ? actBtn('asset-add', 'เพิ่มอุปกรณ์', 'plus', 'btn-primary btn-sm') : '<a class="btn btn-sm" href="#customers">ไปหน้าลูกค้า</a>')}</td></tr>`;
    return rows.map(a => { const w = a.warranty ? daysLeft(a.warranty) : null, p = nextPm(a.cust); return `<tr data-act="asset-edit" data-v="${a.id}">
      <td class="wo">${esc(a.code)}</td><td><div class="cell-main">${esc(a.name)}</div><div style="margin-top:4px">${typeTag(a.type)}</div></td>
      <td><div class="cell-main">${esc(cust(a.cust).name)}</div><div class="cell-sub">${esc(a.site || '')}</div></td>
      <td><span class="pill t-${ASSET_ST[a.status][1]}">${ASSET_ST[a.status][0]}</span></td><td class="muted">${esc(a.note || '')}</td>
      <td class="tabnum"${w != null && w < 0 ? ' style="color:var(--crit-fg)"' : ''}>${a.warranty ? dateTH(parseDay(a.warranty)) : '—'}</td><td class="tabnum">${p ? shortDay(parseDay(p.date)) : '—'}</td>
      <td>${a.status === 'online' ? '' : `<button class="btn btn-sm" data-act="report" data-v="${a.id}">${icon('wrench')}แจ้งซ่อม</button>`}</td></tr>`; }).join('');
  }
  const MOVE_TONE = { 'กำลังยืม': 't-info', 'ระหว่างทาง': 't-violet', 'เสร็จสิ้น': 't-ok', 'เกินกำหนดคืน': 't-crit' };
  function assetBody() {
    if (S.assetTab === 'moves') {
      if (!R.moves.length) return emptyBox('arrow-left-right', 'ยังไม่มีรายการยืม โอน หรือย้าย', 'บันทึกเมื่อนำอุปกรณ์สำรองไปให้ลูกค้ายืม หรือย้ายอุปกรณ์ระหว่างสาขา', actBtn('move-add', 'บันทึกการยืม / โอน', 'plus', 'btn-primary btn-sm'));
      return `<div class="table-wrap"><table class="tbl"><thead><tr><th>เลขที่</th><th>ประเภท</th><th>อุปกรณ์</th><th>จาก → ไป</th><th>ผู้รับผิดชอบ</th><th>วันที่</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${R.moves.slice().sort((a, b) => b.createdAt - a.createdAt).map(m => { const k = tech(m.tech), st = moveState(m); return `<tr><td class="wo">${esc(m.no)}</td><td><span class="tag">${icon(m.kind === 'ยืม' ? 'hand-coins' : m.kind === 'โอน' ? 'truck' : 'arrow-left-right')}${m.kind}</span></td><td class="cell-main">${esc(m.item)}</td>
        <td><div class="cell-sub">${esc(m.from)}</div><div>→ ${esc(m.to)}</div></td><td><div class="tech-cell">${av(k, 'av-sm')}${k ? esc(k.short) : '—'}</div></td><td class="tabnum"><div>${m.date ? shortDay(parseDay(m.date)) : '—'}</div><div class="cell-sub">${m.due ? 'คืน ' + shortDay(parseDay(m.due)) : ''}</div></td><td><span class="pill ${MOVE_TONE[st]}">${st}</span></td>
        <td>${m.status === 'เสร็จสิ้น' ? '' : actBtn('move-done', m.kind === 'ยืม' ? 'คืนแล้ว' : 'ถึงแล้ว', 'check', 'btn-sm', m.id)}</td></tr>`; }).join('')}</tbody></table></div>`;
    }
    const cnt = s => R.assets.filter(a => a.status === s).length;
    return `<div class="seg-scroll" style="margin-bottom:6px">${seg('assetFilter', [['all', `ทั้งหมด<span class="count">${R.assets.length}</span>`], ['online', `ออนไลน์<span class="count">${cnt('online')}</span>`], ['warn', `มีปัญหา<span class="count">${cnt('warn')}</span>`], ['offline', `ออฟไลน์<span class="count hot">${cnt('offline')}</span>`]], S.assetFilter, 'seg-sm')}</div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>รหัส</th><th>อุปกรณ์</th><th>ลูกค้า / สถานที่</th><th>สถานะ</th><th>หมายเหตุ</th><th>ประกันถึง</th><th>PM ถัดไป</th><th></th></tr></thead><tbody id="asset-rows">${assetRows()}</tbody></table></div>`;
  }
  VIEWS.assets = () => {
    const bad = R.assets.filter(a => a.status !== 'online').length, warr = R.assets.filter(a => a.warranty && daysLeft(a.warranty) >= 0 && daysLeft(a.warranty) <= 90).length;
    const loans = R.moves.filter(m => m.kind === 'ยืม' && m.status !== 'เสร็จสิ้น'), late = loans.filter(m => moveState(m) === 'เกินกำหนดคืน').length;
    return `<div class="page">
    ${pageHead('ทะเบียนทรัพย์สิน', 'server', 'ทะเบียนทรัพย์สิน', 'อุปกรณ์ที่ ATS ดูแลให้ลูกค้า พร้อมการยืม โอน และย้าย · แตะแถวเพื่อแก้ไข', `${actBtn('move-add', 'บันทึกการยืม / โอน', 'arrow-left-right')}${actBtn('asset-add', 'เพิ่มอุปกรณ์', 'plus', 'btn-primary')}`)}
    <section class="stat-row">
      ${mini('อุปกรณ์ในทะเบียน', fmt(R.assets.length), `${new Set(R.assets.map(a => a.cust)).size} ลูกค้า`)}${mini('มีปัญหา / ออฟไลน์', `<span style="color:var(--crit-fg)">${bad}</span>`, 'แตะ แจ้งซ่อม ในแถว')}
      ${mini('ประกันใกล้หมด', warr, 'ภายใน 90 วัน')}${mini('กำลังยืมอยู่', loans.length, late ? `${late} รายการเกินกำหนดคืน` : 'ไม่มีเกินกำหนด')}${mini('งาน PM ถัดไป', pmSoon()[0] ? shortDay(parseDay(pmSoon()[0].date)) : '—', pmSoon()[0] ? esc(cust(pmSoon()[0].cust).name) : 'ไม่มีใน 7 วัน')}
    </section>
    <section class="card glass"><div class="card-head"><div class="seg-scroll">${seg('assetTab', [['register', icon('server') + 'ทะเบียนอุปกรณ์'], ['moves', icon('arrow-left-right') + 'ยืม · โอน · ย้าย']], S.assetTab, 'seg-sm')}</div></div>
      <div id="asset-body">${assetBody()}</div></section></div>`;
  };

  // ---------- spare parts and purchasing ----------
  const PO_STAGES = ['ขอซื้อ', 'อนุมัติ', 'ออก PO', 'จัดส่ง', 'รับของ'];
  const openOrderFor = id => R.orders.find(o => o.part === id && o.stage < 4);
  function partsRows() {
    if (!R.parts.length) return `<tr><td colspan="6">${emptyBox('package-plus', 'ยังไม่มีอะไหล่ในคลัง', 'เพิ่มอะไหล่ที่ใช้บ่อย เช่น HDD สาย LAN น้ำยาแอร์ แล้วตั้งจำนวนขั้นต่ำ ระบบจะเตือนเมื่อใกล้หมด', actBtn('part-add', 'เพิ่มอะไหล่', 'plus', 'btn-primary btn-sm'))}</td></tr>`;
    return R.parts.slice().sort((a, b) => (+a.qty < +a.min ? 0 : 1) - (+b.qty < +b.min ? 0 : 1) || a.name.localeCompare(b.name, 'th')).map(p => {
      const low = +p.qty < +p.min, po = openOrderFor(p.id);
      return `<tr${low ? ' class="is-low"' : ''}><td class="wo">${esc(p.sku || '—')}</td><td><div class="cell-main">${esc(p.name)}</div><div style="margin-top:4px">${typeTag(p.type)}</div></td>
        <td><div class="qty"><span class="qty-ctl"><button type="button" class="icon-btn icon-btn-sm" data-act="qty" data-v="${p.id}|-1" aria-label="ลดจำนวน">${icon('minus')}</button><b class="${+p.qty === 0 ? 'zero' : low ? 'low' : ''}">${p.qty}</b><button type="button" class="icon-btn icon-btn-sm" data-act="qty" data-v="${p.id}|1" aria-label="เพิ่มจำนวน">${icon('plus')}</button></span><span class="hint">/ ขั้นต่ำ ${p.min} ${esc(p.unit)}</span></div><div class="meter${low ? ' low' : ' ok'}"><i style="width:${clamp(p.min ? p.qty / p.min * 100 : 100, 3, 100)}%"></i></div></td>
        <td>${esc(p.bin || '—')}</td><td class="tabnum">${fmt(p.price)} ฿</td>
        <td><div class="btn-row">${!low ? '<span class="pill t-ok">พอใช้</span>' : po ? `<span class="pill t-info">${po.id}</span>` : actBtn('reorder', 'ขอซื้อ', 'shopping-cart', 'btn-sm btn-primary', p.id)}${actBtn('part-edit', '', 'pencil', 'btn-sm btn-ghost', p.id)}</div></td></tr>`;
    }).join('');
  }
  function ordersHTML() {
    if (!R.orders.length) return emptyBox('receipt', 'ยังไม่มีใบขอซื้อ', 'กด ขอซื้อ ที่อะไหล่ที่ต่ำกว่าขั้นต่ำ หรือสร้างใบขอซื้อเอง');
    return R.orders.slice().sort((a, b) => (a.stage === 4) - (b.stage === 4) || b.createdAt - a.createdAt).map(o => `<div class="po inner"><div class="po-top"><div style="min-width:0"><div class="cell-main">${esc(o.item)}</div><div class="cell-sub">${o.id} · ${esc(o.vendor || 'ยังไม่เลือกผู้ขาย')}${o.ref ? ' · ' + esc(o.ref) : ''}</div></div><b class="tabnum">${fmt(o.amount)} ฿</b></div>
      <div class="po-steps">${PO_STAGES.map((s, i) => `<span class="${i < o.stage || o.stage === 4 ? 'done' : i === o.stage ? 'now' : ''}"><i></i>${s}</span>`).join('')}</div>
      <div class="po-foot">${icon(o.stage >= 4 ? 'package-check' : 'truck')}<span>${o.stage >= 4 ? `รับของแล้ว ${o.doneAt ? shortDay(o.doneAt) : ''}` : `ขั้นถัดไป: ${PO_STAGES[o.stage + 1]}`}</span><span class="tb-spacer"></span>${o.stage < 4 ? actBtn('po-next', PO_STAGES[o.stage + 1], 'arrow-right', 'btn-sm', o.id) : ''}${actBtn('po-del', '', 'trash-2', 'btn-sm btn-ghost', o.id)}</div></div>`).join('');
  }
  VIEWS.stock = () => {
    const low = lowParts().length, value = R.parts.reduce((s, p) => s + p.qty * p.price, 0), week = R.orders.filter(o => o.stage === 4 && o.doneAt >= now() - 7 * DAY);
    return `<div class="page">
    ${pageHead('สต็อกอะไหล่ & จัดซื้อ', 'package', 'สต็อกอะไหล่ & จัดซื้อ', 'คลังกลาง สำนักงานใหญ่ นาเกลือ · กด − / + เพื่อปรับจำนวน · เมื่อใบขอซื้อถึงขั้น รับของ จำนวนในคลังจะเพิ่มให้เอง', `${actBtn('po-add', 'สร้างใบขอซื้อ', 'receipt')}${actBtn('part-add', 'เพิ่มอะไหล่', 'plus', 'btn-primary')}`)}
    <section class="stat-row">
      ${mini('รายการอะไหล่', R.parts.length, 'ในคลังกลาง')}${mini('ต่ำกว่าจุดสั่งซื้อ', `<span style="color:var(--crit-fg)">${low}</span>`, low ? 'ควรสั่งเพิ่ม' : 'พอใช้ทั้งหมด')}${mini('มูลค่าคงคลัง', `${fmt(value)}<small> ฿</small>`, 'ราคาทุน')}
      ${mini('ใบขอซื้อที่ยังไม่ปิด', R.orders.filter(o => o.stage < 4).length, 'รอรับของ')}${mini('รับของ 7 วันนี้', week.length, week[0] ? esc(week[0].item) : '—')}
    </section>
    <section class="grid">
      <article class="card glass s8"><div class="card-head"><div><h2 class="card-title">อะไหล่ในคลัง</h2><p class="card-sub">แถบสีแดงคือต่ำกว่าจุดสั่งซื้อขั้นต่ำ</p></div></div>
        <div class="table-wrap"><table class="tbl" style="min-width:760px"><thead><tr><th>SKU</th><th>รายการ</th><th>คงเหลือ</th><th>ที่เก็บ</th><th>ราคา / หน่วย</th><th></th></tr></thead><tbody id="parts-rows">${partsRows()}</tbody></table></div></article>
      <article class="card glass s4"><div class="card-head"><div><h2 class="card-title">ติดตาม PR / PO</h2><p class="card-sub">ขอซื้อ → อนุมัติ → ออก PO → จัดส่ง → รับของ</p></div></div><div class="po-list" id="po-list">${ordersHTML()}</div></article>
    </section></div>`;
  };

  // ---------- customers, quotations and the website price list ----------
  const QT_TONE = { 'ร่าง': 't-low', 'ส่งให้ลูกค้าแล้ว': 't-info', 'รอลูกค้าอนุมัติ': 't-high', 'อนุมัติแล้ว': 't-ok', 'ไม่อนุมัติ': 't-crit' };
  const CUST_KINDS = ['บริษัท / โรงงาน', 'ร้านค้า / ร้านอาหาร', 'โรงแรม / คอนโด', 'บ้านพักอาศัย', 'โรงเรียน / หน่วยงาน', 'ลูกค้าทั่วไป'];
  const PRICE_TABS = [['cctv', 'cctv', 'กล้อง CCTV'], ['access', 'shield-check', 'Security'], ['ac', 'snowflake', 'แอร์'], ['net', 'network', 'Network'], ['shop', 'shopping-bag', 'สินค้าโปรโมชั่น']];
  const baht = p => p == null ? 'ติดต่อเรา' : p === 0 ? 'ฟรี' : `฿${fmt(p)}`;
  function priceBody() {
    const tabs = `<div class="seg-scroll" style="margin-bottom:6px">${seg('priceTab', PRICE_TABS.map(([v, ic, l]) => [v, icon(ic) + l]), S.priceTab, 'seg-sm')}</div>`;
    const qbtn = (title, price, cls) => `<button type="button" class="btn ${cls}" data-act="quote-from" data-v="${esc(title)}" data-amt="${price || 0}">${icon('receipt')}${price == null ? 'ขอใบเสนอราคา' : 'ใส่ใบเสนอราคา'}</button>`;
    if (S.priceTab === 'shop') return `${tabs}<div class="table-wrap"><table class="tbl" style="min-width:680px"><thead><tr><th>สินค้า / บริการ</th><th>หมวด</th><th class="ta-r">ราคา</th><th class="ta-r">ราคาปกติ</th><th></th></tr></thead><tbody>
      ${D.products.map(p => `<tr><td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.desc)}</div></td><td>${typeTag(p.cat)}</td><td class="ta-r tabnum"><b>${baht(p.price)}</b></td>
        <td class="ta-r tabnum">${p.was ? `<s class="faint">${baht(p.was)}</s> <span class="pill t-crit">−${Math.round((1 - p.price / p.was) * 100)}%</span>` : '<span class="faint">—</span>'}</td><td>${qbtn(p.name, p.price, 'btn-sm btn-ghost')}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">ราคาจากหน้าสินค้าของ www.ats-cctv.com · ลดราคาอยู่ ${D.products.filter(p => p.was).length} รายการ</p>`;
    return `${tabs}<div class="pkg-grid">${D.packages[S.priceTab].map(p => `<article class="pkg inner${p.hot ? ' hot' : ''}"><div class="pkg-top"><span class="pkg-size">${esc(p.size)}</span>${p.hot ? '<span class="pill t-info">ยอดนิยม</span>' : ''}</div><h3>${esc(p.name)}</h3>
        <div class="pkg-price">${baht(p.price)}${p.price != null ? `<small> / ${p.unit}</small>` : ''}</div>
        <ul>${p.items.map(x => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>${qbtn(p.name, p.price, 'btn-sm' + (p.hot ? ' btn-primary' : ''))}</article>`).join('')}</div>
      <div class="brand-row"><span class="hint">แบรนด์ที่จำหน่ายและติดตั้ง</span>${D.brands[S.priceTab].map(b => `<span class="tag">${esc(b)}</span>`).join('')}</div>
      <p class="hint">ราคาจากเว็บไซต์ อาจต่างไปตามพื้นที่ติดตั้ง · สำรวจหน้างานฟรี · ${esc(D.company.warranty.map(w => w.join(' ')).join(' · '))}</p>`;
  }
  const portalLeft = () => D.company.portalSites.filter(s => s !== 'ATSCCTV' && !R.customers.some(c => c.name === s));
  function custBody() {
    if (S.custTab === 'price') return priceBody();
    if (S.custTab === 'quotes') {
      if (!R.quotes.length) return emptyBox('receipt', 'ยังไม่มีใบเสนอราคา', 'สร้างเอง หรือไปที่แท็บ แพ็กเกจ & ราคา แล้วกด ใส่ใบเสนอราคา', actBtn('quote-add', 'สร้างใบเสนอราคา', 'plus', 'btn-primary btn-sm'));
      return `<div class="table-wrap"><table class="tbl"><thead><tr><th>เลขที่</th><th>ลูกค้า</th><th>รายการ</th><th class="ta-r">มูลค่า</th><th>วันที่</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${R.quotes.slice().sort((a, b) => b.createdAt - a.createdAt).map(q => `<tr><td class="wo">${q.id}</td><td class="cell-main">${esc(cust(q.cust).name)}</td><td>${esc(q.title)}</td><td class="ta-r tabnum">${fmt(q.amount)} ฿</td><td class="tabnum">${dateTH(q.createdAt)}</td>
        <td><select class="inline-sel" data-qt="${q.id}" aria-label="สถานะใบเสนอราคา ${q.id}">${Object.keys(QT_TONE).map(s => `<option${s === q.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td><td>${actBtn('quote-del', '', 'trash-2', 'btn-sm btn-ghost', q.id)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const left = portalLeft(), importBtn = left.length ? actBtn('import-portal', `เพิ่ม ${left.length} บริษัทจากระบบแจ้งซ่อมเดิม`, 'download', 'btn-sm') : '';
    if (!R.customers.length) return emptyBox('building-2', 'ยังไม่มีลูกค้าในระบบ', `เพิ่มลูกค้าเอง หรือดึงรายชื่อบริษัทจากระบบแจ้งซ่อมเดิม (${D.company.portalSites.filter(s => s !== 'ATSCCTV').join(', ')})`, actBtn('cust-add', 'เพิ่มลูกค้า', 'plus', 'btn-primary btn-sm') + importBtn);
    return `${left.length ? `<div class="note-box inner" style="margin-bottom:12px">${icon('info')}<span style="flex:1">ยังมีบริษัทจากระบบแจ้งซ่อมเดิมที่ไม่ได้เพิ่ม: ${left.join(', ')}</span>${importBtn}</div>` : ''}<div class="cust-grid">${R.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'th')).map((c, i) => {
      const open = R.tickets.filter(t => t.cust === c.id && !isDone(t)).length, ma = contractOf(c.id), n = R.assets.filter(a => a.cust === c.id).length;
      const ini = c.name.replace(/^(บจก\.|หจก\.|บริษัท|คุณ|ร้าน|โรงแรม|คอนโด)\s*/, '').slice(0, 1);
      return `<article class="cust inner"><div class="cust-top"><span class="av av-lg av-${HUES[hash(c.id) % HUES.length]}">${esc(ini)}</span><div style="min-width:0;flex:1"><div class="cell-main">${esc(c.name)}</div><div class="cell-sub">${esc(c.contact || 'ยังไม่มีผู้ติดต่อ')} · ${esc(reach(c))}</div></div>${actBtn('cust-edit', '', 'pencil', 'btn-sm btn-ghost', c.id)}</div>
        <div class="cust-meta"><span>${icon('map-pin')}${(c.sites || []).length} สถานที่</span><span>${icon('server')}${n} อุปกรณ์</span><span${open ? ' class="hot"' : ''}>${icon('wrench')}${open} งานเปิดอยู่</span></div>
        <div class="cust-pills">${ma ? `<span class="pill ${daysLeft(ma.end) <= 60 ? 't-high' : 't-ok'}">MA ${esc(ma.plan)} · เหลือ ${daysLeft(ma.end)} วัน</span>` : '<span class="pill t-low">ไม่มีสัญญา MA</span>'}${c.portal ? `<span class="pill t-info">${icon('globe')}ระบบแจ้งซ่อมเดิม</span>` : ''}</div>
        <div class="btn-row"><button type="button" class="btn btn-sm" data-act="cust-tickets" data-v="${c.id}">${icon('clipboard-list')}ดูใบงาน</button><button type="button" class="btn btn-sm" data-act="cust-new" data-v="${c.id}">${icon('plus')}แจ้งซ่อม</button></div></article>`;
    }).join('')}</div>`;
  }
  VIEWS.customers = () => {
    const waiting = R.quotes.filter(q => q.status === 'รอลูกค้าอนุมัติ' || q.status === 'ส่งให้ลูกค้าแล้ว');
    const s = stats(firstOfMonth());
    return `<div class="page">
    ${pageHead('ลูกค้า & สาขา', 'building-2', 'ลูกค้า & สาขา', 'ข้อมูลลูกค้า สถานที่ติดตั้ง สัญญา MA ใบเสนอราคา และแพ็กเกจราคาจากเว็บไซต์', `${actBtn('quote-add', 'สร้างใบเสนอราคา', 'receipt')}${actBtn('cust-add', 'เพิ่มลูกค้า', 'plus', 'btn-primary')}`)}
    <section class="stat-row">
      ${mini('ลูกค้าในระบบนี้', R.customers.length, `จากลูกค้าทั้งหมด ${D.company.stats[1][0]} ราย`)}${mini('มีสัญญา MA', new Set(R.contracts.filter(m => daysLeft(m.end) >= 0).map(m => m.cust)).size, 'ราย')}
      ${mini('สถานที่ที่ดูแล', R.customers.reduce((n, c) => n + (c.sites || []).length, 0), 'สาขา / อาคาร')}${mini('ใบเสนอราคารอตอบ', waiting.length, `มูลค่า ${fmt(waiting.reduce((n, q) => n + +q.amount, 0))} ฿`)}${mini('ความพึงพอใจ', s.sat == null ? '—' : `${s.sat.toFixed(1)}<small> / 5</small>`, s.reviews ? `จาก ${s.reviews} คะแนนเดือนนี้` : 'ยังไม่มีคะแนน')}
    </section>
    <section class="card glass"><div class="card-head"><div class="seg-scroll">${seg('custTab', [['list', icon('building-2') + `ลูกค้า<span class="count">${R.customers.length}</span>`], ['quotes', icon('receipt') + `ใบเสนอราคา<span class="count">${R.quotes.length}</span>`], ['price', icon('tag') + 'แพ็กเกจ & ราคา']], S.custTab, 'seg-sm')}</div></div>
      <div id="cust-body">${custBody()}</div></section></div>`;
  };

  // ---------- reports ----------
  VIEWS.reports = () => {
    const from = firstOfMonth(), closed = R.tickets.filter(t => isDone(t) && t.closedAt >= from);
    const byType = Object.keys(D.types).map(k => { const l = closed.filter(t => t.type === k); return [k, l.length ? Math.round(l.filter(t => t.closedAt <= t.dueAt).length / l.length * 1000) / 10 : null, l.length]; }).filter(x => x[2]);
    const board = R.techs.map(k => ({ k, ...techStats(k, from) })).sort((a, b) => b.closed - a.closed);
    return `<div class="page">
    ${pageHead('รายงาน & KPI', 'chart-column', 'รายงาน & KPI', 'ตัวชี้วัดคำนวณจากใบงาน งาน PM และทะเบียนทรัพย์สินในระบบ', demoBtn('ส่งออก PDF', 'file-text'))}
    <section class="grid">
      <article class="card glass s5"><div class="card-head"><div><h2 class="card-title">ตัวชี้วัดเดือนนี้</h2><p class="card-sub">${dateTH(from, { month: 'long', year: 'numeric' })}</p></div></div>${ringsHTML('rr')}</article>
      <article class="card glass s7"><div class="card-head"><div><h2 class="card-title">งานเข้าเทียบงานที่ปิดได้</h2><p class="card-sub">12 เดือนล่าสุด</p></div>
        <div class="legend"><span><i style="background:var(--chart-a)"></i>งานเข้า</span><span><i style="background:var(--chart-b)"></i>ปิดงานได้</span></div></div>
        <div class="chart" id="trend">${areaChart()}<div class="tip" hidden></div></div></article>
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">ผ่าน SLA ตามประเภทงาน</h2><p class="card-sub">งานที่ปิดเดือนนี้ · เส้นประคือเป้าหมาย 95%</p></div></div>
        ${byType.length ? `<div class="hbars">${byType.map(([k, v, n]) => `<div class="hbar"><span class="hbar-l">${icon(D.types[k].icon)}${D.types[k].label}</span><div class="hbar-track"><i style="width:${v}%"></i><span class="hbar-goal" style="left:95%"></span></div><b class="${v < 95 ? 'low' : ''}">${v}%</b><span class="faint small">${n} งาน</span></div>`).join('')}</div>` : emptyBox('chart-bar', 'ยังไม่มีงานที่ปิดเดือนนี้', 'ปิดงานในหน้าใบงาน แล้วกราฟจะขึ้นที่นี่')}</article>
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">อันดับทีมช่าง</h2><p class="card-sub">เดือนนี้ · เรียงตามจำนวนงานที่ปิด</p></div></div>
        <div class="table-wrap"><table class="tbl" style="min-width:520px"><thead><tr><th>#</th><th>ช่าง</th><th class="ta-r">ปิดงาน</th><th class="ta-r">ตรงเวลา</th><th class="ta-r">คะแนน</th></tr></thead><tbody>
        ${board.map((x, i) => `<tr><td class="tabnum muted">${i + 1}</td><td><div class="tech-cell">${av(x.k, 'av-sm')}${esc(x.k.name)}</div></td><td class="ta-r tabnum">${x.closed}</td><td class="ta-r tabnum">${x.ontime == null ? '—' : x.ontime + '%'}</td><td class="ta-r tabnum">${x.score == null ? '—' : icon('star') + ' ' + one(x.score)}</td></tr>`).join('')}</tbody></table></div></article>
    </section></div>`;
  };
  AFTER.reports = () => { fillRings(); wireTrend(); };

  // ---------- settings ----------
  const SKIN_NOTE = { light: 'พื้นสว่าง กระจกขาว อ่านง่ายตอนกลางวัน', night: 'น้ำเงินเข้มเรืองแสง เหมาะกับห้องมอนิเตอร์', aurora: 'ม่วงชมพู ใช้วงแหวนและกราฟสีสด' };
  const TEAMS = ['ทุกทีม', 'CCTV & Security', 'Air Service', 'IT & Network'];
  VIEWS.settings = () => {
    const counts = [['ใบงาน', R.tickets], ['ลูกค้า', R.customers], ['อุปกรณ์', R.assets], ['อะไหล่', R.parts], ['ใบขอซื้อ', R.orders], ['ใบเสนอราคา', R.quotes], ['สัญญา MA', R.contracts], ['งาน PM', R.pm], ['ยืม / โอน', R.moves]];
    return `<div class="page">
    ${pageHead('ตั้งค่า', 'sliders-horizontal', 'ตั้งค่า', 'ทีมช่าง เวลา SLA สไตล์หน้าจอ และข้อมูลทดสอบ')}
    <section class="grid">
      <article class="card glass s7"><div class="card-head"><div><h2 class="card-title">ทีมช่าง</h2><p class="card-sub">${R.techs.length} คน · ใช้ในการมอบหมายงานและรายงาน</p></div>${actBtn('tech-add', 'เพิ่มช่าง', 'user-plus', 'btn-sm btn-primary')}</div>
        <div class="team">${R.techs.map(k => { const st = techState(k); return `<div class="team-row">${av(k)}<div style="min-width:0"><div class="team-name">${esc(k.name)}</div><div class="team-meta"><span class="state ${st}"></span>${esc(k.team || '')} · ${STATE_TEXT[st]}${k.phone ? ' · ' + esc(k.phone) : ''}</div></div>${actBtn('tech-edit', 'แก้ไข', 'pencil', 'btn-sm btn-ghost', k.id)}</div>`; }).join('') || emptyBox('user-plus', 'ยังไม่มีช่าง', 'เพิ่มช่างก่อนจึงจะมอบหมายงานได้')}</div></article>
      <article class="card glass s5"><div class="card-head"><div><h2 class="card-title">ผู้ใช้งานเครื่องนี้</h2><p class="card-sub">ชื่อนี้ขึ้นมุมขวาบน และถูกบันทึกในไทม์ไลน์ใบงาน</p></div></div>
        <div class="field"><label for="me-in">ชื่อที่ใช้</label><input id="me-in" data-me value="${esc(me())}" autocomplete="off"></div>
        <p class="hint">จำไว้เฉพาะในเบราว์เซอร์นี้ คนอื่นที่เปิดลิงก์ตั้งชื่อของตัวเองได้</p></article>
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">เวลา SLA ตามความเร่งด่วน</h2><p class="card-sub">ใช้กับใบงานที่เปิดใหม่หลังจากนี้${Store.mode === 'db' ? ' · ทุกคนที่เปิดลิงก์ใช้ค่าเดียวกัน' : ''}</p></div></div>
        <div class="sla-set">${Object.entries(D.severities).map(([k, v]) => `<label class="sla-line inner">${sevPill(k)}<span class="hint">${esc(v.slaText.split('·')[1] || '')}</span><span class="sla-in"><input type="number" min="1" max="168" value="${slaH(k)}" data-sla="${k}" aria-label="ชั่วโมง SLA ระดับ${v.label}"> ชม.</span></label>`).join('')}</div></article>
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">การแจ้งเตือน</h2><p class="card-sub">ยังไม่ได้เชื่อม LINE / SMS / อีเมลจริง ตั้งค่าไว้ก่อนได้</p></div></div>
        <div class="toggles inner">${[['line', 'LINE', 'ส่งสถานะงานให้ลูกค้าและช่างทาง LINE'], ['sms', 'SMS', 'สำรองเมื่อส่ง LINE ไม่ได้'], ['email', 'อีเมลสรุปรายวัน', 'สรุปงานค้างทุกเช้า 08:00 น.'], ['sound', 'เสียงเตือนบนหน้าจอ', 'เมื่อมีงานวิกฤตเข้ามาใหม่']].map(([k, t, d]) => `<div class="toggle"><span><b>${t}</b><br><span class="hint">${d}</span></span><span class="switch"><input type="checkbox" data-notify="${k}"${S.notify[k] ? ' checked' : ''} aria-label="${t}"><span></span></span></div>`).join('')}</div></article>
    </section>
    <section class="card glass"><div class="card-head"><div><h2 class="card-title">สไตล์หน้าจอ</h2><p class="card-sub">จำไว้ในเบราว์เซอร์นี้ · ปุ่มเดียวกับมุมขวาบน</p></div></div>
      <div class="skin-cards">${SKINS.map(([v, l]) => `<button type="button" class="skin-card" data-act="skin" data-v="${v}" aria-pressed="${effectiveSkin() === v}"><span class="sk-prev sk-${v}"><i></i><i></i><i></i></span><b>${l}</b><span class="hint">${SKIN_NOTE[v]}</span></button>`).join('')}</div></section>
    <section class="grid">
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">ข้อมูลบริษัท</h2><p class="card-sub">จาก www.ats-cctv.com</p></div></div>
        <dl class="kv"><dt>ชื่อบริษัท</dt><dd>${D.company.name} · ${D.company.en}</dd><dt>ที่อยู่</dt><dd>${D.company.addr}</dd><dt>เลขผู้เสียภาษี</dt><dd>${D.company.tax}</dd><dt>โทร / LINE</dt><dd>${D.company.phone} · LINE ${D.company.line}</dd><dt>อีเมล</dt><dd>${D.company.email}</dd><dt>เวลาทำการ</dt><dd>${D.company.hours} · บริการหลังการขาย 24/7</dd><dt>รับประกัน</dt><dd>${D.company.warranty.map(w => w.join(' ')).join(' · ')}</dd></dl></article>
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">ข้อมูลในระบบ</h2><p class="card-sub">ATS Service Hub · ต้นแบบสำหรับทดสอบ</p></div>${modePill()}</div>
        <div class="count-grid">${counts.map(([l, a]) => `<div class="inner"><b>${a.length}</b><span>${l}</span></div>`).join('')}</div>
        <p class="hint">${Store.mode === 'db' ? 'ข้อมูลเก็บไว้กับลิงก์นี้ ทุกคนที่เปิดลิงก์และมีสิทธิ์แก้ไขจะเห็นข้อมูลชุดเดียวกัน' : 'ข้อมูลเก็บไว้ในเบราว์เซอร์นี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์หรือเปิดเครื่องอื่นจะไม่เห็น'}</p>
        <div class="btn-row">${actBtn('wipe', 'ล้างข้อมูลทดสอบทั้งหมด', 'trash-2', 'btn-danger')}</div></article>
    </section></div>`;
  };

  // ---------- help ----------
  VIEWS.help = () => `<div class="page">
    ${pageHead('ช่วยเหลือ', 'circle-help', 'ช่วยเหลือ', 'ติดต่อทีมงาน วิธีทดสอบระบบ และคีย์ลัด')}
    <section class="grid">
      <article class="card glass s4 contact"><span class="chip-icon c-warm">${icon('phone')}</span><h2 class="card-title">โทรหาศูนย์บริการ</h2><b class="big">${D.company.phone}</b><p class="hint">${D.company.hours} · บริการหลังการขาย 24/7</p></article>
      <article class="card glass s4 contact"><span class="chip-icon c-ok">${icon('message-circle')}</span><h2 class="card-title">LINE</h2><b class="big">${D.company.line}</b><p class="hint">ส่งรูปอาการเสียได้ทันที</p></article>
      <a class="card glass s4 contact" href="#brand"><span class="chip-icon">${icon('aperture')}</span><h2 class="card-title">โลโก้ ats-cctv</h2><b class="big">ดูลูกเล่นและวิธีทำ</b><p class="hint">มีขั้นตอนทำเองใน Figma 6 ขั้น</p></a>
      <article class="card glass s12"><div class="card-head"><div><h2 class="card-title">${D.company.brand}</h2><p class="card-sub">${D.company.en} · ${D.company.tagline}</p></div></div>
        <div class="about-stats">${D.company.stats.map(([v, l]) => `<div class="inner"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
        <div class="divisions">${D.company.divisions.map(d => `<div class="division inner"><span class="chip-icon">${icon(d.icon)}</span><div style="min-width:0"><b>${d.name}</b><p>${d.does}</p><span class="hint">${d.stat}</span></div></div>`).join('')}</div></article>
      <article class="card glass s6"><div class="card-head"><h2 class="card-title">ช่องทางติดต่ออื่น</h2></div>
        <dl class="kv"><dt>อีเมล</dt><dd><a class="link" href="mailto:${D.company.email}">${D.company.email}</a></dd><dt>Facebook</dt><dd><a class="link" href="${D.company.facebook}" target="_blank" rel="noopener">Facebook Page ${icon('external-link')}</a></dd><dt>เว็บไซต์</dt><dd><a class="link" href="${D.company.web}" target="_blank" rel="noopener">www.ats-cctv.com ${icon('external-link')}</a></dd><dt>ที่อยู่</dt><dd>${D.company.name}<br>${D.company.addr}</dd><dt>On-site</dt><dd>${D.company.onsite}</dd></dl></article>
      <article class="card glass s6"><div class="card-head"><div><h2 class="card-title">ระบบแจ้งซ่อมออนไลน์เดิม</h2><p class="card-sub">ระบบที่ลูกค้าใช้อยู่ตอนนี้ · หน้าจอนี้จะมาแทนในอนาคต</p></div></div>
        <div class="portal-list">
          <a class="inner portal-row" href="${D.company.portal}" target="_blank" rel="noopener">${icon('log-in')}<span><b>เข้าสู่ระบบ</b><span class="hint">เจ้าหน้าที่ และพนักงานของบริษัทลูกค้า</span></span>${icon('external-link')}</a>
          <div class="inner portal-row">${icon('qr-code')}<span><b>แจ้งซ่อมด้วย QR</b><span class="hint">สแกนสติกเกอร์บนอุปกรณ์ แล้วฟอร์มจะขึ้นพร้อมรหัสเครื่อง</span></span></div>
          <a class="inner portal-row" href="https://www.ats-cctv.com/itservice/public_internet_register.php" target="_blank" rel="noopener">${icon('wifi')}<span><b>ลงทะเบียน WiFi</b><span class="hint">ผู้ใช้อินเทอร์เน็ตในพื้นที่ที่ ATS ดูแล</span></span>${icon('external-link')}</a>
        </div></article>
      <article class="card glass s6"><div class="card-head"><h2 class="card-title">ลองทดสอบตามลำดับนี้</h2></div>
        <ol class="test-steps">${[['เพิ่มลูกค้า', 'หน้า ลูกค้า & สาขา → เพิ่มลูกค้า หรือดึง 5 บริษัทจากระบบเดิม'], ['เพิ่มอุปกรณ์', 'หน้า ทะเบียนทรัพย์สิน → เพิ่มกล้องหรือแอร์ของลูกค้า'], ['แจ้งซ่อม', 'ปุ่ม แจ้งซ่อมใหม่ → กรอกแล้วส่ง จะได้เลขใบงาน WO'], ['ทำงานตามขั้น', 'ในหน้าใบงานหรือหน้าติดตามงาน กด ช่างออกเดินทาง → ถึงหน้างาน → เริ่มซ่อม'], ['ปิดงาน', 'กดปิดงาน ใส่สรุปการแก้ไข อะไหล่ที่ใช้ และคะแนนจากลูกค้า'], ['ดูผล', 'หน้าภาพรวม Command Center และรายงานจะคำนวณตัวเลขใหม่ทันที']].map(([b, p]) => `<li class="inner"><b>${b}</b><span class="hint">${p}</span></li>`).join('')}</ol></article>
      <article class="card glass s6"><div class="card-head"><h2 class="card-title">คำถามที่พบบ่อย</h2></div>
        <div class="faq">${[['ข้อมูลที่กรอกหายไหม', Store.mode === 'db' ? 'ไม่หาย ข้อมูลเก็บไว้กับลิงก์นี้ เปิดจากเครื่องอื่นก็เห็นข้อมูลชุดเดียวกัน' : 'เก็บไว้ในเบราว์เซอร์นี้ ถ้าล้างประวัติเบราว์เซอร์หรือเปิดเครื่องอื่นจะไม่เห็น'], ['ข้อมูลอะไรเป็นของจริง', 'ข้อมูลบริษัท บริการ แพ็กเกจ ราคา และแบรนด์มาจาก www.ats-cctv.com ส่วนลูกค้า ใบงาน และอื่น ๆ คือสิ่งที่กรอกเอง'], ['อยากเริ่มใหม่หมด', 'หน้า ตั้งค่า → ล้างข้อมูลทดสอบทั้งหมด (ทีมช่างและเวลา SLA ยังอยู่)'], ['ทำไมกดบางปุ่มแล้วขึ้นว่าเป็นปุ่มตัวอย่าง', 'ปุ่มที่ต้องเชื่อมระบบภายนอก เช่น ส่ง LINE หรือส่งออก PDF ยังไม่ได้เชื่อม'], ['ใช้บนมือถือได้ไหม', 'ได้ บนมือถือเมนูจะย้ายไปอยู่ด้านล่าง และปุ่ม เมนู จะเปิดรายการทั้งหมด']].map(([q, a]) => `<details class="inner"><summary>${q}${icon('chevron-down')}</summary><p>${a}</p></details>`).join('')}</div>
        <div class="keys" style="margin-top:14px">${[['Ctrl K', 'ค้นหาใบงานจากช่องค้นหาด้านบน'], ['Esc', 'ปิดหน้าต่างหรือเมนู'], ['ชี้แถบซ้าย', 'แถบเมนูขยายออกและแสดงชื่อทุกหมวด']].map(([k, d]) => `<div class="key-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div></article>
    </section></div>`;


  // brand / logo page
  VIEWS.brand = () => `<div class="page">
    <section class="page-head"><div><div class="eyebrow">แบรนด์</div><h1 class="ph-title">โลโก้ใหม่ ats-cctv</h1>
      <p class="ph-sub">ตัวกล้องสีเข้ม เลนส์ที่มีเรดาร์กวาดอยู่ตลอดเวลา (All The Time) และไฟ REC สีแดงที่ใช้เป็นขีดกลางของชื่อด้วย</p></div></section>
    <section class="card glass brand-hero"><span class="radar-bg" aria-hidden="true"></span>
      <div id="brand-logo">${L.lockup({ size: 'xl', tag: true, snap: true })}</div>
      <div class="brand-hint"><span>${icon('mouse-pointer-2')}ขยับเมาส์ กล้องจะมองตาม</span><span>${icon('camera')}แตะที่ตัวกล้องเพื่อถ่ายภาพ</span><span>${icon('timer')}ปล่อยไว้เฉย ๆ กล้องจะส่ายหาเอง</span></div>
      <div class="btn-row" style="justify-content:center"><button class="btn btn-primary" data-act="replay">${icon('play')}เล่นอนิเมชั่นอีกครั้ง</button><button class="btn" data-act="snap">${icon('aperture')}ถ่ายภาพ</button></div>
      <span class="muted small" id="snaps" aria-live="polite">${S.snaps ? `ถ่ายไปแล้ว ${S.snaps} ภาพ` : 'ยังไม่ได้ถ่าย'}</span>
    </section>
    <section><h2 class="card-title" style="margin:6px 4px 12px">ลูกเล่นในโลโก้</h2><div class="feat-grid">
      ${[['ตามองตาม', 'ม่านตาขยับตามตำแหน่งเมาส์ ภายในรัศมี 3.4 หน่วย เหมือนกล้องที่คอยเฝ้าดู', ''],
         ['เรดาร์ 24 ชม.', 'แสงกวาดหมุนรอบเลนส์ทุก 3.6 วินาที แทนความหมาย All The Time', ''],
         ['ไฟ REC = ขีดกลาง', 'จุดแดงบนวงเลนส์กับขีดใน ats-cctv กะพริบพร้อมกันเหมือนกล้องกำลังบันทึก', ''],
         ['แตะเพื่อถ่าย', 'ม่านตาหดแล้วขยายพร้อมแสงแฟลช 0.55 วินาที ใช้เป็นปุ่มรีเฟรชหรือแคปภาพได้', 'can-snap']
        ].map(([h, p, cls]) => `<article class="card glass feat"><div class="feat-demo"><span class="logo ${cls}" style="font-size:34px">${L.mark()}</span></div><h3>${h}</h3><p>${p}</p></article>`).join('')}
    </div></section>
    <section><h2 class="card-title" style="margin:6px 4px 12px">ใช้บนพื้นหลังต่าง ๆ</h2><div class="usage-grid">
      <div class="usage u-light">${L.lockup({ size: 'sm' })}<span class="cap">พื้นสว่าง</span></div>
      <div class="usage u-dark">${L.lockup({ size: 'sm' })}<span class="cap">พื้นมืด</span></div>
      <div class="usage u-grad">${L.lockup({ size: 'sm' })}<span class="cap">พื้นสีแบรนด์ (cctv เป็นสีขาว)</span></div>
      <div class="usage u-sizes">${[64, 40, 28, 18].map(s => `<span style="font-size:${s / 1.7}px;display:grid;justify-items:center;gap:6px">${L.mark()}<span class="faint" style="font-size:11px">${s}px</span></span>`).join('')}<span class="cap">ไอคอนแอป / favicon</span></div>
    </div></section>
    <section class="card glass"><div class="card-head"><div><h2 class="card-title">ทำเองใน Figma</h2><p class="card-sub">ขนาดอ้างอิงจากกรอบ 64 × 64 · ลากไฟล์ <span class="code">prototype/brand/ats-cctv-logo.svg</span> เข้า Figma เพื่อดูของจริงได้</p></div></div>
      <div class="build">
        <div class="build-diagram inner">${buildDiagram()}</div>
        <ol class="steps">
          <li class="inner"><div><b>ตัวกล้อง</b><p>กด F สร้าง Frame 64 × 64 แล้วกด R วาดสี่เหลี่ยม 60 × 60 วางที่ X 2, Y 2 ตั้ง Corner radius 18 ใส่สีไล่จาก <span class="code">#1A2340</span> ลง <span class="code">#0B1022</span></p></div></li>
          <li class="inner"><div><b>วงเลนส์</b><p>กด O แล้วกด Shift ลากวงกลม 34 × 34 ให้จุดกลางอยู่ที่ 32, 32 ลบ Fill ใส่ Stroke 4 แบบ Center และ Round cap ไล่สีฟ้าไปม่วง จากนั้นดึงจุด Arc ที่ขอบวงให้เหลือช่องว่างทางขวาบนประมาณ 58°</p></div></li>
          <li class="inner"><div><b>ม่านตา</b><p>วงกลม 15 × 15 ไล่สีแบบ Radial (ฟ้าอ่อน → น้ำเงิน → กรมท่า) ซ้อนด้วยรูม่านตา 6.8 × 6.8 สี <span class="code">#050814</span> และจุดสะท้อนแสงสีขาว 3 × 3 ที่มุมซ้ายบน แล้ว Group ทั้งสามชิ้นตั้งชื่อว่า eye</p></div></li>
          <li class="inner"><div><b>ไฟ REC</b><p>วงกลมแดง <span class="code">#F43F5E</span> ขนาด 7.2 × 7.2 วางลงในช่องว่างของวงเลนส์ (จุดกลาง 44, 20)</p></div></li>
          <li class="inner"><div><b>ตัวอักษร</b><p>พิมพ์ ats ด้วยฟอนต์ Outfit Bold ขีดกลางเป็นสี่เหลี่ยมมุมมนสีแดงเดียวกับไฟ REC และพิมพ์ cctv ด้วย Outfit Medium ไล่สีฟ้าไปม่วง</p></div></li>
          <li class="inner"><div><b>ทำให้ขยับ</b><p>Duplicate เฟรมเป็น 2 อัน เลื่อน eye ไปซ้าย 3 px ในอันแรก ขวา 3 px ในอันที่สอง แล้วเข้าแท็บ Prototype ลากเชื่อมกัน เลือก After delay 800ms + Smart animate ทั้งไปและกลับ</p></div></li>
        </ol>
      </div>
      <div class="swatches">${[['#0B1022', 'ตัวกล้อง'], ['#22D3EE', 'ฟ้าเลนส์'], ['#3B82F6', 'น้ำเงิน'], ['#8B5CF6', 'ม่วง'], ['#F43F5E', 'ไฟ REC'], ['#111318', 'ตัวอักษร']].map(([c, n]) => `<span class="sw"><i style="background:${c}"></i>${n} <span class="code">${c}</span></span>`).join('')}</div>
    </section></div>`;
  function buildDiagram() {
    const grid = [...Array(9)].map((_, i) => `<line x1="${i * 8}" y1="0" x2="${i * 8}" y2="64" style="stroke:var(--line)" stroke-width=".2"/><line x1="0" y1="${i * 8}" x2="64" y2="${i * 8}" style="stroke:var(--line)" stroke-width=".2"/>`).join('');
    const guide = 'style="stroke:var(--accent)" stroke-width=".3" stroke-dasharray="1 1" fill="none"';
    return `<svg viewBox="-4 -4 72 80" role="img" aria-label="แบบโครงสร้างโลโก้พร้อมขนาด">${grid}
      <g transform="translate(0 0)">${L.mark().replace('<svg class="logo-mark "', '<svg x="0" y="0" width="64" height="64" class="logo-mark static"')}</g>
      <circle cx="32" cy="32" r="17" ${guide}/><circle cx="32" cy="32" r="7.5" ${guide}/><line x1="32" y1="32" x2="49" y2="32" ${guide}/>
      <text x="40" y="35.5">r 17</text><text x="2" y="70">กรอบ 64 · ตัวกล้อง 60 · มุม 18</text><text x="2" y="74">เลนส์ r 17 เส้น 4 · ม่านตา r 7.5 · REC r 3.6</text>
      <line x1="44" y1="20" x2="56" y2="8" ${guide}/><text x="50" y="6.5">REC</text></svg>`;
  }
  AFTER.brand = () => { L.replay($('#brand-logo .logo')); };

  // ---------- router ----------
  const ROUTES = ['overview', 'command', 'tv', 'tickets', 'new', 'track', 'pm', 'ma', 'cameras', 'assets', 'stock', 'customers', 'reports', 'settings', 'help', 'brand'];
  const DOCK_OF = { overview: 0, tickets: 1, detail: 1, new: 2, pm: 3 };
  function parse() {
    const h = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    if (/^wo-\d{4}-\d{4}$/.test(h)) return { name: 'detail', id: h.toUpperCase() };
    return { name: ROUTES.includes(h) ? h : 'overview' };
  }
  let first = true, stale = false, wasLoading = false;
  // header badge, rail badges and the signed-in name follow the records
  function chrome() {
    const n = alerts().reduce((s, a) => s + a.count, 0), b = $('#bell .badge');
    if (b) { b.textContent = n; b.hidden = !n; }
    const name = me();
    $('.me-text b') && ($('.me-text b').textContent = name);
    $('.av-me') && ($('.av-me').textContent = name.slice(0, 1));
    Rail.badges({ tickets: overSla().length, pm: pmSoon().length, stock: lowParts().length });
  }
  // soft = redraw the same page in place after a data change (no entrance animation, keep the scroll)
  function render(soft) {
    const r = parse(), key = r.name + (r.id || ''), y = scrollY, loading = Store.mode === 'loading';
    if (!soft) closePop();
    stopTimers();
    if (wasLoading && !loading) soft = false;
    view.classList.toggle('calm', !!soft);
    view.innerHTML = loading ? `<div class="page"><section class="card glass">${emptyBox('loader', 'กำลังโหลดข้อมูล…', 'รอสักครู่')}</section></div>` : VIEWS[r.name](r);
    wasLoading = loading;
    $$('.page > *, .grid > *', view).forEach((n, i) => n.style.setProperty('--d', Math.min(i, 10)));
    refreshIcons();
    Seg.all(view);
    if (!loading) AFTER[r.name]?.(r);
    const nav = r.name in NAV_OF ? NAV_OF[r.name] : r.name;
    Rail.go(nav, !first);
    const slot = r.name === 'brand' ? -1 : DOCK_OF[r.name] ?? 4;
    Dock.go(slot, !first, slot === 4 ? NAV_ICON[nav] : null);
    chrome();
    if (soft) scrollTo(0, y);
    else if (!first && key !== S.route) scrollTo(0, 0);
    S.route = key;
    first = false;
  }
  addEventListener('hashchange', () => { if (Modal.isOpen()) Modal.close(); render(); });
  const typing = () => { const a = document.activeElement; return a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const busy = () => Modal.isOpen() || parse().name === 'new' || typing();
  // a change from this or another viewer: redraw unless someone is filling something in
  function onData() {
    if (first || wasLoading) { render(); return; }
    if (busy()) { stale = true; chrome(); return; }
    render(true);
  }
  // SLA timers count down: refresh pages that show them once a minute
  setInterval(() => {
    if (document.visibilityState !== 'visible' || busy() || !['overview', 'command', 'tv', 'tickets', 'detail', 'track'].includes(parse().name)) return;
    render(true);
  }, 60000);

  // ---------- popover, toast, modal ----------
  function toast(msg, ic = 'circle-check') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = icon(ic) + `<span>${esc(msg)}</span>`;
    $('#toasts').append(t);
    refreshIcons();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3400);
  }
  // the popover lives outside the header: a blurred pane nested in another blurred pane can't blur the page behind it
  function closePop() {
    $('#pop-layer').innerHTML = '';
    $('#bell').setAttribute('aria-expanded', 'false');
  }
  function openPop() {
    const b = $('#bell').getBoundingClientRect(), list = alerts();
    $('#pop-layer').innerHTML = `<div class="pop glass" role="dialog" aria-label="การแจ้งเตือน" style="top:${Math.round(b.bottom + 10)}px;right:${Math.max(12, Math.round(innerWidth - b.right))}px"><div class="pop-title">${list.length ? 'ต้องดำเนินการด่วน' : 'การแจ้งเตือน'}<span class="faint small">${list.length} เรื่อง</span></div>
      ${list.map(a => `<button class="pop-item" data-act="go" data-v="${a.go}"><span class="chip-icon ${a.tone === 'crit' ? 'c-crit' : a.tone === 'high' || a.tone === 'med' ? 'c-warm' : a.tone === 'info' ? '' : 'soft'}">${icon(a.icon)}</span>${a.text}<b>${a.count}</b></button>`).join('') || `<div class="pop-empty muted small">${icon('party-popper')}ยังไม่มีเรื่องที่ต้องจัดการ</div>`}</div>`;
    $('#bell').setAttribute('aria-expanded', 'true');
    refreshIcons();
  }
  addEventListener('resize', closePop);
  // one dialog at a time, at body level for the same reason as the popover
  const Modal = (() => {
    let submit = null;
    const layer = () => $('#modal-layer');
    function open({ title, sub = '', body, ok = 'บันทึก', okCls = 'btn-primary', extra = '', onSubmit }) {
      submit = onSubmit;
      layer().innerHTML = `<div class="modal-scrim" data-act="modal-close"></div><form class="modal" id="modal-form" novalidate role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><div style="min-width:0"><h2 class="card-title" id="modal-title">${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div><button type="button" class="icon-btn icon-btn-sm" data-act="modal-close" aria-label="ปิด">${icon('x')}</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${extra}<span class="tb-spacer"></span><button type="button" class="btn" data-act="modal-close">ยกเลิก</button><button type="submit" class="btn ${okCls}">${ok}</button></div></form>`;
      document.body.classList.add('modal-open');
      refreshIcons();
      const f = $('#modal-form');
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = $('button[type="submit"]', f);
        if (btn.disabled) return;
        $$('.field', f).forEach(x => x.classList.remove('has-error'));
        btn.disabled = true;
        let bad;
        try { bad = await submit(Object.fromEntries(new FormData(f)), f); } catch { return; } finally { btn.disabled = false; }
        if (bad) { const el = $(`[data-field="${bad}"]`, f); el?.classList.add('has-error'); $('input, select, textarea', el)?.focus(); return; }
        close(true);
      });
      f.addEventListener('input', e => e.target.closest('.field')?.classList.remove('has-error'));
      setTimeout(() => $('input:not([type="hidden"]):not([type="radio"]), select, textarea', f)?.focus({ preventScroll: true }), 40);
    }
    function close(saved) {
      layer().innerHTML = '';
      document.body.classList.remove('modal-open');
      submit = null;
      if (saved || stale) { stale = false; render(true); }
    }
    return { open, close, isOpen: () => !!layer().innerHTML };
  })();
  const confirmBox = (title, text, ok, run) => Modal.open({ title, body: `<p class="confirm-text">${text}</p>`, ok, okCls: 'btn-danger', onSubmit: async () => { await run(); } });
  const delBtn = (col, id, what) => `<button type="button" class="btn btn-ghost danger-text" data-act="rec-del" data-v="${col}|${id}" data-what="${esc(what)}">${icon('trash-2')}ลบ</button>`;
  const needCustomer = () => { if (R.customers.length) return false; toast('เพิ่มลูกค้าก่อน แล้วค่อยกลับมาทำรายการนี้', 'info'); location.hash = 'customers'; return true; };
  const addMonths = (iso, n) => { const d = new Date(parseDay(iso)); d.setMonth(d.getMonth() + n); return isoDay(d); };
  const allSites = () => [...new Set(R.customers.flatMap(c => c.sites || []))];

  // ---------- record dialogs ----------
  function custModal(c) {
    const e = c || {};
    Modal.open({
      title: c ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า', sub: c ? esc(c.name) : 'ช่องที่มี * จำเป็นต้องกรอก',
      body: `<div class="fgrid">${mfield('name', 'ชื่อลูกค้า / บริษัท', mi('name', e.name), { req: true, full: true, err: 'กรอกชื่อลูกค้า' })}
        ${mfield('kind', 'ประเภทลูกค้า', msel('kind', CUST_KINDS.map(k => [k, k]), e.kind || CUST_KINDS[0]))}${mfield('contact', 'ผู้ติดต่อ', mi('contact', e.contact, 'placeholder="เช่น คุณสมชาย · ฝ่ายไอที"'))}
        ${mfield('phone', 'เบอร์โทร', mi('phone', e.phone, 'inputmode="tel" placeholder="0xx-xxx-xxxx"'))}${mfield('email', 'อีเมล', mi('email', e.email, 'type="email"'))}
        ${mfield('addr', 'ที่อยู่', mt('addr', e.addr, 2), { full: true })}
        ${mfield('sites', 'สาขา / สถานที่ติดตั้ง', mt('sites', (e.sites || []).join('\n'), 3), { full: true, hint: 'บรรทัดละ 1 แห่ง เช่น สำนักงานใหญ่, คลังสินค้า' })}
        ${mfield('note', 'หมายเหตุ', mi('note', e.note), { full: true })}</div>`,
      extra: c ? delBtn('customers', c.id, c.name) : '',
      onSubmit: async d => {
        if (!d.name.trim()) return 'name';
        const rec = { ...e, id: e.id || uid('c'), name: d.name.trim(), kind: d.kind, contact: d.contact.trim(), phone: d.phone.trim(), email: d.email.trim(), addr: d.addr.trim(), sites: d.sites.split('\n').map(s => s.trim()).filter(Boolean), note: d.note.trim(), createdAt: e.createdAt || now() };
        await Store.put('customers', rec);
        toast(c ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มลูกค้า ${rec.name} แล้ว`);
      }
    });
  }
  function assetModal(a, preset) {
    if (!a && needCustomer()) return;
    const e = a || { type: preset || 'cctv', status: 'online', cust: R.customers[0]?.id };
    const prefix = { cctv: 'CAM', net: 'NET', ac: 'AC', pc: 'PC', access: 'ACS', other: 'EQ' }[e.type] || 'EQ';
    const code = e.code || `${prefix}-${pad(R.assets.filter(x => x.code.startsWith(prefix + '-')).length + 1)}`;
    Modal.open({
      title: a ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์', sub: a ? esc(a.code) : 'อุปกรณ์ประเภท กล้องวงจรปิด จะขึ้นในหน้า กล้อง CCTV ด้วย',
      body: `<div class="fgrid">${mfield('code', 'รหัสทรัพย์สิน', mi('code', code), { req: true, err: 'กรอกรหัสที่ไม่ซ้ำ', hint: 'ใช้พิมพ์บนสติกเกอร์ QR' })}${mfield('type', 'ประเภท', msel('type', typeOpts(), e.type))}
        ${mfield('name', 'ชื่อ / รุ่น', mi('name', e.name, 'placeholder="เช่น กล้อง IP 5MP · Dahua"'), { req: true, full: true, err: 'กรอกชื่ออุปกรณ์' })}
        ${mfield('cust', 'ลูกค้า', msel('cust', custOpts(), e.cust), { req: true })}${mfield('site', 'สถานที่ติดตั้ง', mi('site', e.site, 'list="m-sites" placeholder="เช่น ลานจอดรถ"') + siteList('m-sites', { sites: allSites() }))}
        ${mfield('serial', 'S/N', mi('serial', e.serial))}${mfield('warranty', 'ประกันถึง', mi('warranty', e.warranty, 'type="date"'))}
        ${mfield('status', 'สถานะ', msel('status', Object.entries(ASSET_ST).map(([k, v]) => [k, v[0]]), e.status))}${mfield('note', 'หมายเหตุ', mi('note', e.note, 'placeholder="เช่น ช่อง 9–14 ไม่มีสัญญาณ"'))}</div>`,
      extra: a ? delBtn('assets', a.id, a.code) : '',
      onSubmit: async d => {
        if (!d.code.trim() || R.assets.some(x => x.code.toLowerCase() === d.code.trim().toLowerCase() && x.id !== e.id)) return 'code';
        if (!d.name.trim()) return 'name';
        if (!d.cust) return 'cust';
        await Store.put('assets', { ...e, id: e.id || uid('a'), code: d.code.trim(), type: d.type, name: d.name.trim(), cust: d.cust, site: d.site.trim(), serial: d.serial.trim(), warranty: d.warranty, status: d.status, note: d.note.trim(), createdAt: e.createdAt || now() });
        toast(a ? 'บันทึกการแก้ไขแล้ว' : `เพิ่ม ${d.code.trim()} แล้ว`);
      }
    });
  }
  function moveModal() {
    Modal.open({
      title: 'บันทึกการยืม / โอน / ย้าย',
      body: `<div class="fgrid">${mfield('kind', 'ประเภท', msel('kind', [['ยืม', 'ยืม (ต้องคืน)'], ['โอน', 'โอนให้ลูกค้า'], ['ย้าย', 'ย้ายระหว่างสถานที่']], 'ยืม'))}${mfield('tech', 'ผู้รับผิดชอบ', msel('tech', techOpts('ไม่ระบุ'), R.techs[0]?.id))}
        ${mfield('item', 'อุปกรณ์', mi('item', '', 'placeholder="เช่น กล้อง PTZ สำรอง"'), { req: true, full: true, err: 'กรอกชื่ออุปกรณ์' })}
        ${mfield('from', 'จาก', mi('from', 'คลังกลาง นาเกลือ'))}${mfield('to', 'ไปที่', mi('to', '', 'list="m-to"') + `<datalist id="m-to">${R.customers.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>`, { req: true, err: 'กรอกปลายทาง' })}
        ${mfield('date', 'วันที่', mi('date', isoDay(), 'type="date"'))}${mfield('due', 'กำหนดคืน (ถ้ายืม)', mi('due', '', 'type="date"'))}</div>`,
      onSubmit: async d => {
        if (!d.item.trim()) return 'item';
        if (!d.to.trim()) return 'to';
        const no = nextNo('TR', R.moves.map(m => ({ id: m.no })));
        await Store.put('moves', { id: uid('m'), no, kind: d.kind, item: d.item.trim(), from: d.from.trim(), to: d.to.trim(), tech: d.tech, date: d.date, due: d.kind === 'ยืม' ? d.due : '', status: d.kind === 'ยืม' ? 'กำลังยืม' : d.kind === 'ย้าย' ? 'เสร็จสิ้น' : 'ระหว่างทาง', createdAt: now() });
        S.assetTab = 'moves';
        toast(`บันทึก ${no} แล้ว`);
      }
    });
  }
  function partModal(p) {
    const e = p || { type: 'cctv', qty: 0, min: 1, unit: 'ชิ้น', price: 0 };
    Modal.open({
      title: p ? 'แก้ไขอะไหล่' : 'เพิ่มอะไหล่', sub: 'ตั้งจำนวนขั้นต่ำ ระบบจะเตือนเมื่อของเหลือน้อยกว่านี้',
      body: `<div class="fgrid">${mfield('name', 'ชื่ออะไหล่', mi('name', e.name, 'placeholder="เช่น HDD 4TB WD Purple"'), { req: true, full: true, err: 'กรอกชื่ออะไหล่' })}
        ${mfield('sku', 'SKU / รหัส', mi('sku', e.sku))}${mfield('type', 'ใช้กับงาน', msel('type', typeOpts(), e.type))}
        ${mfield('qty', 'คงเหลือ', mi('qty', e.qty, 'type="number" min="0"'))}${mfield('min', 'ขั้นต่ำ', mi('min', e.min, 'type="number" min="0"'))}
        ${mfield('unit', 'หน่วย', mi('unit', e.unit))}${mfield('price', 'ราคาทุน / หน่วย (บาท)', mi('price', e.price, 'type="number" min="0"'))}
        ${mfield('bin', 'ที่เก็บ', mi('bin', e.bin, 'placeholder="เช่น A-01"'))}</div>`,
      extra: p ? delBtn('parts', p.id, p.name) : '',
      onSubmit: async d => {
        if (!d.name.trim()) return 'name';
        await Store.put('parts', { ...e, id: e.id || uid('p'), name: d.name.trim(), sku: d.sku.trim(), type: d.type, qty: Math.max(0, +d.qty || 0), min: Math.max(0, +d.min || 0), unit: d.unit.trim() || 'ชิ้น', price: Math.max(0, +d.price || 0), bin: d.bin.trim(), createdAt: e.createdAt || now() });
        toast(p ? 'บันทึกการแก้ไขแล้ว' : `เพิ่ม ${d.name.trim()} แล้ว`);
      }
    });
  }
  function orderModal() {
    Modal.open({
      title: 'สร้างใบขอซื้อ (PR)',
      body: `<div class="fgrid">${mfield('part', 'อะไหล่ในคลัง (ถ้ามี)', msel('part', [['', 'ไม่ผูกกับคลัง'], ...R.parts.map(p => [p.id, p.name])], ''), { full: true, hint: 'ถ้าเลือก เมื่อรับของจำนวนในคลังจะเพิ่มให้เอง' })}
        ${mfield('item', 'รายการ', mi('item', '', 'placeholder="เช่น HDD 8TB × 4"'), { full: true, hint: 'เว้นว่างได้ถ้าเลือกอะไหล่ด้านบน', err: 'กรอกรายการ' })}
        ${mfield('qty', 'จำนวน', mi('qty', 1, 'type="number" min="1"'))}${mfield('amount', 'มูลค่ารวม (บาท)', mi('amount', '', 'type="number" min="0"'))}
        ${mfield('vendor', 'ผู้ขาย', mi('vendor'))}${mfield('ref', 'อ้างอิง', mi('ref', '', 'placeholder="เช่น WO-6911-0001 หรือ เติมสต็อก"'))}</div>`,
      onSubmit: async d => {
        const p = R.parts.find(x => x.id === d.part), q = Math.max(1, +d.qty || 1);
        const item = d.item.trim() || (p ? `${p.name} × ${q}` : '');
        if (!item) return 'item';
        const id = nextNo('PR', R.orders);
        await Store.put('orders', { id, item, part: p ? p.id : '', qty: q, vendor: d.vendor.trim(), amount: +d.amount || (p ? p.price * q : 0), stage: 0, ref: d.ref.trim(), createdAt: now() });
        toast(`สร้างใบขอซื้อ ${id} แล้ว`, 'shopping-cart');
      }
    });
  }
  const PLANS = ['CCTV รายปี', 'Security รายปี', 'แอร์รายปี (ล้าง 3 ครั้ง)', 'IT & Network รายปี', 'ครบวงจร IT + CCTV + แอร์'];
  function maModal(m) {
    if (!m && needCustomer()) return;
    const start = m?.start || isoDay(), e = m || { cust: R.customers[0]?.id, plan: PLANS[0], value: '', start, end: addDays(addYears(start, 1), -1), visits: 4, sla: 4 };
    Modal.open({
      title: m ? 'แก้ไขสัญญา MA' : 'สร้างสัญญาบริการรายปี', sub: 'รอบ PM จะนับจากงาน PM ของลูกค้ารายนี้ที่ติ๊กว่าเสร็จ',
      body: `<div class="fgrid">${mfield('cust', 'ลูกค้า', msel('cust', custOpts(), e.cust), { req: true, full: true })}
        ${mfield('plan', 'แผนบริการ', mi('plan', e.plan, 'list="m-plans"') + `<datalist id="m-plans">${PLANS.map(p => `<option value="${p}">`).join('')}</datalist>`, { req: true, err: 'กรอกชื่อแผน' })}${mfield('value', 'มูลค่าต่อปี (บาท)', mi('value', e.value, 'type="number" min="0"'))}
        ${mfield('start', 'เริ่มสัญญา', mi('start', e.start, 'type="date"'), { req: true })}${mfield('end', 'สิ้นสุดสัญญา', mi('end', e.end, 'type="date"'), { req: true, err: 'ต้องหลังวันเริ่ม' })}
        ${mfield('visits', 'รอบ PM ต่อปี', mi('visits', e.visits, 'type="number" min="0"'))}${mfield('sla', 'SLA เข้าหน้างาน (ชม.)', mi('sla', e.sla, 'type="number" min="1"'))}
        ${mfield('note', 'หมายเหตุ', mi('note', e.note), { full: true })}</div>`,
      extra: m ? delBtn('contracts', m.id, `สัญญา ${cust(m.cust).name}`) : '',
      onSubmit: async d => {
        if (!d.cust) return 'cust';
        if (!d.plan.trim()) return 'plan';
        if (!d.start) return 'start';
        if (!d.end || d.end <= d.start) return 'end';
        await Store.put('contracts', { ...e, id: e.id || uid('ma'), cust: d.cust, plan: d.plan.trim(), value: +d.value || 0, start: d.start, end: d.end, visits: +d.visits || 0, sla: +d.sla || 4, note: d.note.trim(), createdAt: e.createdAt || now() });
        toast(m ? 'บันทึกการแก้ไขแล้ว' : 'สร้างสัญญาแล้ว', 'file-check');
      }
    });
  }
  function pmModal(p) {
    const e = p || { date: S.pmDay || isoDay(), cust: R.customers[0]?.id || '', type: 'cctv', tech: R.techs[0]?.id || '', done: false };
    Modal.open({
      title: p ? 'งาน PM' : 'เพิ่มงาน PM', sub: p ? esc(p.title) : 'ตั้งทำซ้ำได้ เช่น ทุก 3 เดือนตามสัญญา MA',
      body: `<div class="fgrid">${mfield('title', 'งานที่ต้องทำ', mi('title', e.title, 'placeholder="เช่น ล้างแอร์ประจำไตรมาส 6 เครื่อง"'), { req: true, full: true, err: 'กรอกชื่องาน' })}
        ${mfield('date', 'วันที่', mi('date', e.date, 'type="date"'), { req: true })}${mfield('cust', 'ลูกค้า', msel('cust', custOpts('ไม่ระบุ'), e.cust))}
        ${mfield('type', 'ประเภทงาน', msel('type', typeOpts(), e.type))}${mfield('tech', 'ช่าง', msel('tech', techOpts('ยังไม่ระบุ'), e.tech))}
        ${p ? `<label class="consent inner full"><input type="checkbox" name="done"${e.done ? ' checked' : ''}><span>ทำงานนี้เสร็จแล้ว</span></label>` : mfield('repeat', 'ทำซ้ำ', msel('repeat', [['0', 'ครั้งเดียว'], ['1', 'ทุกเดือน (12 ครั้ง)'], ['3', 'ทุก 3 เดือน (4 ครั้ง)'], ['6', 'ทุก 6 เดือน (2 ครั้ง)']], '0'), { full: true })}</div>`,
      extra: p ? delBtn('pm', p.id, p.title) : '',
      onSubmit: async d => {
        if (!d.title.trim()) return 'title';
        if (!d.date) return 'date';
        const base = { title: d.title.trim(), cust: d.cust, type: d.type, tech: d.tech };
        if (p) { await Store.put('pm', { ...e, ...base, date: d.date, done: !!d.done, doneAt: d.done ? (e.doneAt || now()) : null }); toast(d.done ? 'ติ๊กว่าเสร็จแล้ว' : 'บันทึกแล้ว'); return; }
        const step = +d.repeat, times = step ? 12 / step : 1;
        for (let i = 0; i < times; i++) await Store.put('pm', { id: uid('pm'), ...base, date: addMonths(d.date, i * step), done: false, createdAt: now() });
        toast(times > 1 ? `เพิ่มงาน PM ${times} ครั้งแล้ว` : 'เพิ่มงาน PM แล้ว', 'calendar-check');
      }
    });
  }
  const QT_STATUSES = Object.keys(QT_TONE);
  function quoteModal(pre = {}) {
    if (needCustomer()) return;
    Modal.open({
      title: 'สร้างใบเสนอราคา', sub: 'เลือกแพ็กเกจจากแท็บ แพ็กเกจ & ราคา เพื่อกรอกชื่อและราคาให้อัตโนมัติ',
      body: `<div class="fgrid">${mfield('cust', 'ลูกค้า', msel('cust', custOpts(), R.customers[0]?.id), { req: true, full: true })}
        ${mfield('title', 'รายการ', mi('title', pre.title || ''), { req: true, full: true, err: 'กรอกรายการ' })}
        ${mfield('amount', 'มูลค่า (บาท)', mi('amount', pre.amount || '', 'type="number" min="0"'))}${mfield('status', 'สถานะ', msel('status', QT_STATUSES.map(s => [s, s]), 'ร่าง'))}
        ${mfield('note', 'หมายเหตุ', mi('note'), { full: true })}</div>`,
      onSubmit: async d => {
        if (!d.cust) return 'cust';
        if (!d.title.trim()) return 'title';
        const id = nextNo('QT', R.quotes);
        await Store.put('quotes', { id, cust: d.cust, title: d.title.trim(), amount: +d.amount || 0, status: d.status, note: d.note.trim(), createdAt: now() });
        S.custTab = 'quotes';
        toast(`สร้าง ${id} แล้ว`, 'receipt');
      }
    });
  }
  function techModal(k) {
    const e = k || { team: 'ทุกทีม', leave: false };
    Modal.open({
      title: k ? 'แก้ไขข้อมูลช่าง' : 'เพิ่มช่าง',
      body: `<div class="fgrid">${mfield('name', 'ชื่อ-นามสกุล', mi('name', e.name), { req: true, full: true, err: 'กรอกชื่อช่าง' })}
        ${mfield('team', 'ทีม', msel('team', TEAMS.map(t => [t, t]), e.team))}${mfield('phone', 'เบอร์โทร', mi('phone', e.phone, 'inputmode="tel"'))}
        <label class="consent inner full"><input type="checkbox" name="leave"${e.leave ? ' checked' : ''}><span>ลางานอยู่ (จะไม่ถูกแนะนำให้รับงาน)</span></label></div>`,
      extra: k ? delBtn('techs', k.id, k.name) : '',
      onSubmit: async d => {
        const name = d.name.trim();
        if (!name) return 'name';
        const [fn, ln] = name.split(/\s+/);
        await Store.put('techs', { ...e, id: e.id || uid('k'), name, short: ln ? `${fn} ${ln.slice(0, 1)}.` : fn, initial: name.slice(0, 1), hue: e.hue || HUES[R.techs.length % HUES.length], team: d.team, phone: d.phone.trim(), leave: !!d.leave });
        toast(k ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มช่าง ${name} แล้ว`, 'user-plus');
      }
    });
  }
  // closing a job: what was fixed, parts used (taken out of stock), customer rating
  function closeModal(t) {
    const a = asset(t.asset);
    Modal.open({
      title: `ปิดงาน ${t.id}`, sub: esc(t.title), ok: 'ปิดงาน',
      body: `<div class="fgrid">${mfield('resolution', 'สรุปการแก้ไข', mt('resolution', t.resolution || '', 3), { req: true, full: true, err: 'เขียนสั้น ๆ ว่าแก้อะไรไป' })}
        ${mfield('part', 'อะไหล่ที่ใช้ (ตัดออกจากคลัง)', msel('part', [['', 'ไม่ได้ใช้อะไหล่'], ...R.parts.map(p => [p.id, `${p.name} · เหลือ ${p.qty}`])], ''))}${mfield('pqty', 'จำนวน', mi('pqty', 1, 'type="number" min="1"'))}
        <div class="field full"><span class="flabel">คะแนนจากลูกค้า (ไม่บังคับ)</span><div class="stars">${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="star-${n}" value="${n}"><label for="star-${n}" title="${n} ดาว">${icon('star')}</label>`).join('')}</div></div>
        ${a && a.status !== 'online' ? `<label class="consent inner full"><input type="checkbox" name="fixed" checked><span>เปลี่ยนสถานะ ${esc(a.code)} เป็น ออนไลน์</span></label>` : ''}</div>`,
      onSubmit: async d => {
        if (!d.resolution.trim()) return 'resolution';
        const p = R.parts.find(x => x.id === d.part), q = Math.max(1, +d.pqty || 1);
        if (p) await Store.put('parts', { ...p, qty: Math.max(0, +p.qty - q) });
        if (a && d.fixed) await Store.put('assets', { ...a, status: 'online', note: `ซ่อมแล้ว ${shortDay(now())}` });
        Object.assign(t, { status: 'เสร็จสิ้น', stage: 4, closedAt: now(), resolution: d.resolution.trim(), rating: d.rating ? +d.rating : null, partUsed: p ? `${p.name} × ${q}` : '' });
        t.log.push(logLine('ok', 'ปิดงาน', d.resolution.trim() + (d.rating ? ` · ลูกค้าให้ ${d.rating} ดาว` : '')));
        await Store.put('tickets', t);
        toast(`ปิดงาน ${t.id} แล้ว`, 'check-check');
      }
    });
  }
  async function updTicket(t, changes, line) {
    Object.assign(t, changes);
    if (line) (t.log = t.log || []).push(line);
    await Store.put('tickets', t);
    render(true);
  }
  async function stageNext(t) {
    if (!t.tech) { toast('มอบหมายช่างก่อน', 'user-plus'); return; }
    const st = t.stage || 0, k = tech(t.tech);
    if (st >= 3) { closeModal(t); return; }
    const text = ['ช่างออกเดินทาง', 'ช่างถึงหน้างาน', 'เริ่มซ่อม'][st];
    await updTicket(t, { stage: st + 1, status: 'กำลังดำเนินการ' }, logLine(st === 0 ? '' : st === 1 ? 'ok' : '', text, `${k ? k.name : ''} · ${t.site}`));
    toast(`${t.id} · ${text}`, 'route');
  }

  // ---------- actions ----------
  const ON_SEG = {
    period() {
      const [label, from] = PERIODS[S.period], s = stats(from());
      if ($('#kpis')) { $('#kpis').innerHTML = kpis(); $('#gauge').innerHTML = gauge(s.sat, s.reviews); $('#gauge-sub').textContent = `${label} · ให้คะแนนตอนปิดงาน`; }
      if ($('#cc-kpis')) $('#cc-kpis').innerHTML = ccKpis();
      refreshIcons();
    },
    homeTab() { $('#home-rows').innerHTML = homeRows(); refreshIcons(); },
    listTab() { S.listPage = 1; updateList(true); },
    listMode() { store.set('listMode', S.listMode); updateList(true); },
    tone() { $('#msg').textContent = message(ticket(parse().id)); },
    assetTab() { $('#asset-body').innerHTML = assetBody(); refreshIcons(); Seg.all($('#asset-body')); },
    assetFilter() { $('#asset-rows').innerHTML = assetRows(); refreshIcons(); },
    maFilter() { $('#ma-rows').innerHTML = maRows(); refreshIcons(); },
    camSite() { $('#wall').innerHTML = wall(); refreshIcons(); },
    custTab() { $('#cust-body').innerHTML = custBody(); refreshIcons(); Seg.all($('#cust-body')); },
    priceTab() { $('#cust-body').innerHTML = custBody(); refreshIcons(); Seg.all($('#cust-body')); },
    'form.channel'() { renderSummary(); }
  };
  let spyLock = 0;
  const pair = v => String(v).split('|');
  const ACT = {
    seg(b) {
      const segEl = b.closest('.seg'), key = segEl.dataset.key, v = b.dataset.v;
      const inForm = key.startsWith('form.'), cur = inForm ? S.form[key.slice(5)] : S[key];
      if (cur === v) return;
      if (inForm) S.form[key.slice(5)] = v; else S[key] = v;
      $$('.seg-btn', segEl).forEach(x => x.setAttribute('aria-pressed', x === b));
      Seg.place(segEl, true);
      ON_SEG[key]?.(v);
    },
    skin(b) { S.skin = b.dataset.v; store.set('skin', S.skin); applySkin(); },
    open(el) { location.hash = el.dataset.v.toLowerCase(); },
    go(el) { closePop(); location.hash = el.dataset.v; },
    bell() { $('#pop-layer').innerHTML ? closePop() : openPop(); },
    menu() { Rail.drawer(!Rail.isDrawer()); },
    'menu-close'() { Rail.drawer(false); },
    'modal-close'() { Modal.close(); },
    demo(el) { toast(`"${el.dataset.v}" ยังไม่ได้เชื่อมระบบจริง`, 'info'); },
    'hide-setup'() { S.hideSetup = true; store.set('hideSetup', true); render(true); },
    'clear-filters'() { S.listQuery = ''; S.listTab = 'all'; S.listType = S.listSev = S.listTech = 'all'; S.listPage = 1; $('#tb-q').value = ''; render(); },
    sort() { S.listSort = S.listSort === 'asc' ? 'desc' : 'asc'; updateList(true); },
    page(b) { S.listPage = +b.dataset.v; updateList(true); $('.list-card').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' }); },
    sel(el, e) {
      e.stopPropagation();
      if (el.checked) S.selected.add(el.dataset.v); else S.selected.delete(el.dataset.v);
      el.closest('tr').classList.toggle('is-sel', el.checked);
      $('#bulk').innerHTML = bulkBar(); refreshIcons();
    },
    selall(el) {
      const from = (S.listPage - 1) * S.listPer;
      listRows().slice(from, from + S.listPer).forEach(t => el.checked ? S.selected.add(t.id) : S.selected.delete(t.id));
      updateList(true);
    },
    'sel-clear'() { S.selected.clear(); updateList(true); },
    'bulk-tech'() {
      Modal.open({ title: `มอบหมายช่าง ${S.selected.size} ใบงาน`, body: mfield('tech', 'ช่าง', msel('tech', techOpts(), R.techs[0]?.id)), ok: 'มอบหมาย', onSubmit: async d => {
        const k = tech(d.tech);
        for (const id of S.selected) { const t = ticket(id); if (!t || isDone(t)) continue; t.tech = d.tech; if (t.status === 'รอมอบหมาย') t.status = 'รอนัดหมาย'; t.log.push(logLine('', `มอบหมายช่าง${k.name}`, 'มอบหมายพร้อมกันหลายใบ')); await Store.put('tickets', t); }
        S.selected.clear(); toast('มอบหมายแล้ว', 'user-plus');
      } });
    },
    'bulk-status'() {
      Modal.open({ title: `เปลี่ยนสถานะ ${S.selected.size} ใบงาน`, body: mfield('status', 'สถานะใหม่', msel('status', Object.keys(D.statuses).filter(s => s !== 'เสร็จสิ้น').map(s => [s, s]), 'กำลังดำเนินการ'), { hint: 'ปิดงานทีละใบในหน้าใบงาน เพื่อใส่สรุปการแก้ไข' }), ok: 'เปลี่ยน', onSubmit: async d => {
        for (const id of S.selected) { const t = ticket(id); if (!t || isDone(t)) continue; t.status = d.status; t.log.push(logLine('', `เปลี่ยนสถานะเป็น ${d.status}`)); await Store.put('tickets', t); }
        S.selected.clear(); toast('เปลี่ยนสถานะแล้ว', 'refresh-cw');
      } });
    },
    'bulk-delete'() { const ids = [...S.selected]; confirmBox(`ลบ ${ids.length} ใบงาน`, 'ใบงานที่ลบแล้วจะกู้คืนไม่ได้', 'ลบใบงาน', async () => { for (const id of ids) await Store.del('tickets', id); S.selected.clear(); toast(`ลบ ${ids.length} ใบงานแล้ว`, 'trash-2'); }); },
    'rec-del'(b) {
      const [col, id] = pair(b.dataset.v), what = b.dataset.what;
      const linked = col === 'customers' ? R.tickets.filter(t => t.cust === id).length : col === 'techs' ? R.tickets.filter(t => t.tech === id && !isDone(t)).length : 0;
      confirmBox(`ลบ ${esc(what)}`, linked ? `มีใบงานที่เกี่ยวข้อง ${linked} ใบ ใบงานจะยังอยู่แต่จะไม่มีชื่อ${col === 'techs' ? 'ช่าง' : 'ลูกค้า'}แสดง` : 'ลบแล้วจะกู้คืนไม่ได้', 'ลบ', async () => { await Store.del(col, id); toast(`ลบ ${what} แล้ว`, 'trash-2'); });
    },
    // tickets
    submit() { submitForm(); },
    'form-reset'() { S.form = blankForm(); S.files = []; S.formSec = 0; render(true); },
    'rm-file'(b, e) { e.stopPropagation(); S.files.splice(+b.dataset.v, 1); $('#thumbs').innerHTML = thumbs(); refreshIcons(); },
    step(b) {
      const i = +b.dataset.v;
      setStep(i, true);
      spyLock = performance.now() + 900;
      $('#sec-' + i).scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
    },
    async assign(b) { const [id, kid] = pair(b.dataset.v), t = ticket(id), k = tech(kid); await updTicket(t, { tech: kid, status: t.status === 'รอมอบหมาย' ? 'รอนัดหมาย' : t.status }, logLine('', `มอบหมายช่าง${k.name}`, k.phone || '')); toast(`มอบหมาย${k.name}แล้ว`, 'user-plus'); },
    'set-status'(b) { const [id, st] = pair(b.dataset.v), t = ticket(id); return updTicket(t, { status: st }, logLine('', `เปลี่ยนสถานะเป็น ${st}`)); },
    'stage-next'(b, e) { e.stopPropagation(); return stageNext(ticket(b.dataset.v)); },
    'close-job'(b) { closeModal(ticket(b.dataset.v)); },
    reopen(b) { const t = ticket(b.dataset.v); return updTicket(t, { status: 'กำลังดำเนินการ', stage: 3, closedAt: null }, logLine('crit', 'เปิดงานอีกครั้ง')); },
    'del-ticket'(b) { const id = b.dataset.v; confirmBox(`ลบใบงาน ${id}`, 'ใบงานที่ลบแล้วจะกู้คืนไม่ได้', 'ลบใบงาน', async () => { location.hash = 'tickets'; await Store.del('tickets', id); toast(`ลบ ${id} แล้ว`, 'trash-2'); }); },
    'add-note'(b) {
      const box = $('#note-in'), text = box.value.trim();
      if (!text) { box.focus(); return; }
      box.value = ''; box.blur();
      return updTicket(ticket(b.dataset.v), {}, logLine('', 'บันทึกเพิ่มเติม', text));
    },
    'copy-msg'() {
      const text = $('#msg').textContent;
      const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#msg')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('เลือกข้อความให้แล้ว กด Ctrl+C เพื่อคัดลอก', 'copy'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('คัดลอกข้อความแล้ว', 'copy'), fallback); else fallback();
    },
    // PM
    'pm-add'() { pmModal(); },
    'pm-edit'(b) { pmModal(R.pm.find(p => p.id === b.dataset.v)); },
    'pm-month'(b) { const v = +b.dataset.v, d = new Date(S.pmMonth); S.pmMonth = v ? new Date(d.getFullYear(), d.getMonth() + v, 1).getTime() : firstOfMonth(); S.pmDay = null; render(true); },
    pmday(el) {
      const d = el.dataset.v;
      S.pmDay = d && S.pmDay !== d ? d : null;
      $$('.cal-day[data-v]').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === S.pmDay));
      $('#pm-list').innerHTML = pmItems();
      $('#pm-title').textContent = S.pmDay ? `งาน PM วันที่ ${dateTH(parseDay(S.pmDay), { day: 'numeric', month: 'short' })}` : 'งาน PM ที่ถึงกำหนด (7 วัน)';
      $('#pm-all').hidden = !S.pmDay;
      refreshIcons();
    },
    'track-sel'(b) { S.trackSel = b.dataset.v; $('#map').innerHTML = trackMap(); $('#trk-list').innerHTML = trackList(); refreshIcons(); },
    // contracts
    'ma-add'() { maModal(); },
    'ma-edit'(b) { maModal(R.contracts.find(m => m.id === b.dataset.v)); },
    async renew(b) {
      const m = R.contracts.find(x => x.id === b.dataset.v), start = addDays(m.end, 1);
      await Store.put('contracts', { ...m, start, end: addDays(addYears(start, 1), -1) });
      render(true);
      toast(`ต่ออายุสัญญา ${cust(m.cust).name} ถึง ${dateTH(parseDay(addDays(addYears(start, 1), -1)))} แล้ว`, 'file-check');
    },
    // assets
    'asset-add'(b) { assetModal(null, b.dataset.v); },
    'asset-edit'(b) { assetModal(asset(b.dataset.v)); },
    report(el, e) {
      e.stopPropagation();
      const a = asset(el.dataset.v);
      if (!a) return;
      S.form = { ...blankForm(), cust: a.cust, site: a.site || cust(a.cust).sites?.[0] || '', asset: a.id, type: a.type, subject: `${a.name}${a.note ? ' · ' + a.note : ''}`, sev: a.status === 'offline' ? 'high' : 'med' };
      S.formSec = 0; S.files = [];
      location.hash = 'new';
    },
    'move-add'() { moveModal(); },
    async 'move-done'(b) { const m = R.moves.find(x => x.id === b.dataset.v); await Store.put('moves', { ...m, status: 'เสร็จสิ้น', doneAt: now() }); render(true); toast(`${m.no} เสร็จแล้ว`); },
    // stock
    'part-add'() { partModal(); },
    'part-edit'(b) { partModal(R.parts.find(p => p.id === b.dataset.v)); },
    async qty(b) { const [id, d] = pair(b.dataset.v), p = R.parts.find(x => x.id === id); await Store.put('parts', { ...p, qty: Math.max(0, +p.qty + +d) }); render(true); },
    async reorder(b) {
      const p = R.parts.find(x => x.id === b.dataset.v), q = Math.max(1, p.min * 2 - p.qty), id = nextNo('PR', R.orders);
      await Store.put('orders', { id, item: `${p.name} × ${q}`, part: p.id, qty: q, vendor: '', amount: q * p.price, stage: 0, ref: 'เติมสต็อก', createdAt: now() });
      render(true);
      toast(`สร้างใบขอซื้อ ${id} · ${p.name} ${q} ${p.unit}`, 'shopping-cart');
    },
    'po-add'() { orderModal(); },
    async 'po-next'(b) {
      const o = R.orders.find(x => x.id === b.dataset.v), stage = Math.min(4, o.stage + 1);
      await Store.put('orders', { ...o, stage, doneAt: stage === 4 ? now() : null });
      const p = stage === 4 && R.parts.find(x => x.id === o.part);
      if (p) await Store.put('parts', { ...p, qty: +p.qty + (+o.qty || 0) });
      render(true);
      toast(stage === 4 ? (p ? `รับของแล้ว · ${p.name} เพิ่มเป็น ${+p.qty + (+o.qty || 0)} ${p.unit}` : 'รับของแล้ว') : `${o.id} · ${PO_STAGES[stage]}`, stage === 4 ? 'package-check' : 'truck');
    },
    'po-del'(b) { const id = b.dataset.v; confirmBox(`ลบใบขอซื้อ ${id}`, 'ลบแล้วจะกู้คืนไม่ได้', 'ลบ', async () => { await Store.del('orders', id); }); },
    // customers and quotes
    'cust-add'() { custModal(); },
    'cust-edit'(b) { custModal(R.customers.find(c => c.id === b.dataset.v)); },
    async 'import-portal'() {
      const names = portalLeft();
      for (const name of names) await Store.put('customers', { id: uid('c'), name, kind: 'บริษัท / โรงงาน', portal: true, contact: '', phone: '', email: '', addr: '', sites: [], note: 'จากระบบแจ้งซ่อมเดิม', createdAt: now() });
      S.custTab = 'list';
      render(true);
      toast(`เพิ่ม ${names.length} บริษัทแล้ว · ใส่ที่อยู่และผู้ติดต่อได้ที่ปุ่มแก้ไข`, 'building-2');
    },
    'cust-tickets'(b) {
      const c = cust(b.dataset.v);
      S.listQuery = c.name; S.listTab = 'all'; S.listType = S.listSev = S.listTech = 'all'; S.listPage = 1;
      location.hash = 'tickets';
    },
    'cust-new'(b) {
      const id = b.dataset.v, c = cust(id);
      S.form = { ...blankForm(), cust: id, site: (c.sites || [])[0] || '', reporter: c.contact || '', phone: c.phone || '' };
      S.formSec = 0; S.files = [];
      location.hash = 'new';
    },
    'quote-add'() { quoteModal(); },
    'quote-from'(b) { quoteModal({ title: b.dataset.v, amount: +b.dataset.amt || '' }); },
    'quote-del'(b) { const id = b.dataset.v; confirmBox(`ลบ ${id}`, 'ลบแล้วจะกู้คืนไม่ได้', 'ลบ', async () => { await Store.del('quotes', id); }); },
    // settings
    'tech-add'() { techModal(); },
    'tech-edit'(b) { techModal(tech(b.dataset.v)); },
    wipe() {
      confirmBox('ล้างข้อมูลทดสอบทั้งหมด', `จะลบใบงาน ลูกค้า อุปกรณ์ อะไหล่ ใบขอซื้อ ใบเสนอราคา สัญญา และงาน PM ทั้งหมด${Store.mode === 'db' ? ' ของทุกคนที่ใช้ลิงก์นี้' : ''} · ทีมช่างและเวลา SLA ยังอยู่`, 'ล้างข้อมูล', async () => {
        for (const c of COLS.filter(x => x !== 'techs' && x !== 'config')) for (const r of R[c].slice()) await Store.del(c, r.id);
        S.form = null; S.selected.clear(); S.hideSetup = false; store.set('hideSetup', false);
        toast('ล้างข้อมูลแล้ว เริ่มใหม่ได้เลย', 'eraser');
      });
    },
    fullscreen() {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      const fail = () => toast('เบราว์เซอร์นี้เปิดเต็มจอไม่ได้ ลองกด F11 แทน', 'info');
      const p = document.documentElement.requestFullscreen?.();
      if (p) p.catch(fail); else fail();
    },
    replay() { L.replay($('#brand-logo .logo')); },
    snap() { L.snap($('#brand-logo .logo')); S.snaps++; $('#snaps').textContent = `ถ่ายไปแล้ว ${S.snaps} ภาพ`; }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (!e.target.closest('.pop')) closePop(); return; }
    if (el.dataset.act !== 'bell' && !el.closest('.pop')) closePop();
    const run = ACT[el.dataset.act]?.(el, e);
    if (run && run.catch) run.catch(() => render(true));
  });
  // snapping any mark that allows it (brand hero, feature demo)
  view.addEventListener('click', e => {
    const m = e.target.closest('.can-snap .logo-mark');
    if (!m) return;
    L.snap(m);
    if (m.closest('#brand-logo')) { S.snaps++; $('#snaps').textContent = `ถ่ายไปแล้ว ${S.snaps} ภาพ`; }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#tb-q').focus(); }
    if (e.key === 'Escape') { if (Modal.isOpen()) { Modal.close(); return; } closePop(); if (Rail.isDrawer()) Rail.drawer(false); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.kcard, .trk')) { e.preventDefault(); ACT[e.target.dataset.act]?.(e.target, e); }
  });
  function onField(e) {
    const el = e.target, change = e.type === 'change';
    if (el.id === 'q') { S.listQuery = el.value; S.listPage = 1; updateList(); return; }
    if (el.dataset.flt) {
      if (!change) return;
      S[el.dataset.flt] = el.dataset.flt === 'listPer' ? +el.value : el.value;
      S.listPage = 1; updateList();
      return;
    }
    if (el.dataset.sla) {
      if (!change) return;
      const sla = { ...(cfg().sla || {}) }, n = clamp(Math.round(+el.value) || 1, 1, 168);
      sla[el.dataset.sla] = n; el.value = n;
      Store.put('config', { ...cfg(), id: 'settings', sla }).then(() => toast(`SLA ระดับ${D.severities[el.dataset.sla].label} = ${n} ชม. (ใช้กับใบงานใหม่)`, 'timer'), () => render(true));
      return;
    }
    if (el.dataset.notify) {
      if (!change) return;
      S.notify[el.dataset.notify] = el.checked;
      store.set('notify', S.notify);
      toast(`${el.checked ? 'เปิด' : 'ปิด'}การแจ้งเตือนแล้ว (ยังไม่ได้เชื่อมจริง)`, el.checked ? 'bell-ring' : 'bell-off');
      return;
    }
    if (el.hasAttribute('data-me')) {
      if (!change) return;
      store.set('me', el.value.trim() || 'ผู้ใช้งาน');
      chrome();
      toast('บันทึกชื่อแล้ว', 'user');
      return;
    }
    if (el.dataset.tk) {
      if (!change) return;
      const t = ticket(el.dataset.v);
      if (el.dataset.tk === 'status') {
        if (el.value === 'เสร็จสิ้น') { el.value = t.status; closeModal(t); return; }
        el.blur();
        updTicket(t, { status: el.value, ...(isDone(t) ? { closedAt: null, stage: 3 } : {}) }, logLine('', `เปลี่ยนสถานะเป็น ${el.value}`)).catch(() => render(true));
      } else {
        const k = tech(el.value);
        el.blur();
        updTicket(t, { tech: el.value || null, status: k && t.status === 'รอมอบหมาย' ? 'รอนัดหมาย' : !k && D.statuses[t.status].group === 'pending' ? 'รอมอบหมาย' : t.status }, logLine('', k ? `มอบหมายช่าง${k.name}` : 'ยกเลิกการมอบหมายช่าง')).catch(() => render(true));
      }
      return;
    }
    if (el.dataset.qt) {
      if (!change) return;
      const q = R.quotes.find(x => x.id === el.dataset.qt);
      el.blur();
      Store.put('quotes', { ...q, status: el.value }).then(() => toast(`${q.id} · ${el.value}`, 'receipt'), () => render(true));
      return;
    }
    const f = el.dataset.f;
    if (!f || !S.form) return;
    if (el.type === 'radio') { if (!el.checked) return; S.form[f] = el.value; }
    else if (el.type === 'checkbox') S.form[f] = el.checked;
    else S.form[f] = el.value;
    el.closest('[data-field]')?.classList.remove('has-error');
    if (f === 'detail' || f === 'note') $('#cnt-' + f).textContent = `${el.value.length} / 500`;
    if (change && f === 'cust') {
      S.form.site = isNewCust() ? '' : (cust(el.value).sites || [])[0] || ''; S.form.asset = '';
      $('#site-field').innerHTML = siteField(); $('#new-cust').innerHTML = newCustBox(); $('#asset-field').innerHTML = assetField(); $('#addr-box').innerHTML = addrBox();
      refreshIcons(); renderSide(); return;
    }
    if (change && f === 'asset') { $('#asset-field').innerHTML = assetField(); refreshIcons(); renderSide(); return; }
    if (f === 'tech') $('#tech-hint').innerHTML = techSuggest();
    renderSummary();
  }
  view.addEventListener('input', onField);
  view.addEventListener('change', onField);
  $('#tb-search').addEventListener('submit', e => {
    e.preventDefault();
    S.listQuery = $('#tb-q').value.trim(); S.listTab = 'all'; S.listPage = 1;
    if (parse().name === 'tickets') render(); else location.hash = 'tickets';
  });
  let spyRaf = 0;
  addEventListener('scroll', () => {
    if (parse().name !== 'new' || spyRaf || performance.now() < spyLock) return;
    spyRaf = requestAnimationFrame(() => { spyRaf = 0; spy(); });
  }, { passive: true });

  // glass sheen follows the pointer across whichever pane it is over
  document.addEventListener('pointermove', e => {
    const g = e.target.closest && e.target.closest('.glass');
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    g.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
  addEventListener('resize', () => Seg.all());

  // ---------- boot ----------
  $('#tb-logo').innerHTML = L.lockup({ size: 'sm' });
  $('#skin-seg').innerHTML = '<span class="seg-thumb"></span>' + SKINS.map(([v, l]) => `<button type="button" class="seg-btn" data-act="skin" data-v="${v}" aria-pressed="${v === effectiveSkin()}" title="สไตล์${l}"><span class="skin-dot skin-${v}"></span><span class="seg-label">${l}</span></button>`).join('');
  applySkin();
  Store.start(onData);
  Seg.place($('#skin-seg'), false);
  L.replay($('#tb-logo .logo'));
  $('#tb-logo').addEventListener('click', () => L.snap($('#tb-logo .logo')));
  document.fonts?.ready.then(() => { Seg.all(); Dock.redraw(); Rail.redraw(); });
})();
