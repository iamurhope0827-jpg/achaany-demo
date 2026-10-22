// Log22 mobile apps — shared core.
// The screens live inside the app (instant navigation); only data comes from the server.
//   * server address: published at app-config.json on the demo site (the tunnel script keeps it current),
//     remembered on the phone, and changeable by hand on the sign-in screen for testing
//   * session: the token from sign-in, sent as "Authorization: Bearer"
//   * navigation: a stack of screens over a tab bar; Android's back button closes a sheet, then pops a
//     screen, then returns to the first tab, and only there asks for a second press to leave the app
const Core = (() => {
  // where the server address is published; the second entry is the same site if the repo is renamed to "log22"
  const CONFIG_URLS = ['https://iamurhope0827-jpg.github.io/achaany-demo/app-config.json', 'https://iamurhope0827-jpg.github.io/log22/app-config.json'];
  // each app keeps its own sign-in (on the demo site both apps share one web origin, and so one localStorage)
  const NS = (document.documentElement.dataset.app || 'app') + ':';
  const store = {
    get: k => { try { return localStorage.getItem(NS + k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(NS + k) : localStorage.setItem(NS + k, v); } catch { } },
  };
  const native = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  let server = store.get('at_server') || '';
  let token = store.get('at_token') || '';
  let user = null;
  try { user = JSON.parse(store.get('at_user') || 'null'); } catch { user = null; }

  // ---------- small helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n || 0)).toLocaleString('en-US') + '₮';
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const $ = (root, sel) => root.querySelector(sel);
  const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const shortTime = at => String(at || '').slice(0, 10) === today() ? String(at).slice(11, 16) : String(at || '').slice(5, 10).replace('-', '.');

  // one icon family: 24px, 2px stroke, round joins
  const I = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="m9 4-6 2.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z"/><path d="M9 4v13M15 6.5v13"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M5 12h12M12 5l7 7-7 7"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    wheel: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M3.5 10.5c5.5-2 11.5-2 17 0M10.5 13.5 8 20.5M13.5 13.5l2.5 7"/></svg>',
    coins: '<svg viewBox="0 0 24 24"><ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.7-2.7-3-6-3"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    logout: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
    server: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/></svg>',
    mark: '<svg viewBox="0 0 26 26"><rect x="3" y="6" width="20" height="16" rx="2.5"/><path d="M3 11h20M13 6v5"/><path d="M8 16.5h4.5l2-2"/></svg>',
  };

  // ---------- server and session ----------
  async function loadConfig() {
    if (store.get('at_server_manual') && server) return server;
    for (const url of CONFIG_URLS) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(url + '?t=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        const j = await r.json();
        if (j && j.server) { server = String(j.server).replace(/\/+$/, ''); store.set('at_server', server); return server; }
      } catch { /* try the next address; keep the last known one if none answers */ }
    }
    return server;
  }
  function setServer(url, manual) {
    server = String(url || '').trim().replace(/\/+$/, '');
    store.set('at_server', server || null); store.set('at_server_manual', manual && server ? '1' : null);
  }
  function setSession(t, u) {
    token = t || ''; user = u || null;
    store.set('at_token', token || null); store.set('at_user', u ? JSON.stringify(u) : null);
  }
  async function api(path, body) {
    if (!server) await loadConfig();
    if (!server) throw Object.assign(new Error('Серверийн хаяг олдсонгүй. Нэвтрэх хэсгийн "Сервер" дээр оруулна уу.'), { offline: true });
    let res;
    try {
      res = await fetch(server + path, {
        method: body ? 'POST' : 'GET',
        headers: Object.assign({ 'X-Client': 'app', Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}, token ? { Authorization: 'Bearer ' + token } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('Сервертэй холбогдож чадсангүй. Интернэтээ шалгаад дахин оролдоно уу.'), { offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !/\/api\/(login|register)/.test(path)) { setSession(null); if (onSignedOut) onSignedOut(); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Алдаа гарлаа. Дахин оролдоно уу.'), { status: res.status, field: data.field });
    if (data.user && token) { user = data.user; store.set('at_user', JSON.stringify(user)); }
    return data;
  }
  let onSignedOut = null;
  async function login(id, password) {
    const d = await api('/api/login', { email: id, password, remember: true });
    setSession(d.token, d.user); return d.user;
  }
  async function register(data) {
    const d = await api('/api/register', data);
    setSession(d.token, d.user); return d.user;
  }
  async function logout() { try { await api('/api/logout', {}); } catch { } setSession(null); }

  // ---------- screens and the back stack ----------
  const screens = {};
  let tabs = [], stack = [], appEl = null, tabbar = null, onTabBadge = {};
  const define = (name, def) => { screens[name] = def; };
  function mount(entry, anim) {
    const def = screens[entry.name];
    const el = document.createElement('section');
    el.className = 'screen' + (def.tab ? ' has-tabs' : '') + (anim ? ' ' + anim : '');
    el.setAttribute('aria-label', def.label || entry.name);
    appEl.appendChild(el);
    entry.el = el;
    entry.cleanup = def.render(el, entry.params || {}) || null;
    if (typeof entry.cleanup !== 'function') entry.cleanup = null;
    if (anim) el.addEventListener('animationend', () => el.classList.remove(anim), { once: true });
    renderTabbar();
  }
  function unmount(entry, anim) {
    if (entry.cleanup) { try { entry.cleanup(); } catch { } }
    const el = entry.el;
    if (!el) return;
    if (anim) { el.classList.add(anim); el.addEventListener('animationend', () => el.remove(), { once: true }); setTimeout(() => el.remove(), 400); }
    else el.remove();
  }
  const top = () => stack[stack.length - 1];
  // a screen on top of the current one (detail, form)
  function push(name, params) {
    const prev = top();
    const entry = { name, params };
    stack.push(entry);
    mount(entry, 'enter-push');
    if (prev && prev.el) setTimeout(() => { if (top() === entry && prev.el) prev.el.style.visibility = 'hidden'; }, 260);
  }
  // a tab: the stack starts again from it
  function tab(name, params) {
    stack.slice().reverse().forEach(e => unmount(e));
    stack = [{ name, params }];
    mount(stack[0], 'enter-fade');
  }
  // replace the top screen (e.g. after creating an order, show it instead of the form)
  function replace(name, params) {
    const old = stack.pop(); if (old) unmount(old);
    const entry = { name, params }; stack.push(entry); mount(entry);
  }
  function pop() {
    if (stack.length < 2) return false;
    const entry = stack.pop();
    const under = top();
    if (under && under.el) { under.el.style.visibility = ''; const def = screens[under.name]; if (def.resume) def.resume(under.el, under.params || {}); }
    unmount(entry, 'leave-pop');
    renderTabbar();
    return true;
  }
  function current() { const t = top(); return t ? t.name : null; }

  function renderTabbar() {
    if (!tabbar) return;
    const t = top();
    const def = t && screens[t.name];
    tabbar.hidden = !(def && def.tab);
    const active = stack[0] && stack[0].name;
    tabbar.innerHTML = tabs.map(x => `<button type="button" data-tab="${x.name}"${x.name === active ? ' aria-current="page"' : ''}><span class="pill">${x.icon}</span>${esc(x.label)}${onTabBadge[x.name] ? `<em class="count">${onTabBadge[x.name]}</em>` : ''}</button>`).join('');
  }
  function setBadge(name, n) { onTabBadge[name] = n || 0; renderTabbar(); }

  // ---------- sheets ----------
  const sheets = [];
  function sheet({ title, html, actions, onMount, dismissible = true }) {
    const scrim = h('<div class="scrim"></div>');
    const el = h(`<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
      <div class="grabber" aria-hidden="true"></div>
      ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Хаах">${I.close}</button></div>` : ''}
      <div class="sheet-body">${html || ''}</div>
      ${actions ? `<div class="sheet-actions">${actions}</div>` : ''}
    </div>`);
    document.body.append(scrim, el);
    const s = { el, scrim, closed: false, close() {
      if (s.closed) return; s.closed = true;
      sheets.splice(sheets.indexOf(s), 1);
      el.classList.add('closing'); scrim.classList.add('closing');
      setTimeout(() => { el.remove(); scrim.remove(); }, 210);
    } };
    sheets.push(s);
    if (dismissible) scrim.addEventListener('click', () => s.close());
    el.addEventListener('click', e => { if (e.target.closest('[data-close]')) s.close(); });
    if (onMount) onMount(s);
    return s;
  }
  function confirm({ title, text, ok = 'Тийм', cancel = 'Болих', danger = false }) {
    return new Promise(resolve => {
      let answered = false;
      const s = sheet({ title, html: `<p class="muted">${esc(text)}</p>`,
        actions: `<button class="btn btn-block btn-lg ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button><button class="btn btn-block btn-secondary" data-close>${esc(cancel)}</button>`,
        onMount: s => s.el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); s.close(); }) });
      const orig = s.close; s.close = () => { if (!answered) resolve(false); orig(); };
    });
  }

  // ---------- toasts ----------
  function toast(msg, kind = '') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = h(`<div class="toast${kind ? ' ' + kind : ''}" role="status">${esc(msg)}</div>`);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.label = btn.innerHTML; btn.classList.add('busy'); if (label) btn.textContent = label; } else { btn.classList.remove('busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; } };
  const fieldError = (root, name, msg) => { const f = root.querySelector(`[data-field="${name}"]`); if (!f) return false; f.classList.toggle('invalid', !!msg); const e = f.querySelector('.err'); if (e) e.textContent = msg || ''; return true; };

  // ---------- Android back button ----------
  let exitArmed = 0;
  function back() {
    if (sheets.length) { sheets[sheets.length - 1].close(); return; }
    if (pop()) return;
    if (tabs.length && stack[0] && stack[0].name !== tabs[0].name && screens[stack[0].name].tab) { tab(tabs[0].name); return; }
    // the first tab (or the sign-in screen): a second press within 2 s leaves the app
    if (Date.now() - exitArmed < 2000) { const A = native && Capacitor.Plugins.App; if (A) A.exitApp(); return; }
    exitArmed = Date.now(); toast('Гарахын тулд дахин дарна уу');
  }

  // ---------- start ----------
  function start({ tabs: t, first, signedOut, accepts }) {
    // a stored account of the wrong kind (a customer in the driver app, or the reverse) is signed out
    if (token && user && accepts && !accepts(user)) setSession(null);
    appEl = document.getElementById('app');
    tabs = t;
    tabbar = document.createElement('nav'); tabbar.className = 'tabbar'; tabbar.setAttribute('aria-label', 'Үндсэн цэс');
    document.body.appendChild(tabbar);
    tabbar.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && !(top() && top().name === b.dataset.tab && stack.length === 1)) tab(b.dataset.tab); });
    onSignedOut = () => tab(signedOut);
    if (native && Capacitor.Plugins.App) Capacitor.Plugins.App.addListener('backButton', back);
    // in a browser (testing), Escape does what the back button does
    document.addEventListener('keydown', e => { if (e.key === 'Escape') back(); });
    // the shim map.js expects: route requests go through the same API
    window.Auth = { api, current: () => user };
    tab(token ? first : signedOut);
    loadConfig();
  }

  // ---------- shared screens: messages ----------
  // conversations are stored from the customer's side ("out" = customer); a driver sees them as "inbox"
  const mineMsg = (c, m) => (c.inbox ? m.from === 'in' : m.from === 'out');
  function defineMessages({ emptyText }) {
    define('messages', {
      tab: true, label: 'Мессеж',
      render(el) {
        el.innerHTML = `<header class="appbar"><h1>Мессеж</h1></header><div class="scroll"><div class="pad stack" data-list><div class="skeleton" style="height:72px"></div><div class="skeleton" style="height:72px"></div></div></div>`;
        const list = $(el, '[data-list]');
        async function load() {
          try {
            const d = await api('/api/chats');
            setBadge('messages', d.unread || 0);
            const chats = (d.chats || []).filter(c => (c.messages || []).length || c.kind === 'driver');
            list.innerHTML = chats.length ? `<div class="list">${chats.map(c => {
              const last = (c.messages || [])[c.messages.length - 1];
              const support = c.kind === 'support' && !c.inbox;
              return `<button class="row" data-chat="${esc(c.id)}">
                <span class="avatar"${support ? ' style="background:var(--live-soft);color:var(--live)"' : ''}>${support ? I.help : esc(initials(c.name))}</span>
                <span class="grow"><span class="title" style="display:block">${esc(c.name)}</span><span class="sub" style="display:block">${last ? (mineMsg(c, last) ? 'Та: ' : '') + esc(last.text) : (c.orderNo ? '№ ' + esc(c.orderNo) + ' · ' + esc(c.orderTitle || '') : 'Мессеж алга')}</span></span>
                <span class="end">${last ? `<span class="sm faint">${esc(shortTime(last.at))}</span>` : ''}${c.unread ? `<br><span class="tag accent">${c.unread}</span>` : ''}</span>
              </button>`;
            }).join('')}</div>` : `<div class="empty"><div class="ico">${I.chat}</div><h3>Мессеж алга</h3><p>${esc(emptyText)}</p></div>`;
          } catch (e) { list.innerHTML = `<div class="empty"><div class="ico bad">${I.alert}</div><h3>Ачаалж чадсангүй</h3><p>${esc(e.message)}</p><button class="btn btn-secondary" data-retry>Дахин оролдох</button></div>`; }
        }
        el.addEventListener('click', e => {
          const c = e.target.closest('[data-chat]'); if (c) push('thread', { id: c.dataset.chat });
          if (e.target.closest('[data-retry]')) load();
        });
        load();
        const iv = setInterval(load, 10000);
        return () => clearInterval(iv);
      },
      resume() { },
    });
    define('thread', {
      label: 'Чат',
      render(el, { id }) {
        el.innerHTML = `<header class="appbar small"><button class="icon-btn" data-back aria-label="Буцах">${I.back}</button><h1 data-name>Чат</h1><a class="icon-btn" data-call aria-label="Залгах" hidden>${I.phone}</a></header>
          <div class="scroll" data-scroll><div class="bubble-list" data-msgs></div></div>
          <form class="composer" data-form><div class="input"><input name="text" autocomplete="off" placeholder="Мессеж бичих…" aria-label="Мессеж" maxlength="2000" /></div><button class="send" type="submit" aria-label="Илгээх" disabled>${I.send}</button></form>`;
        $(el, '[data-back]').addEventListener('click', () => pop());
        const input = $(el, 'input'), sendBtn = $(el, '.send');
        let lastCount = -1;
        async function load(first) {
          try {
            const d = await api('/api/chats');
            const c = (d.chats || []).find(x => x.id === id);
            if (!c) return;
            $(el, '[data-name]').textContent = c.name;
            if (c.phone) { const call = $(el, '[data-call]'); call.hidden = false; call.href = 'tel:' + c.phone; }
            const msgs = c.messages || [];
            if (msgs.length !== lastCount) {
              lastCount = msgs.length;
              let lastDay = '';
              $(el, '[data-msgs]').innerHTML = (c.orderNo ? `<div class="day-sep">№ ${esc(c.orderNo)} · ${esc(c.orderTitle || '')}</div>` : '') + (msgs.map(m => {
                const day = String(m.at).slice(0, 10); const sep = day !== lastDay ? `<div class="day-sep">${day === today() ? 'Өнөөдөр' : esc(day.replace(/-/g, '.'))}</div>` : ''; lastDay = day;
                return `${sep}<div class="bubble${mineMsg(c, m) ? ' me' : ''}">${esc(m.text)}<time>${esc(String(m.at).slice(11, 16))}</time></div>`;
              }).join('') || '<div class="day-sep">Эхний мессежээ бичээрэй</div>');
              const sc = $(el, '[data-scroll]'); sc.scrollTop = sc.scrollHeight;
            }
            if (first && c.unread) api('/api/chats/read', { id }).catch(() => { });
          } catch (e) { if (first) toast(e.message, 'error'); }
        }
        input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
        $(el, '[data-form]').addEventListener('submit', async e => {
          e.preventDefault();
          const text = input.value.trim(); if (!text) return;
          input.value = ''; sendBtn.disabled = true;
          try { await api('/api/chats/send', { id, text }); lastCount = -1; load(); } catch (err) { input.value = text; toast(err.message, 'error'); }
        });
        load(true);
        const iv = setInterval(load, 5000);
        return () => clearInterval(iv);
      },
    });
  }

  // ---------- shared sign-in pieces ----------
  // the server address, changeable by hand while testing
  function serverSheet() {
    sheet({ title: 'Серверийн хаяг',
      html: `<p class="muted sm" style="margin-bottom:16px">Апп хаягаа автоматаар авдаг. Туршилтын үед өөр сервер рүү холбох бол энд оруулна.</p>
        <div class="field"><label for="srv">Хаяг</label><div class="input">${I.server}<input id="srv" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="https://…" value="${esc(server)}" /></div></div>`,
      actions: '<button class="btn btn-primary btn-block btn-lg" data-save>Хадгалах</button><button class="btn btn-secondary btn-block" data-auto>Автомат хаяг ашиглах</button>',
      onMount: s => {
        s.el.querySelector('[data-save]').addEventListener('click', () => { setServer(s.el.querySelector('#srv').value, true); toast('Хадгалагдлаа'); s.close(); });
        s.el.querySelector('[data-auto]').addEventListener('click', async () => { setServer('', false); await loadConfig(); toast(server ? 'Автомат хаяг: ' + server.replace(/^https?:\/\//, '') : 'Хаяг олдсонгүй'); s.close(); });
      } });
  }

  return {
    native, esc, money, initials, $, h, today, shortTime, icons: I,
    api, login, register, logout, user: () => user, setUser: u => { user = u; store.set('at_user', JSON.stringify(u)); }, serverUrl: () => server, loadConfig,
    define, start, push, pop, tab, replace, back, current, setBadge, sheet, confirm, toast, busy, fieldError, defineMessages, serverSheet,
  };
})();
