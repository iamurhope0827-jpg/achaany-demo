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
  // simulated drivers for orders an admin moves to "in transit" by hand
  const DRIVERS = [{ name: 'Бат-Эрдэнэ', phone: '88112233' }, { name: 'Мөнхбат', phone: '99445566' }, { name: 'Ганзориг', phone: '95112244' }, { name: 'Түмэнбаяр', phone: '80223344' }];
  // driver accounts, as in server.ps1: dedicated drivers are assigned orders in their district,
  // crowd drivers take them from the open board; pay = base fee + share of the price + bonuses
  const DRIVER_KINDS = { dedicated: 'Үндсэн жолооч', crowd: 'Чөлөөт жолооч' };
  const DISTRICTS = ['Баянгол', 'Баянзүрх', 'Сонгинохайрхан', 'Сүхбаатар', 'Хан-Уул', 'Чингэлтэй', 'Налайх', 'Багануур', 'Багахангай'];
  const VEHICLES = ['Мопед', 'Суудлын автомашин', 'Портер'];
  const PAY = { base: { dedicated: 3000, crowd: 2000 }, rate: 0.55, urgent: 2000, streakEvery: 5, streak: 5000 };
  const MAX_ACTIVE = 4;
  // what a delivery costs, as in server.ps1 ($Fare)
  const FARE = {
    perKm: 2000, call: 5000, round: 500, boosts: [2500, 5000, 7500],
    weight: [{ upTo: 10, fee: 0 }, { upTo: 30, fee: 1500 }, { upTo: 100, fee: 4000 }, { upTo: 1000000, fee: 8000 }],
    size: { small: { label: 'Жижиг', hint: 'Бичиг баримт, жижиг илгээмж', fee: 0 }, medium: { label: 'Дунд', hint: 'Хайрцаг, цүнх', fee: 2000 }, large: { label: 'Том', hint: 'Тавилга, гэр ахуйн техник', fee: 5000 } },
  };
  function fareFor(km, weight, size) {
    const w = FARE.weight.find(t => weight <= t.upTo).fee + FARE.size[size].fee;
    const distance = Math.round(km * FARE.perKm / 100) * 100;
    return { km, perKm: FARE.perKm, distance, call: FARE.call, weight: w, system: distance + FARE.call + w, extra: 0 };
  }
  function kmBetween(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  }
  const DRIVER_FIELDS = ['driver', 'driverName', 'driverPhone', 'driverKind', 'driverVehicle', 'stage', 'stageAt', 'assignedBy', 'pay'];

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
    driverKind: u.driverKind || '', zone: u.zone || '', vehicle: u.vehicle || '', online: !!u.online, locationConsent: u.locationConsent || '',
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
  // ---------- drivers & dispatch ----------
  const district = addr => DISTRICTS.find(x => String(addr || '').includes(x)) || '';
  const fits = (drv, o) => { const want = (o.needs || []).filter(n => VEHICLES.includes(n)); return !want.length || want.includes(drv.vehicle); };
  function payQuote(o, kind) {
    const base = PAY.base[kind] || PAY.base.crowd, commission = Math.round((o.price || 0) * PAY.rate / 100) * 100, bonus = o.urgent ? PAY.urgent : 0;
    return { base, commission, bonus, streak: 0, total: base + commission + bonus };
  }
  // a map point [lat, lng] from the browser; anything outside Mongolia is dropped
  const latLng = v => (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && isFinite(n)) && v[0] >= 41 && v[0] <= 52.5 && v[1] >= 87 && v[1] <= 120
    ? [+v[0].toFixed(6), +v[1].toFixed(6)] : null);
  const activeCount = email => load().orders.filter(o => o.driver === email && o.status === 'transit').length;
  const clearDriver = o => DRIVER_FIELDS.forEach(k => delete o[k]);
  // one chat per order between customer and driver, stored from the customer's side ('in' = driver)
  function addRealChat(o, drv) {
    const d = load();
    if (d.chats.some(c => c.orderNo === o.no && c.driver === drv.email)) return;
    d.chats.push({ id: 'drv-' + id(), owner: o.owner, kind: 'driver', driver: drv.email, name: drv.name, sub: `${DRIVER_KINDS[drv.driverKind]} · ${drv.vehicle}`,
      phone: drv.phone, orderNo: o.no, orderTitle: o.title, online: true, muted: false, unread: 0, driverUnread: 0, messages: [] });
  }
  function driverChatView(c) {
    const u = findUser(c.owner);
    return Object.assign(clone(c), { inbox: true, name: u ? u.name : c.owner, sub: 'Захиалагч · № ' + c.orderNo, phone: (u && u.phone) || '', online: false, muted: false, unread: c.driverUnread || 0 });
  }
  function setDriver(o, drv, how) {
    Object.assign(o, { status: 'transit', driver: drv.email, driverName: drv.name, driverPhone: drv.phone, driverKind: drv.driverKind, driverVehicle: drv.vehicle,
      stage: 'assigned', stageAt: nowIso(), assignedBy: how, pay: payQuote(o, drv.driverKind) });
    if ((o.offers || 0) < 1) o.offers = 1;
    addHistory(o, 'transit', how === 'auto' ? `Систем жолооч оноолоо: ${drv.name}` : `Жолооч захиалгыг авлаа: ${drv.name}`);
    addRealChat(o, drv);
    note(o.owner, `Жолооч олдлоо: ${drv.name}`, `№ ${o.no} · ${o.title} — чатаар холбогдоорой.`, 'ok', 'orders.html');
    note(drv.email, how === 'auto' ? 'Танд захиалга оноогдлоо' : 'Захиалга авлаа', `№ ${o.no} · ${o.from} → ${o.to}`, 'info', 'driver.html');
  }
  // waiting orders go to online dedicated drivers of the pickup district, fewest orders first
  function dispatch() {
    const d = load();
    const pool = d.users.filter(u => u.role === 'driver' && u.driverKind === 'dedicated' && u.online);
    if (!pool.length) return;
    d.orders.filter(o => o.status === 'waiting' && !o.driver).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).forEach(o => {
      const zone = district(o.from);
      const best = pool.filter(u => u.zone === zone && u.email !== o.owner && !(o.declinedBy || []).includes(u.email) && fits(u, o))
        .map(u => ({ u, load: activeCount(u.email), r: Math.random() })).filter(x => x.load < MAX_ACTIVE)
        .sort((a, b) => a.load - b.load || a.r - b.r)[0];
      if (best) setDriver(o, best.u, 'auto');
    });
  }
  function completeDelivery(o, drv) {
    const today = nowLocal().slice(0, 10);
    const nth = load().orders.filter(x => x.driver === drv.email && x.status === 'done' && String(x.deliveredAt || '').startsWith(today)).length + 1;
    const q = payQuote(o, drv.driverKind);
    if (nth % PAY.streakEvery === 0) { q.streak = PAY.streak; q.total += PAY.streak; }
    Object.assign(o, { status: 'done', done: o.total, stage: 'delivered', pay: q, deliveredAt: nowLocal() });
    addHistory(o, 'done', 'Хүргэгдсэн');
    drv.wallet = (drv.wallet || 0) + q.total;
    addTx(drv.email, 'earning', `Хүргэлт № ${o.no}`, q.total, 'Хүргэлтийн орлого', drv.wallet);
    note(o.owner, 'Ачаа хүргэгдлээ', `№ ${o.no} · ${o.title}`, 'ok', 'orders.html');
    if (q.streak) note(drv.email, `Урамшуулал +${q.streak.toLocaleString('en-US')}₮`, `Өнөөдрийн ${nth} дэх хүргэлт.`, 'ok', 'driver.html');
  }
  function paySum(list) {
    return list.reduce((t, x) => ({ count: t.count + 1, total: t.total + x.pay.total, base: t.base + x.pay.base, commission: t.commission + x.pay.commission, bonus: t.bonus + x.pay.bonus + (x.pay.streak || 0) }),
      { count: 0, total: 0, base: 0, commission: 0, bonus: 0 });
  }
  function driverSummary(me) {
    const d = load();
    const mine = d.orders.filter(o => o.driver === me.email);
    const active = mine.filter(o => o.status === 'transit').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map(o => {
      const c = findUser(o.owner);
      return { no: o.no, title: o.title, from: o.from, to: o.to, needs: o.needs || [], urgent: !!o.urgent, weight: o.weight, price: o.price, note: o.note, pickupDate: o.pickupDate,
        stage: o.stage, stageAt: o.stageAt, assignedBy: o.assignedBy, pay: o.pay, customer: o.creator, customerPhone: (c && c.phone) || '', fromLL: o.fromLL, toLL: o.toLL };
    });
    const done = mine.filter(o => o.status === 'done').sort((a, b) => (String(a.deliveredAt) < String(b.deliveredAt) ? 1 : -1));
    const today = nowLocal().slice(0, 10);
    const ws = new Date(); ws.setDate(ws.getDate() - 6); const weekStart = nowLocal(ws).slice(0, 10);
    const day = o => String(o.deliveredAt || '').slice(0, 10);
    let board = [];
    if (me.driverKind === 'crowd') {
      const route = new Set(active.flatMap(o => [district(o.from), district(o.to)]).filter(Boolean));
      board = d.orders.filter(o => o.status === 'waiting' && !o.driver && o.owner !== me.email).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 30).map(o => {
        const z = district(o.from);
        return { no: o.no, title: o.title, from: o.from, to: o.to, needs: o.needs || [], urgent: !!o.urgent, weight: o.weight, price: o.price, date: o.date, pickupDate: o.pickupDate,
          zone: z, onTheWay: !!z && route.has(z), fits: fits(me, o), pay: payQuote(o, 'crowd'), fromLL: o.fromLL, toLL: o.toLL };
      });
    }
    const todays = done.filter(o => day(o) === today);
    return clone({
      driver: { kind: me.driverKind || '', kindLabel: DRIVER_KINDS[me.driverKind] || '', zone: me.zone || '', vehicle: me.vehicle || '', online: !!me.online },
      active, board,
      recent: done.slice(0, 20).map(o => ({ no: o.no, title: o.title, from: o.from, to: o.to, deliveredAt: o.deliveredAt, pay: o.pay })),
      today: paySum(todays), week: paySum(done.filter(o => day(o) >= weekStart)), todayCount: todays.length,
      days: [6, 5, 4, 3, 2, 1, 0].map(n => { const t = new Date(); t.setDate(t.getDate() - n); const date = nowLocal(t).slice(0, 10); return { date, total: paySum(done.filter(o => day(o) === date)).total }; }),
      zoneQueue: d.orders.filter(o => o.status === 'waiting' && !o.driver && district(o.from) === me.zone).length,
      rules: { base: PAY.base, rate: PAY.rate, urgent: PAY.urgent, streakEvery: PAY.streakEvery, streak: PAY.streak, maxActive: MAX_ACTIVE },
      districts: DISTRICTS, vehicles: VEHICLES,
    });
  }
  function checkDriverFields(kind, zone, vehicle) {
    if (!DRIVER_KINDS[kind]) fail(400, 'Жолоочийн төрлөө сонгоно уу.', 'kind');
    if (!DISTRICTS.includes(zone)) fail(400, 'Ажиллах дүүргээ сонгоно уу.', 'zone');
    if (!VEHICLES.includes(vehicle)) fail(400, 'Тээврийн хэрэгслээ сонгоно уу.', 'vehicle');
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
      if (!d.users.some(u => u.username === 'admin123')) await seedAdmin(d);
      // two test drivers, one of each kind (jolooch1 / jolooch2, password driver123)
      for (const t of [{ username: 'jolooch1', name: 'Бат-Эрдэнэ', phone: '88112233', driverKind: 'dedicated', zone: 'Сүхбаатар', vehicle: 'Мопед' },
        { username: 'jolooch2', name: 'Мөнхбат', phone: '99445566', driverKind: 'crowd', zone: 'Баянгол', vehicle: 'Суудлын автомашин' }]) {
        if (d.users.some(u => u.username === t.username)) continue;
        const salt = id();
        d.users.push(Object.assign({ id: id(), email: t.username + '@achaanytuv.local', type: 'Хувь хүн', role: 'driver', status: 'active', regNo: '',
          partnerCode: 'PR' + rnd(10000, 99999), sector: 'Бусад', vatPayer: false, regVerified: false, plan: '', planUntil: '', wallet: 0, managers: [], usedCoupons: [],
          createdAt: nowIso(), lastLogin: '', online: true, salt, hash: await hash('driver123', salt) }, t));
      }
      dispatch();
      save();
    })();
    return seeded;
  }
  async function seedAdmin(d) {
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
      const drv = b.driver;
      const phone = drv ? trimmed(b.phone).replace(/\s/g, '') : '';
      if (drv) {
        if (!/^\d{8}$/.test(phone)) fail(400, 'Утасны дугаар 8 оронтой байна.', 'phone');
        checkDriverFields(drv.kind, drv.zone, drv.vehicle);
        if (drv.consent !== true) fail(400, 'Байршил хуваалцах нөхцөлийг зөвшөөрнө үү.', 'consent');
      }
      if (findUser(email)) fail(409, 'Энэ имэйлээр бүртгэл аль хэдийн үүссэн байна.', 'email');
      const salt = id();
      const u = { id: id(), name, email, type: !drv && ['Хувь хүн', 'Байгууллага'].includes(b.type) ? b.type : 'Хувь хүн', role: drv ? 'driver' : 'user', status: 'active',
        phone, regNo: '', partnerCode: 'PR' + rnd(10000, 99999), sector: 'Бусад', vatPayer: false, regVerified: false, plan: '', planUntil: '',
        wallet: 0, managers: [], usedCoupons: [], createdAt: nowIso(), lastLogin: nowIso(), salt, hash: await hash(password, salt) };
      if (drv) Object.assign(u, { driverKind: drv.kind, zone: drv.zone, vehicle: drv.vehicle, online: false, locationConsent: nowIso() });
      d.users.push(u);
      if (drv) note(email, 'Тавтай морил!', 'Жолоочийн бүртгэл үүслээ. Онлайн болоод захиалга авч эхлээрэй.', 'ok', 'driver.html');
      else note(email, 'Тавтай морил!', 'Бүртгэл амжилттай үүслээ. Анхны ачаагаа бүртгээд эхлээрэй.', 'ok', 'new-order.html');
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

    // demo only: ?demo&as=admin123 signs that test user in (used by screenshot tools)
    const autoAs = params.get('as');
    if (autoAs && !session.get()) {
      const a = d.users.find(x => x.username === autoAs || x.email === autoAs);
      if (a) session.set(a.email, false);
    }

    // signed-in
    const me = findUser(session.get());
    if (!me) fail(401, 'Нэвтрээгүй байна.');
    const ok = r => { save(); return r; };

    switch (path) {
      case '/api/me': return { user: publicUser(me) };
      case '/api/pricing': return { fare: clone(FARE) };
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
        if (method === 'GET') {
          // while an order is on the road the customer follows its driver's shared position
          const list = clone(d.orders.filter(o => o.owner === me.email).sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1)));
          list.forEach(o => { const drv = o.status === 'transit' && o.driver && findUser(o.driver); if (drv && drv.pos && Date.now() - drv.pos.at < 180000) o.driverPos = drv.pos; });
          return { orders: list };
        }
        const title = trimmed(b.title), from = trimmed(b.from), to = trimmed(b.to), price = Number(b.price) || 0;
        if (b.type !== 'delivery') fail(400, 'Тээврийн төрөл буруу байна.', 'type');
        if (title.length < 2) fail(400, 'Ачааны нэрээ оруулна уу.', 'title');
        if (from.length < 3) fail(400, 'Ачаа авах хаягаа оруулна уу.', 'from');
        if (to.length < 3) fail(400, 'Хүргэх хаягаа оруулна уу.', 'to');
        if (price < 1000 || price > 1e8) fail(400, 'Үнэ 1,000₮-өөс их байна.', 'price');
        const size = FARE.size[b.size] ? b.size : 'small';
        const fromLL = latLng(b.fromLL), toLL = latLng(b.toLL);
        let fare = null;
        if (fromLL && toLL) {
          // the road distance from the browser, kept between the straight line and three times it
          const straight = kmBetween(fromLL, toLL);
          let km = Number(b.km) || 0;
          if (km < straight - 0.05 || km > straight * 3 + 1) km = straight * 1.3;
          fare = fareFor(Math.round(km * 10) / 10, Number(b.weight) || 0, size);
          if (price < fare.system) fail(400, `Үнэ системийн тооцоолсон ${fare.system.toLocaleString('en-US')}₮-өөс бага байж болохгүй.`, 'price');
          fare.extra = price - fare.system;
        }
        const o = { no: newOrderNo(), type: 'delivery', owner: me.email, title, from, to, needs: (b.needs || []).map(trimmed).filter(Boolean).slice(0, 8),
          urgent: !!b.urgent, weight: Number(b.weight) || 0, price, note: trimmed(b.note), pickupDate: trimmed(b.pickupDate), fromLL, toLL, size, fare, status: 'waiting',
          views: 0, offers: 0, done: 0, total: 1, creator: me.name, date: nowLocal(), createdAt: nowIso(), history: [] };
        addHistory(o, 'waiting', 'Захиалга үүслээ');
        d.orders.push(o);
        note(me.email, 'Шинэ захиалга үүслээ', `№ ${o.no} · ${title} — жолоочдын санал удахгүй ирнэ.`, 'info', 'orders.html');
        dispatch();
        return ok({ order: clone(o) });
      }
      case '/api/orders/action': {
        const o = d.orders.find(x => x.no === b.no && x.owner === me.email);
        if (!o) fail(404, 'Захиалга олдсонгүй.');
        if (b.action === 'cancel') {
          if (!['waiting', 'transit'].includes(o.status)) fail(400, 'Энэ захиалгыг цуцлах боломжгүй.');
          o.status = 'cancelled'; addHistory(o, 'cancelled', 'Хэрэглэгч цуцалсан');
          if (o.driver) note(o.driver, 'Захиалга цуцлагдлаа', `№ ${o.no} · ${o.title} — захиалагч цуцалсан.`, 'alert', 'driver.html');
        } else if (b.action === 'restore') {
          if (o.status !== 'cancelled') fail(400, 'Зөвхөн цуцлагдсан захиалгыг сэргээнэ.');
          o.status = 'waiting'; clearDriver(o); addHistory(o, 'waiting', 'Захиалга сэргээгдсэн');
          dispatch();
        } else if (b.action === 'status') {
          if (me.role !== 'admin') fail(403, 'Зөвхөн админ төлөв өөрчилнө.');
          if (!STATUS_TEXT[b.status]) fail(400, 'Төлөв буруу байна.');
          o.status = b.status;
          if (b.status === 'transit' && o.offers < 1) o.offers = 1;
          if (b.status === 'done') o.done = o.total;
          addHistory(o, b.status, STATUS_TEXT[b.status]);
          if (b.status === 'transit' && !o.driver) addDriverChat(me.email, o);
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
          else if (c.driver && c.driver === me.email) { const v = driverChatView(c); list.push(v); unread += v.unread; }
          else if (me.role === 'admin' && c.kind === 'support' && c.messages.some(m => m.from === 'out')) { const v = inboxView(c); list.push(v); unread += v.unread; }
        }
        return ok({ chats: list, unread });
      }
    }

    if (path.startsWith('/api/chats/')) {
      const c = userChats(me.email).find(x => x.id === b.id && (x.owner === me.email || (x.driver && x.driver === me.email) || (me.role === 'admin' && x.kind === 'support')));
      if (!c) fail(404, 'Чат олдсонгүй.');
      const inbox = c.owner !== me.email;
      const asDriver = inbox && c.driver === me.email;
      const text = trimmed(b.text).slice(0, 2000);
      const action = path.slice('/api/chats/'.length);
      if (action === 'send') {
        if (!text) fail(400, 'Мессеж хоосон байна.');
        if (asDriver) {
          c.messages.push(msg('in', text)); c.unread = (c.unread || 0) + 1;
          note(c.owner, `Жолооч ${me.name}`, text.slice(0, 80), 'info', 'messages.html#' + c.id);
        } else if (inbox) {
          c.messages.push(msg('in', text)); c.unread = (c.unread || 0) + 1;
          note(c.owner, 'Тусламжийн баг хариу өглөө', text.slice(0, 80), 'info', 'messages.html#support');
        } else {
          const first = c.kind === 'support' && !c.messages.some(m => m.from === 'out');
          c.messages.push(msg('out', text));
          if (c.kind === 'support') {
            if (first) c.messages.push(msg('in', 'Баярлалаа! Таны хүсэлтийг хүлээн авлаа. Манай ажилтан удахгүй хариу өгнө.'));
            c.staffUnread = (c.staffUnread || 0) + 1;
            d.users.filter(x => x.role === 'admin' && x.email !== me.email).forEach(a => note(a.email, `Шинэ хүсэлт: ${me.name}`, text.slice(0, 80), 'info', 'messages.html#' + c.id));
          } else if (c.driver) {
            c.driverUnread = (c.driverUnread || 0) + 1;
            note(c.driver, `Захиалагч ${me.name}`, text.slice(0, 80), 'info', 'messages.html#' + c.id);
          }
        }
      } else if (action === 'read') { if (asDriver) c.driverUnread = 0; else if (inbox) c.staffUnread = 0; else c.unread = 0; }
      else if (action === 'mute') { if (inbox) fail(403, 'Хэрэглэгчийн чатад зөвшөөрөхгүй.'); c.muted = !!b.muted; }
      else if (action === 'clear') { if (inbox) fail(403, 'Хэрэглэгчийн чатыг устгах боломжгүй.'); c.messages = []; c.unread = 0; }
      else fail(404, 'Not found');
      return ok({ chat: asDriver ? driverChatView(c) : inbox ? inboxView(c) : clone(c) });
    }

    if (path === '/api/driver' || path.startsWith('/api/driver/')) {
      if (me.role !== 'driver') fail(403, 'Энэ хэсэг зөвхөн жолоочид.');
      if (path === '/api/driver/consent') {
        me.locationConsent = b.accept === true ? nowIso() : '';
        if (!me.locationConsent) delete me.pos;
        return ok({ user: publicUser(me) });
      }
      if (path === '/api/driver/location') {
        if (!me.locationConsent) fail(403, 'Байршил хуваалцах зөвшөөрөл өгөөгүй байна.', 'consent');
        const ll = latLng([Number(b.lat), Number(b.lng)]);
        if (!ll) fail(400, 'Байршил буруу байна.');
        me.pos = { lat: ll[0], lng: ll[1], at: Date.now() };
        return ok({ ok: true });
      }
      if (method === 'POST') {
        const o = b.no ? d.orders.find(x => x.no === b.no) : null;
        const mineActive = o && o.driver === me.email && o.status === 'transit';
        switch (path) {
          case '/api/driver/online': me.online = !!b.online; if (me.online) dispatch(); break;
          case '/api/driver/profile':
            checkDriverFields(b.kind, b.zone, b.vehicle);
            Object.assign(me, { driverKind: b.kind, zone: b.zone, vehicle: b.vehicle });
            dispatch();
            break;
          case '/api/driver/take':
            if (me.driverKind !== 'crowd') fail(400, 'Үндсэн жолоочид захиалга автоматаар оноогдоно.');
            if (!me.online) fail(400, 'Захиалга авахын тулд эхлээд онлайн болно уу.');
            if (!o || o.status !== 'waiting' || o.driver) fail(409, 'Энэ захиалгыг өөр жолооч авсан эсвэл цуцлагдсан байна.');
            if (o.owner === me.email) fail(400, 'Өөрийн захиалгыг авах боломжгүй.');
            if (activeCount(me.email) >= MAX_ACTIVE) fail(400, `Нэг дор хамгийн ихдээ ${MAX_ACTIVE} ачаа авна. Эхлээд хүргэлтээ дуусгана уу.`);
            if (!fits(me, o)) fail(400, 'Энэ захиалгад өөр төрлийн тээврийн хэрэгсэл хэрэгтэй.');
            setDriver(o, me, 'grab');
            break;
          case '/api/driver/advance':
            if (!mineActive) fail(404, 'Идэвхтэй захиалга олдсонгүй.');
            if (o.stage === 'assigned') {
              o.stage = 'picked'; o.stageAt = nowIso(); addHistory(o, 'transit', 'Жолооч ачааг авлаа');
              note(o.owner, 'Ачаа замдаа гарлаа', `№ ${o.no} · ${o.title} — ${me.name} хүргэхээр явж байна.`, 'info', 'orders.html');
            } else completeDelivery(o, me);
            break;
          case '/api/driver/release':
            if (!mineActive) fail(404, 'Идэвхтэй захиалга олдсонгүй.');
            if (o.stage !== 'assigned') fail(400, 'Ачааг авсны дараа буцаах боломжгүй. Тусламжийн багтай холбогдоно уу.');
            o.declinedBy = (o.declinedBy || []).concat(me.email);
            clearDriver(o); o.status = 'waiting';
            addHistory(o, 'waiting', 'Жолооч татгалзсан — дахин хуваарилж байна');
            note(o.owner, 'Жолооч солигдоно', `№ ${o.no} · ${o.title} — шинэ жолооч хайж байна.`, 'info', 'orders.html');
            dispatch();
            break;
          default: fail(404, 'Not found');
        }
        save();
      }
      return driverSummary(me);
    }
    fail(404, 'Not found');
  }

  return { enabled, handle };
})();
