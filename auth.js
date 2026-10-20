// Authentication client — talks to the account API in server.ps1.
// Accounts are saved on the server (data/users.json); the sign-in is an HttpOnly cookie.
const Auth = (function () {
  const OFFLINE = 'Сервертэй холбогдож чадсангүй. server.ps1 ажиллаж байгаа эсэхийг шалгана уу.';
  let user = null;

  async function api(path, body) {
    // static hosting (no server.ps1): use the in-browser demo backend from mock-api.js
    if (typeof MockApi !== 'undefined' && MockApi.enabled) {
      try { return await MockApi.handle(body ? 'POST' : 'GET', path, body || {}); }
      catch (e) { throw Object.assign(new Error(e.error || e.message || 'Алдаа гарлаа'), { status: e.status, field: e.field }); }
    }
    let res;
    try {
      res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } catch {
      throw Object.assign(new Error(OFFLINE), { offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || OFFLINE), { status: res.status, field: data.field });
    return data;
  }

  // Resolves once with the signed-in user (or null)
  const ready = api('/api/me').then(d => (user = d.user), () => null);

  return {
    ready,
    api,
    current: () => user,
    setUser: u => { user = u; if (typeof App !== 'undefined') App.setUser(u); },
    validateEmail: e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim()),

    // 0–4: length, mixed case, digit, symbol
    passwordScore(p) {
      let s = 0;
      if (p.length >= 8) s++;
      if (/[a-zа-яөү]/.test(p) && /[A-ZА-ЯӨҮ]/.test(p)) s++;
      if (/\d/.test(p)) s++;
      if (/[^A-Za-z0-9А-Яа-яӨөҮү]/.test(p)) s++;
      return p.length < 6 ? Math.min(s, 1) : s;
    },

    async register({ name, email, password, type }) {
      return (user = (await api('/api/register', { name, email, password, type })).user);
    },

    async login(email, password, remember) {
      return (user = (await api('/api/login', { email, password, remember: !!remember })).user);
    },

    async updateProfile(data) {
      return (user = (await api('/api/profile', data)).user);
    },

    async logout() {
      try { await api('/api/logout', {}); } catch { /* clear locally anyway */ }
      user = null;
      location.href = 'login.html';
    },

    async exists(email) {
      try { return (await api('/api/exists?email=' + encodeURIComponent(email))).exists; } catch { return false; }
    },

    // Call in <head> of protected pages: hides the page until the session is confirmed
    requireLogin() {
      document.documentElement.style.visibility = 'hidden';
      ready.then(u => {
        if (u) { document.documentElement.style.visibility = ''; return; }
        const next = encodeURIComponent(location.pathname.split('/').pop() + location.hash);
        location.replace('login.html?next=' + next);
      });
    },

    // Call on login/register pages
    redirectIfLoggedIn() {
      ready.then(u => { if (u) location.replace(this.nextUrl()); });
    },

    nextUrl() {
      const next = new URLSearchParams(location.search).get('next') || '';
      return /^[\w-]+\.html(#[\w-]*)?$/.test(next) ? next : 'index.html';
    },
  };
})();
