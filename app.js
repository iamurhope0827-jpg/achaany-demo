// Shared app shell + helpers for every signed-in page.
// Renders the sidebar, top bar and mobile tab bar, and exposes App.* helpers
// (api, toast, modal, notifications, wallet top-up). Load after auth.js, before the page script.
const App = (function () {
  const body = document.body;
  const page = body.dataset.page || '';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');

  // ---------- small helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n || 0)).toLocaleString('en-US') + '₮';
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const today = () => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const I = {
    grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/></svg>',
    invoice: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h4"/></svg>',
    ticket: '<svg viewBox="0 0 24 24"><path d="M3 9h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    panel: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 10l-2 2 2 2"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    logout: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
  };

  // ---------- shell ----------
  const NAV_MAIN = [
    { id: 'index', href: 'index.html', label: 'Нүүр самбар', icon: I.grid },
    { id: 'orders', href: 'orders.html', label: 'Миний ачаанууд', icon: I.box },
    { id: 'messages', href: 'messages.html', label: 'Мессеж', icon: I.chat, badge: 'nav-messages' },
  ];
  const NAV_MORE = [
    { id: 'wallet', href: 'wallet.html', label: 'Данс ба нэхэмжлэх', icon: I.invoice },
    { id: 'promotions', href: 'promotions.html', label: 'Урамшуулал', icon: I.ticket },
  ];
  const NAV_BOTTOM = [
    { id: 'help', href: 'help.html', label: 'Тусламж', icon: I.help },
    { id: 'settings', href: 'settings.html', label: 'Тохиргоо', icon: I.gear },
  ];
  const navItem = n => `<li><a href="${n.href}"${n.id === page ? ' class="active"' : ''}>${n.icon}<span>${n.label}</span>${n.badge ? `<em class="count" id="${n.badge}" hidden>0</em>` : ''}</a></li>`;

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';
  sidebar.innerHTML = `
    <a href="index.html" class="brand">
      <span class="brand-mark">А</span>
      <div class="brand-text"><b>Ачааны төв</b><small>Тээврийн удирдлагын систем</small></div>
    </a>
    <a href="new-order.html" class="new-btn">${I.plus}<span>Шинэ ачаа бүртгэх</span></a>
    <div class="nav-label">Үндсэн</div>
    <ul class="nav">${NAV_MAIN.map(navItem).join('')}</ul>
    <div class="nav-label" style="margin-top:14px">Бусад</div>
    <ul class="nav">${NAV_MORE.map(navItem).join('')}</ul>
    <div class="side-bottom">
      <ul class="nav">${NAV_BOTTOM.map(navItem).join('')}</ul>
      <div class="side-user clickable${page === 'profile' ? ' active' : ''}" role="link" tabindex="0" title="Профайл">
        <span class="avatar"></span>
        <div><b></b><small></small></div>
        <button class="logout" aria-label="Гарах" title="Гарах">${I.logout}</button>
      </div>
    </div>`;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'overlay';
  body.prepend(overlay);
  body.prepend(sidebar);

  const main = document.querySelector('.main');
  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <button class="icon-btn menu-btn" id="menu-btn" aria-label="Цэс нээх">${I.menu}</button>
    <button class="icon-btn collapse-btn" id="collapse-btn" aria-label="Цэс хураах">${I.panel}</button>
    <form class="search" id="top-search" role="search">
      ${I.search}
      <input type="search" name="q" placeholder="Ачаа, дугаар, хаягаар хайх…" autocomplete="off" />
      <kbd>/</kbd>
    </form>
    <div class="top-right">
      <span class="date-chip">${today().replace(/-/g, '.')}</span>
      <div class="bell-wrap">
        <button class="icon-btn" id="bell-btn" aria-label="Мэдэгдэл" aria-expanded="false">${I.bell}<span class="dot" id="bell-dot" hidden></span></button>
        <div class="notif-panel card" id="notif-panel" hidden></div>
      </div>
      <a href="new-order.html" class="btn btn-primary">${I.plus}<span>Шинэ ачаа</span></a>
    </div>`;
  main.prepend(topbar);

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'bottom-nav';
  bottomNav.innerHTML = [
    { id: 'index', href: 'index.html', label: 'Нүүр', icon: I.grid },
    { id: 'orders', href: 'orders.html', label: 'Ачаа', icon: I.box },
    { id: 'messages', href: 'messages.html', label: 'Мессеж', icon: I.chat },
    { id: 'wallet', href: 'wallet.html', label: 'Данс', icon: I.wallet },
    { id: 'profile', href: 'profile.html', label: 'Профайл', icon: I.user },
  ].map(n => `<a href="${n.href}"${n.id === page ? ' class="active"' : ''}>${n.icon}${n.label}</a>`).join('');
  body.appendChild(bottomNav);

  // Sidebar: collapse on desktop/tablet, drawer on mobile
  const isTablet = () => window.matchMedia('(max-width: 1279px)').matches;
  document.getElementById('collapse-btn').addEventListener('click', () => body.classList.toggle(isTablet() ? 'expanded' : 'collapsed'));
  document.getElementById('menu-btn').addEventListener('click', () => body.classList.add('drawer-open'));
  overlay.addEventListener('click', () => body.classList.remove('drawer-open'));

  // User card → profile; logout button
  const card = sidebar.querySelector('.side-user');
  card.addEventListener('click', () => { location.href = 'profile.html'; });
  card.addEventListener('keydown', e => { if (e.key === 'Enter') location.href = 'profile.html'; });
  card.querySelector('.logout').addEventListener('click', e => { e.stopPropagation(); Auth.logout(); });

  function setUser(u) {
    if (!u) return;
    card.querySelector('.avatar').textContent = initials(u.name);
    card.querySelector('b').textContent = u.name;
    card.querySelector('small').textContent = u.email;
    card.title = `${u.name} · ${u.type}`;
  }
  Auth.ready.then(setUser);

  // Top-bar search → orders page
  const searchForm = document.getElementById('top-search');
  const searchInput = searchForm.querySelector('input');
  const q = new URLSearchParams(location.search).get('q');
  if (q) searchInput.value = q;
  searchForm.addEventListener('submit', e => {
    e.preventDefault();
    const v = searchInput.value.trim();
    if (page === 'orders' && window.OrdersPage) { OrdersPage.search(v); return; }
    location.href = 'orders.html' + (v ? '?q=' + encodeURIComponent(v) : '');
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // Messages badge = unread messages saved on the server
  function setMessagesBadge(n) {
    const b = document.getElementById('nav-messages');
    b.textContent = n;
    b.hidden = !n;
  }
  async function loadChatBadge() {
    try { setMessagesBadge((await Auth.api('/api/chats')).unread || 0); } catch { }
  }
  Auth.ready.then(u => { if (u && page !== 'messages') loadChatBadge(); });

  // ---------- toast ----------
  function toast(msg, kind = '') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  // ---------- modal ----------
  function modal({ title, html, wide = false, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-box${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Хаах">${I.close}</button></header>
        <div class="modal-body">${html}</div>
      </div>`;
    const prevFocus = document.activeElement;
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      onClose && onClose();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    body.appendChild(wrap);
    const first = wrap.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button');
    if (first) first.focus();
    return { el: wrap, close, $: sel => wrap.querySelector(sel) };
  }

  // Inline field errors used by forms inside modals/pages
  function fieldError(root, name, msg) {
    const f = root.querySelector(`[data-field="${name}"]`);
    if (!f) return false;
    f.classList.toggle('invalid', !!msg);
    const e = f.querySelector('.err');
    if (e) e.textContent = msg || '';
    return true;
  }
  function formAlert(root, msg) {
    const a = root.querySelector('.form-alert.error');
    if (!a) return;
    a.hidden = !msg;
    a.querySelector('span').textContent = msg || '';
  }

  // ---------- notifications ----------
  const bellBtn = document.getElementById('bell-btn');
  const panel = document.getElementById('notif-panel');
  let notes = [];
  const noteIcon = k => (k === 'ok' ? I.check : k === 'alert' ? I.alert : I.info);

  async function loadNotifications() {
    try {
      const d = await Auth.api('/api/notifications');
      notes = d.notifications || [];
      document.getElementById('bell-dot').hidden = !d.unread;
      return notes;
    } catch { return []; }
  }
  function renderPanel() {
    panel.innerHTML = `
      <header><b>Мэдэгдэл</b><button class="btn btn-ghost" id="notif-read">Бүгдийг уншсан</button></header>
      <div class="notif-list">${notes.length ? notes.slice(0, 20).map(n => `
        <a class="notif ${n.read ? '' : 'unread'} ${esc(n.kind)}" href="${esc(n.link || 'index.html')}">
          <span class="notif-ico">${noteIcon(n.kind)}</span>
          <span><b>${esc(n.title)}</b><small>${esc(n.text)}</small><time>${esc(n.at)}</time></span>
        </a>`).join('') : '<p class="notif-empty">Шинэ мэдэгдэл алга.</p>'}</div>`;
    panel.querySelector('#notif-read').addEventListener('click', async e => {
      e.stopPropagation();
      await Auth.api('/api/notifications/read', {}).catch(() => {});
      notes.forEach(n => (n.read = true));
      document.getElementById('bell-dot').hidden = true;
      renderPanel();
    });
  }
  async function openNotifications() {
    await loadNotifications();
    renderPanel();
    panel.hidden = false;
    bellBtn.setAttribute('aria-expanded', 'true');
  }
  function closeNotifications() { panel.hidden = true; bellBtn.setAttribute('aria-expanded', 'false'); }
  bellBtn.addEventListener('click', e => { e.stopPropagation(); panel.hidden ? openNotifications() : closeNotifications(); });
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target)) closeNotifications(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotifications(); });
  Auth.ready.then(u => { if (u) loadNotifications(); });

  // ---------- wallet top-up (used on dashboard, wallet, profile) ----------
  function topup(onDone) {
    const m = modal({
      title: 'Данс цэнэглэх',
      html: `
        <form class="auth-form" novalidate>
          <div class="form-alert error" hidden>${I.alert}<span></span></div>
          <div class="field" data-field="amount">
            <label for="tp-amount">Дүн (₮)</label>
            <div class="input"><input id="tp-amount" inputmode="numeric" placeholder="50,000" /></div>
            <div class="chips">${[10000, 50000, 100000, 300000].map(v => `<button type="button" class="chip-btn" data-amount="${v}">${money(v)}</button>`).join('')}</div>
            <span class="err"></span>
          </div>
          <div class="field">
            <label>Төлбөрийн хэрэгсэл</label>
            <div class="type-pick three">
              ${['QPay', 'Карт', 'Банкны шилжүүлэг'].map((p, i) => `<label><input type="radio" name="tp-method" value="${p}"${i ? '' : ' checked'} />${p}</label>`).join('')}
            </div>
          </div>
          <p class="hint">Туршилтын горим: төлбөр шууд баталгаажна.</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" data-close>Болих</button>
            <button type="submit" class="btn btn-primary">Цэнэглэх</button>
          </div>
        </form>`,
    });
    const input = m.$('#tp-amount');
    const fmt = () => { const n = input.value.replace(/\D/g, ''); input.value = n ? Number(n).toLocaleString('en-US') : ''; fieldError(m.el, 'amount', ''); };
    input.addEventListener('input', fmt);
    m.el.querySelectorAll('[data-amount]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.amount; fmt(); }));
    m.$('form').addEventListener('submit', async e => {
      e.preventDefault();
      const amount = Number(input.value.replace(/\D/g, ''));
      if (!amount || amount < 1000) { fieldError(m.el, 'amount', 'Хамгийн багадаа 1,000₮ цэнэглэнэ.'); return; }
      const btn = m.$('button[type="submit"]');
      btn.disabled = true;
      try {
        const d = await Auth.api('/api/wallet/topup', { amount, method: m.$('input[name="tp-method"]:checked').value });
        Auth.setUser(d.user);
        m.close();
        toast(`${money(amount)} цэнэглэгдлээ`);
        loadNotifications();
        onDone && onDone(d.user, d.transaction);
      } catch (err) {
        if (!(err.field && fieldError(m.el, err.field, err.message))) formAlert(m.el, err.message);
        btn.disabled = false;
      }
    });
  }

  // Order vocabulary shared by dashboard, orders and new-order pages
  const TYPES = [{ key: 'delivery', label: 'Хүргэлт' }];
  const STATUS = {
    waiting: { label: 'Санал хүлээж буй', chip: 'waiting', group: 'active' },
    transit: { label: 'Замдаа яваа', chip: 'transit', group: 'active' },
    done: { label: 'Хүргэгдсэн', chip: 'done', group: 'done' },
    cancelled: { label: 'Цуцлагдсан', chip: 'cancelled', group: 'cancelled' },
  };
  const typeLabel = k => (TYPES.find(t => t.key === k) || { label: k }).label;

  return { page, esc, money, initials, today, icons: I, toast, modal, fieldError, formAlert, topup, setUser, setMessagesBadge, loadChatBadge, openNotifications, loadNotifications, TYPES, STATUS, typeLabel, api: (p, b) => Auth.api(p, b) };
})();
