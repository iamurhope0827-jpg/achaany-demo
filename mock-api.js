// Demo backend for static hosting (Netlify / GitHub Pages).
// When the site is not served by server.ps1 (anything other than localhost), auth.js sends every
// /api/... call here instead. It mirrors server.ps1, but stores data in this browser's localStorage,
// so every tester gets a private copy (including a test admin: admin123 / admin123).
const MockApi = (function () {
  const params = new URLSearchParams(location.search);
  try { if (params.has('demo')) sessionStorage.setItem('force_demo', '1'); } catch { }
  const forced = (() => { try { return sessionStorage.getItem('force_demo') === '1'; } catch { return false; } })();
  const enabled = forced || location.protocol === 'file:' || !['localhost', '127.0.0.1'].includes(location.hostname);

  const KEY = 'achaany_demo_db_v1';
  const SESSION = 'achaany_demo_session';
  const pad = n => String(n).padStart(2, '0');
  const nowLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const nowIso = () => new Date().toISOString();
  const id = () => Math.random().toString(36).slice(2, 14);
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));
  const fail = (status, error, field) => { throw { status, error, field }; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

  const STATUS_TEXT = { waiting: 'Санал хүлээж буй', transit: 'Замдаа яваа', done: 'Хүргэгдсэн', cancelled: 'Цуцлагдсан' };
  const PLANS = { standard: { name: 'Стандарт', price: 49000 }, business: { name: 'Бизнес', price: 129000 }, corporate: { name: 'Корпорат', price: 290000 } };
  const COUPONS = { ACHAA10: { title: 'Шинэ хэрэглэгчийн бэлэг', amount: 10000 }, HURDAN5: { title: 'Хурдан хүргэлтийн урамшуулал', amount: 5000 } };
  const DRIVERS = [{ name: 'Бат-Эрдэнэ', phone: '88112233' }, { name: 'Мөнхбат', phone: '99445566' }, { name: 'Ганзориг', phone: '95112244' }, { name: 'Түмэнбаяр', phone: '80223344' }];

  async function hash(password, salt) {
    const data = new TextEncoder().encode(salt + ':' + password);
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; for (const b of data) h = (h * 33) ^ b; return 'x' + (h >>> 0).toString(16);
  }

  // ---------- storage ----------
  let db = null;
  function load() {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
    if (!db || !Array.isArray(db.users)) db = { users: [], orders: [], tx: [], notes: [], chats: [] };
    return db;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { } }
  const session = {
    get() { try { return sessionStorage.getItem(SESSION) || localStorage.getItem(SESSION); } catch { return null; } },
    set(email, remember) { try { (remember ? localStorage : sessionStorage).setItem(SESSION, email); } catch { } },
    clear() { try { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch { } },
  };

  const findUser = email => load().users.find(u => u.email === email);
  const publicUser = u => ({
    name: u.name, email: u.email, username: u.username || '', type: u.type, role: u.role || 'user', status: u.status || 'active',
    phone: u.phone || '', regNo: u.regNo || '', partnerCode: u.partnerCode || '', sector: u.sector || 'Бусад',
    vatPayer: !!u.vatPayer, regVerified: !!u.regVerified, plan: u.plan || '', planUntil: u.planUntil || '', wallet: u.wallet || 0,
    managers: u.managers || [], usedCoupons: u.usedCoupons || [],
    settings: Object.assign({ autopay: true, notifyEmail: true, notifySms: false }, u.settings || {}),
    createdAt: u.createdAt, lastLogin: u.lastLogin || '',
  });
  function note(email, title, text, kind = 'info', link = '') {
    load().notes.unshift({ id: id(), email, title, text, kind, link, at: nowLocal(), read: false });
  }
  function addTx(email, kind, title, amount, method, balanceAfter) {
    const d = new Date();
    const tx = { id: id(), no: `INV-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rnd(1000, 9999)}`, email, kind, title, amount, method, balanceAfter, at: nowLocal() };
    load().tx.unshift(tx);
    return tx;
  }
  const newOrderNo = () => { let no; do { no = 'PO' + rnd(100000, 999999); } while (load().orders.some(o => o.no === no)); return no; };
  const addHistory = (o, status, text) => { o.history = (o.history || []).concat([{ at: nowLocal(), status, text }]); };
  const msg = (from, text) => ({ from, text, at: nowLocal() });

  function userChats(email) {
    const d = load();
    if (!d.chats.some(c => c.owner === email && c.kind === 'support')) {
      d.chats.push({ id: 'support-' + id(), owner: email, kind: 'support', name: 'Ачааны төв · Тусламж', sub: 'Тусламжийн баг', phone: '70000000',
        orderNo: '', orderTitle: '', online: true, muted: false, unread: 1, staffUnread: 0,
        messages: [msg('in', 'Сайн байна уу! Ачааны төвд тавтай морил. Захиалга, төлбөр эсвэл жолоочтой холбоотой асуулт байвал энд бичээрэй.')] });
    }
    return d.chats;
  }
  function addDriverChat(email, o) {
    const d = load();
    if (d.chats.some(c => c.owner === email && c.orderNo === o.no)) return;
    const drv = DRIVERS[rnd(0, DRIVERS.length)];
    const vehicle = (o.needs || [])[0];
    d.chats.push({ id: 'drv-' + id(), owner: email, kind: 'driver', name: drv.name, sub: 'Жолооч' + (vehicle ? ' · ' + vehicle : ''), phone: drv.phone,
      orderNo: o.no, orderTitle: o.title, online: true, muted: false, unread: 1, staffUnread: 0,
      messages: [msg('in', `Сайн байна уу! № ${o.no} (${o.title}) захиалгыг тань авлаа. Ачааг авахаар явж байна.`)] });
    note(email, `Жолооч олдлоо: ${drv.name}`, `№ ${o.no} · ${o.title} — чатаар холбогдоорой.`, 'ok', 'messages.html');
  }
  function inboxView(c) {
    const u = findUser(c.owner);
    return Object.assign(clone(c), { inbox: true, name: u ? u.name : c.owner, sub: 'Хэрэглэгч · ' + c.owner, phone: (u && u.phone) || '', online: false, muted: false, unread: c.staffUnread || 0 });
  }

  // ---------- seed: test admin + demo orders ----------
  let seeded = null;
  function seed() {
    if (seeded) return seeded;
    seeded = (async () => {
      const d = load();
      if (d.users.some(u => u.username === 'admin123')) return;
      const salt = id();
      const admin = { id: id(), name: 'Админ', username: 'admin123', email: 'admin123@achaanytuv.local', type: 'Байгууллага', role: 'admin', status: 'active',
        phone: '99119911', regNo: 'АА00000000', partnerCode: 'PR' + rnd(10000, 99999), sector: 'Логистик', vatPayer: true, regVerified: true,
        plan: '', planUntil: '', wallet: 0, managers: [], usedCoupons: [], createdAt: nowIso(), lastLogin: '', salt, hash: await hash('admin123', salt) };
      d.users.push(admin);
      const demo = [
        { title: 'Бичиг баримт', from: 'Сүхбаатар дүүрэг, 1-р хороо', to: 'Хан-Уул дүүрэг, 15-р хороо', needs: ['Мопед'], price: 8000, status: 'waiting', days: 0, offers: 3 },
        { title: 'Хүнсний бүтээгдэхүүн', from: 'Баянгол дүүрэг, 3-р хороо', to: 'Хан-Уул дүүрэг, Ривер гарден', needs: ['Суудлын автомашин'], price: 15000, status: 'transit', days: 1, offers: 2 },
        { title: 'Тоглоом', from: 'Чингэлтэй дүүрэг, 4-р хороо', to: 'Баянзүрх дүүрэг, Сэрээ таун 806 байр', needs: ['Мопед', 'Суудлын автомашин'], price: 12000, status: 'cancelled', days: 4, offers: 0 },
        { title: 'Цэцэг', from: 'Сүхбаатар дүүрэг, 8-р хороо', to: 'Чингэлтэй дүүрэг, 4-р хороо', needs: ['Мопед'], price: 10000, status: 'done', days: 6, offers: 1 },
        { title: 'Гэр ахуйн бараа', from: 'Баянгол дүүрэг, 6-р хороо', to: 'Сонгинохайрхан дүүрэг, 20-р хороо', needs: ['Портер', 'Ачигч'], price: 45000, status: 'waiting', days: 2, offers: 4 },
      ];
      for (const x of demo) {
        const at = new Date(); at.setDate(at.getDate() - x.days); at.setHours(at.getHours() - rnd(1, 8));
        const o = { no: newOrderNo(), type: 'delivery', owner: admin.email, title: x.title, from: x.from, to: x.to, needs: x.needs, urgent: x.days < 2, weight: 0,
          price: x.price, note: '', pickupDate: '', status: x.status, views: rnd(3, 25), offers: x.offers, done: x.status === 'done' ? 1 : 0, total: 1,
          creator: admin.name, date: nowLocal(at), createdAt: at.toISOString(), history: [{ at: nowLocal(at), status: 'waiting', text: 'Захиалга үүслээ' }] };
        if (x.status !== 'waiting') addHistory(o, x.status, STATUS_TEXT[x.status]);
        d.orders.push(o);
      }
      note(admin.email, 'Тавтай морил!', 'Туршилтын захиалгууд нэмэгдлээ. Админ та захиалгын төлөвийг дэлгэрэнгүй хэсгээс өөрчилж болно.', 'ok', 'orders.html');
      d.orders.filter(o => o.status === 'transit').forEach(o => addDriverChat(admin.email, o));
      save();
    })();
    return seeded;
  }

  // ---------- request handler ----------
  async function handle(method, url, b = {}) {
    await seed();
    const d = load();
    const u0 = new URL(url, location.href);
    const path = u0.pathname.replace(/^.*\/api\//, '/api/');
    const trimmed = v => String(v ?? '').trim();

    // public
    if (path === '/api/exists') return { exists: !!findUser(trimmed(u0.searchParams.get('email')).toLowerCase()) };
    if (path === '/api/register' && method === 'POST') {
      const name = trimmed(b.name), email = trimmed(b.email).toLowerCase(), password = String(b.password || '');
      if (name.length < 2) fail(400, 'Нэрээ бүтнээр оруулна уу.', 'name');
      if (!isEmail(email)) fail(400, 'Имэйлийн хаяг буруу байна.', 'email');
      if (password.length < 8) fail(400, 'Нууц үг хамгийн багадаа 8 тэмдэгт байна.', 'password');
      if (findUser(email)) fail(409, 'Энэ имэйлээр бүртгэл аль хэдийн үүссэн байна.', 'email');
      const salt = id();
      const u = { id: id(), name, email, type: ['Хувь хүн', 'Байгууллага'].includes(b.type) ? b.type : 'Хувь хүн', role: 'user', status: 'active',
        phone: '', regNo: '', partnerCode: 'PR' + rnd(10000, 99999), sector: 'Бусад', vatPayer: false, regVerified: false, plan: '', planUntil: '',
        wallet: 0, managers: [], usedCoupons: [], createdAt: nowIso(), lastLogin: nowIso(), salt, hash: await hash(password, salt) };
      d.users.push(u);
      note(email, 'Тавтай морил!', 'Бүртгэл амжилттай үүслээ. Анхны ачаагаа бүртгээд эхлээрэй.', 'ok', 'new-order.html');
      save(); session.set(email, true);
      return { user: publicUser(u) };
    }
    if (path === '/api/login' && method === 'POST') {
      const ident = trimmed(b.email).toLowerCase();
      const u = d.users.find(x => x.email === ident || (x.username && x.username === ident));
      if (!u || u.hash !== await hash(String(b.password || ''), u.salt)) fail(401, 'Имэйл эсвэл нууц үг буруу байна.');
      u.lastLogin = nowIso(); save(); session.set(u.email, !!b.remember);
      return { user: publicUser(u) };
    }
    if (path === '/api/logout') { session.clear(); return { ok: true }; }

    // signed-in
    const me = findUser(session.get());
    if (!me) fail(401, 'Нэвтрээгүй байна.');
    const ok = r => { save(); return r; };

    switch (path) {
      case '/api/me': return { user: publicUser(me) };
      case '/api/logout-all': session.clear(); return { ok: true };
      case '/api/profile': {
        const name = trimmed(b.name), phone = trimmed(b.phone).replace(/\s/g, ''), regNo = trimmed(b.regNo).toUpperCase();
        if (name.length < 2) fail(400, 'Нэрээ бүтнээр оруулна уу.', 'name');
        if (phone && !/^\d{8}$/.test(phone)) fail(400, 'Утасны дугаар 8 оронтой байна.', 'phone');
        if (regNo.length > 20) fail(400, 'Регистрийн дугаар хэт урт байна.', 'regNo');
        Object.assign(me, { name, phone, regNo, sector: trimmed(b.sector) || 'Бусад', vatPayer: !!b.vatPayer });
        if (['Хувь хүн', 'Байгууллага'].includes(b.type)) me.type = b.type;
        return ok({ user: publicUser(me) });
      }
      case '/api/settings': {
        me.settings = Object.assign({ autopay: true, notifyEmail: true, notifySms: false }, me.settings || {});
        ['autopay', 'notifyEmail', 'notifySms'].forEach(k => { if (b[k] !== undefined) me.settings[k] = !!b[k]; });
        return ok({ user: publicUser(me) });
      }
      case '/api/password': {
        if (me.hash !== await hash(String(b.current || ''), me.salt)) fail(400, 'Одоогийн нууц үг буруу байна.', 'current');
        if (String(b.next || '').length < 8) fail(400, 'Шинэ нууц үг хамгийн багадаа 8 тэмдэгт байна.', 'next');
        me.salt = id(); me.hash = await hash(b.next, me.salt);
        note(me.email, 'Нууц үг солигдлоо', 'Таны нууц үг амжилттай шинэчлэгдлээ.', 'ok');
        return ok({ ok: true });
      }
      case '/api/orders': {
        if (method === 'GET') return { orders: clone(d.orders.filter(o => o.owner === me.email).sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1))) };
        const title = trimmed(b.title), from = trimmed(b.from), to = trimmed(b.to), price = Number(b.price) || 0;
        if (b.type !== 'delivery') fail(400, 'Тээврийн төрөл буруу байна.', 'type');
        if (title.length < 2) fail(400, 'Ачааны нэрээ оруулна уу.', 'title');
        if (from.length < 3) fail(400, 'Ачаа авах хаягаа оруулна уу.', 'from');
        if (to.length < 3) fail(400, 'Хүргэх хаягаа оруулна уу.', 'to');
        if (price < 1000 || price > 1e8) fail(400, 'Үнэ 1,000₮-өөс их байна.', 'price');
        const o = { no: newOrderNo(), type: 'delivery', owner: me.email, title, from, to, needs: (b.needs || []).map(trimmed).filter(Boolean).slice(0, 8),
          urgent: !!b.urgent, weight: Number(b.weight) || 0, price, note: trimmed(b.note), pickupDate: trimmed(b.pickupDate), status: 'waiting',
          views: 0, offers: 0, done: 0, total: 1, creator: me.name, date: nowLocal(), createdAt: nowIso(), history: [] };
        addHistory(o, 'waiting', 'Захиалга үүслээ');
        d.orders.push(o);
        note(me.email, 'Шинэ захиалга үүслээ', `№ ${o.no} · ${title} — жолоочдын санал удахгүй ирнэ.`, 'info', 'orders.html');
        return ok({ order: clone(o) });
      }
      case '/api/orders/action': {
        const o = d.orders.find(x => x.no === b.no && x.owner === me.email);
        if (!o) fail(404, 'Захиалга олдсонгүй.');
        if (b.action === 'cancel') {
          if (!['waiting', 'transit'].includes(o.status)) fail(400, 'Энэ захиалгыг цуцлах боломжгүй.');
          o.status = 'cancelled'; addHistory(o, 'cancelled', 'Хэрэглэгч цуцалсан');
        } else if (b.action === 'restore') {
          if (o.status !== 'cancelled') fail(400, 'Зөвхөн цуцлагдсан захиалгыг сэргээнэ.');
          o.status = 'waiting'; addHistory(o, 'waiting', 'Захиалга сэргээгдсэн');
        } else if (b.action === 'status') {
          if (me.role !== 'admin') fail(403, 'Зөвхөн админ төлөв өөрчилнө.');
          if (!STATUS_TEXT[b.status]) fail(400, 'Төлөв буруу байна.');
          o.status = b.status;
          if (b.status === 'transit' && o.offers < 1) o.offers = 1;
          if (b.status === 'done') o.done = o.total;
          addHistory(o, b.status, STATUS_TEXT[b.status]);
          if (b.status === 'transit') addDriverChat(me.email, o);
          note(me.email, `Захиалгын төлөв: ${STATUS_TEXT[b.status]}`, `№ ${o.no} · ${o.title}`, b.status === 'done' ? 'ok' : b.status === 'cancelled' ? 'alert' : 'info', 'orders.html');
        } else fail(400, 'Үйлдэл буруу байна.');
        return ok({ order: clone(o) });
      }
      case '/api/wallet': return { balance: me.wallet || 0, transactions: clone(d.tx.filter(t => t.email === me.email)) };
      case '/api/wallet/topup': {
        const amount = Math.floor(Number(b.amount) || 0);
        if (amount < 1000 || amount > 1e7) fail(400, 'Цэнэглэх дүн 1,000₮ – 10,000,000₮ байна.', 'amount');
        const methodName = ['QPay', 'Карт', 'Банкны шилжүүлэг'].includes(b.method) ? b.method : 'QPay';
        me.wallet = (me.wallet || 0) + amount;
        const tx = addTx(me.email, 'topup', 'Хэтэвч цэнэглэлт', amount, methodName, me.wallet);
        note(me.email, 'Данс цэнэглэгдлээ', `+${amount.toLocaleString('en-US')}₮ · ${methodName}`, 'ok', 'wallet.html');
        return ok({ user: publicUser(me), transaction: tx });
      }
      case '/api/plans': return { plans: Object.entries(PLANS).map(([k, p]) => ({ id: k, name: p.name, price: p.price })) };
      case '/api/plan': {
        const p = PLANS[b.plan];
        if (!p) fail(400, 'Багц олдсонгүй.');
        if ((me.wallet || 0) < p.price) fail(402, `Хэтэвчний үлдэгдэл хүрэлцэхгүй байна. ${p.price.toLocaleString('en-US')}₮ шаардлагатай — эхлээд дансаа цэнэглэнэ үү.`);
        let start = new Date();
        if (me.plan === p.name && me.planUntil && new Date(me.planUntil) > start) start = new Date(me.planUntil);
        start.setDate(start.getDate() + 30);
        me.wallet -= p.price; me.plan = p.name;
        me.planUntil = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
        const tx = addTx(me.email, 'plan', `${p.name} багц (30 хоног)`, -p.price, 'Хэтэвч', me.wallet);
        note(me.email, `${p.name} багц идэвхжлээ`, `${me.planUntil} хүртэл хүчинтэй.`, 'ok', 'profile.html');
        return ok({ user: publicUser(me), transaction: tx });
      }
      case '/api/coupons': return { coupons: Object.entries(COUPONS).map(([k, c]) => ({ code: k, title: c.title, amount: c.amount, used: (me.usedCoupons || []).includes(k) })) };
      case '/api/coupon': {
        const code = trimmed(b.code).toUpperCase();
        const c = COUPONS[code];
        if (!c) fail(404, 'Купоны код буруу байна.', 'code');
        if ((me.usedCoupons || []).includes(code)) fail(409, 'Энэ купоныг та ашигласан байна.', 'code');
        me.usedCoupons = (me.usedCoupons || []).concat(code);
        me.wallet = (me.wallet || 0) + c.amount;
        const tx = addTx(me.email, 'coupon', `Купон: ${code}`, c.amount, 'Урамшуулал', me.wallet);
        note(me.email, 'Купон идэвхжлээ', `+${c.amount.toLocaleString('en-US')}₮ хэтэвчинд нэмэгдлээ.`, 'ok', 'wallet.html');
        return ok({ user: publicUser(me), transaction: tx });
      }
      case '/api/managers': {
        const name = trimmed(b.name), phone = trimmed(b.phone).replace(/\s/g, ''), email = trimmed(b.email).toLowerCase();
        if (name.length < 2) fail(400, 'Менежерийн нэрийг оруулна уу.', 'm-name');
        if (!/^\d{8}$/.test(phone)) fail(400, 'Утасны дугаар 8 оронтой байна.', 'm-phone');
        if (email && !isEmail(email)) fail(400, 'Имэйлийн хаяг буруу байна.', 'm-email');
        if ((me.managers || []).length >= 10) fail(400, 'Хамгийн ихдээ 10 менежер нэмнэ.');
        me.managers = (me.managers || []).concat({ id: id(), name, phone, email, addedAt: nowLocal() });
        return ok({ user: publicUser(me) });
      }
      case '/api/managers/remove': me.managers = (me.managers || []).filter(m => m.id !== b.id); return ok({ user: publicUser(me) });
      case '/api/notifications': {
        const mine = d.notes.filter(n => n.email === me.email).slice(0, 50);
        return { notifications: clone(mine), unread: mine.filter(n => !n.read).length };
      }
      case '/api/notifications/read': d.notes.forEach(n => { if (n.email === me.email) n.read = true; }); return ok({ ok: true });
      case '/api/chats': {
        const list = [];
        let unread = 0;
        for (const c of userChats(me.email)) {
          if (c.owner === me.email) { list.push(clone(c)); if (!c.muted) unread += c.unread || 0; }
          else if (me.role === 'admin' && c.kind === 'support' && c.messages.some(m => m.from === 'out')) { const v = inboxView(c); list.push(v); unread += v.unread; }
        }
        return ok({ chats: list, unread });
      }
    }

    if (path.startsWith('/api/chats/')) {
      const c = userChats(me.email).find(x => x.id === b.id && (x.owner === me.email || (me.role === 'admin' && x.kind === 'support')));
      if (!c) fail(404, 'Чат олдсонгүй.');
      const inbox = c.owner !== me.email;
      const text = trimmed(b.text).slice(0, 2000);
      const action = path.slice('/api/chats/'.length);
      if (action === 'send') {
        if (!text) fail(400, 'Мессеж хоосон байна.');
        if (inbox) {
          c.messages.push(msg('in', text)); c.unread = (c.unread || 0) + 1;
          note(c.owner, 'Тусламжийн баг хариу өглөө', text.slice(0, 80), 'info', 'messages.html#support');
        } else {
          const first = c.kind === 'support' && !c.messages.some(m => m.from === 'out');
          c.messages.push(msg('out', text));
          if (c.kind === 'support') {
            if (first) c.messages.push(msg('in', 'Баярлалаа! Таны хүсэлтийг хүлээн авлаа. Манай ажилтан удахгүй хариу өгнө.'));
            c.staffUnread = (c.staffUnread || 0) + 1;
            d.users.filter(x => x.role === 'admin' && x.email !== me.email).forEach(a => note(a.email, `Шинэ хүсэлт: ${me.name}`, text.slice(0, 80), 'info', 'messages.html#' + c.id));
          }
        }
      } else if (action === 'read') { if (inbox) c.staffUnread = 0; else c.unread = 0; }
      else if (action === 'mute') { if (inbox) fail(403, 'Хэрэглэгчийн чатад зөвшөөрөхгүй.'); c.muted = !!b.muted; }
      else if (action === 'clear') { if (inbox) fail(403, 'Хэрэглэгчийн чатыг устгах боломжгүй.'); c.messages = []; c.unread = 0; }
      else fail(404, 'Not found');
      return ok({ chat: inbox ? inboxView(c) : clone(c) });
    }
    fail(404, 'Not found');
  }

  // small banner so testers know data stays in their browser
  if (enabled) document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('div');
    tag.className = 'demo-tag';
    tag.innerHTML = 'Туршилтын хувилбар · мэдээлэл зөвхөн таны хөтөч дээр хадгалагдана · <button type="button">Шинэчлэх</button>';
    tag.querySelector('button').addEventListener('click', () => {
      const b = tag.querySelector('button');
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Бүх туршилтын мэдээллийг устгах уу? Дахин дарна уу'; return; }
      try { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch { }
      location.href = 'login.html';
    });
    document.body.appendChild(tag);
  });

  return { enabled, handle };
})();
