// Log22 Жолооч — driver app: go online, follow the planned stops, take orders, see earnings.
(() => {
  const { esc, money, initials, $, icons: I, api } = Core;
  const KIND = { dedicated: 'Үндсэн жолооч', crowd: 'Чөлөөт жолооч' };
  const DISTRICTS = ['Баянгол', 'Баянзүрх', 'Сонгинохайрхан', 'Сүхбаатар', 'Хан-Уул', 'Чингэлтэй', 'Налайх', 'Багануур', 'Багахангай'];
  const VEHICLES = ['Мопед', 'Суудлын автомашин', 'Портер'];
  const killMap = el => { el && el.querySelectorAll('.om').forEach(m => { if (m._om) { m._om.remove(); m._om = null; } }); };
  const mins = m => Math.max(1, Math.round(m));

  // ---------- one source of truth: /api/driver, refreshed every 8 s ----------
  let data = null, listeners = new Set(), poller = null, lastActive = 0;
  async function refresh(body, path = '/api/driver') {
    const before = data ? data.active.length : lastActive;
    data = await api(path, body);
    if (!body && data.active.length > before) { Core.toast('Танд шинэ захиалга оноогдлоо'); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
    lastActive = data.active.length;
    listeners.forEach(fn => { try { fn(data); } catch { } });
    gps(data.driver.online && !!(Core.user() || {}).locationConsent);
    return data;
  }
  const subscribe = fn => { listeners.add(fn); if (data) fn(data); return () => listeners.delete(fn); };
  function startPolling() { if (poller) return; refresh().catch(() => { }); poller = setInterval(() => { if (!document.hidden) refresh().catch(() => { }); }, 8000); }
  function stopPolling() { clearInterval(poller); poller = null; data = null; gps(false); }
  async function act(path, body, okMsg) {
    try { await refresh(body, path); if (okMsg) Core.toast(okMsg); return true; } catch (e) { Core.toast(e.message, 'error'); return false; }
  }

  // ---------- location: background on the phone, the page's own while testing in a browser ----------
  // native plugins: the bridge exposes them on Capacitor.Plugins (the app ships without @capacitor/core's registerPlugin).
  // A missing plugin only switches that feature off; it must never stop the app from starting.
  const plugin = name => {
    if (!Core.native) return null;
    try { return (Capacitor.Plugins && Capacitor.Plugins[name]) || (typeof Capacitor.registerPlugin === 'function' ? Capacitor.registerPlugin(name) : null); } catch { return null; }
  };
  const BgGeo = plugin('BackgroundGeolocation');
  const Awake = plugin('KeepAwake');
  const Notes = plugin('LocalNotifications');
  let myPos = null, gpsState = 'off', watchId = null, bgId = null, starting = false, lastSent = 0;
  const posListeners = new Set();
  function onFix(lat, lng) {
    myPos = [lat, lng]; gpsState = 'on';
    if (Date.now() - lastSent > 15000) { lastSent = Date.now(); api('/api/driver/location', { lat, lng }).catch(() => { }); }
    posListeners.forEach(fn => fn(myPos));
  }
  async function gps(on) {
    if (BgGeo) {
      if (!on) { if (bgId) { BgGeo.removeWatcher({ id: bgId }).catch(() => { }); bgId = null; Awake.allowSleep().catch(() => { }); } if (gpsState === 'on') gpsState = 'off'; return; }
      if (bgId || starting || gpsState === 'denied') return;
      starting = true;
      try {
        try { await Notes.requestPermissions(); } catch { }   // Android 13+: the "location in use" notification
        bgId = await BgGeo.addWatcher({ backgroundTitle: 'Log22 — онлайн', backgroundMessage: 'Захиалга хүргэж байх үед таны байршлыг хуваалцаж байна.', requestPermissions: true, stale: false, distanceFilter: 15 },
          (loc, err) => { if (err) { if (err.code === 'NOT_AUTHORIZED') { gpsState = 'denied'; bgId = null; } return; } if (loc) onFix(loc.latitude, loc.longitude); });
        Awake.keepAwake().catch(() => { });
      } catch { gpsState = 'denied'; } finally { starting = false; }
      return;
    }
    if (!on) { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; return; }
    if (watchId !== null || gpsState === 'denied' || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(p => onFix(p.coords.latitude, p.coords.longitude), () => { gpsState = 'denied'; watchId = null; }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  // ---------- sign in / register ----------
  Core.define('login', {
    label: 'Нэвтрэх',
    render(el) {
      el.classList.add('auth-screen');
      el.innerHTML = `<div class="scroll"><div class="auth-hero"><div class="brand-mark">${I.wheel}</div><h1>Log22 Жолооч</h1><p>Онлайн болоод захиалга авч, орлогоо хянаарай.</p></div>
        <form class="auth-form" novalidate><div class="form-error" role="alert"></div>
          <div class="field" data-field="email"><label for="f-email">Имэйл эсвэл нэвтрэх нэр</label><div class="input"><input id="f-email" autocapitalize="off" autocomplete="username" /></div><span class="err"></span></div>
          <div class="field" data-field="password"><label for="f-pass">Нууц үг</label><div class="input"><input id="f-pass" type="password" autocomplete="current-password" /></div><span class="err"></span></div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Нэвтрэх</button></form>
        <p class="auth-alt">Жолоочоор бүртгүүлэх үү? <button type="button" data-reg>Бүртгүүлэх</button><br><button type="button" data-server class="sm">Сервер</button></p></div>`;
      $(el, '[data-reg]').addEventListener('click', () => Core.push('register'));
      $(el, '[data-server]').addEventListener('click', () => Core.serverSheet());
      const form = $(el, 'form');
      form.addEventListener('input', () => { $(form, '.form-error').textContent = ''; });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = $(form, 'button[type="submit"]'), id = $(form, '#f-email').value.trim(), pw = $(form, '#f-pass').value;
        if (!id || !pw) { $(form, '.form-error').textContent = 'Нэвтрэх нэр, нууц үгээ оруулна уу.'; return; }
        Core.busy(btn, true, 'Нэвтэрч байна…');
        try {
          const u = await Core.login(id, pw);
          if (u.role !== 'driver') { await Core.logout(); throw new Error('Энэ бол захиалагчийн бүртгэл. "Log22" аппаар нэвтэрнэ үү.'); }
          startPolling(); Core.tab('duty');
        } catch (err) { $(form, '.form-error').textContent = err.message; } finally { Core.busy(btn, false); }
      });
    },
  });
  Core.define('register', {
    label: 'Бүртгүүлэх',
    render(el) {
      let kind = 'dedicated', consent = false;
      el.innerHTML = `<header class="appbar small"><button class="icon-btn" data-back aria-label="Буцах">${I.back}</button><h1>Жолоочоор бүртгүүлэх</h1></header>
        <div class="scroll"><form class="auth-form" style="padding-top:8px" novalidate><div class="form-error" role="alert"></div>
          <div class="field" data-field="name"><label for="r-name">Овог нэр</label><div class="input"><input id="r-name" autocomplete="name" /></div><span class="err"></span></div>
          <div class="field" data-field="phone"><label for="r-phone">Утас</label><div class="input">${I.phone}<input id="r-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="8 оронтой" /></div><span class="err"></span></div>
          <div class="field" data-field="email"><label for="r-email">Имэйл</label><div class="input"><input id="r-email" type="email" inputmode="email" autocapitalize="off" autocomplete="email" /></div><span class="err"></span></div>
          <div class="field" data-field="password"><label for="r-pass">Нууц үг</label><div class="input"><input id="r-pass" type="password" autocomplete="new-password" placeholder="Хамгийн багадаа 8 тэмдэгт" /></div><span class="err"></span></div>
          <div class="field"><label>Жолоочийн төрөл</label><div class="kind-pick" data-kinds>
            <button type="button" data-kind="dedicated" aria-pressed="true"><b>Үндсэн жолооч</b><small>Нэг дүүрэгт ажиллана, систем захиалга онооно</small></button>
            <button type="button" data-kind="crowd" aria-pressed="false"><b>Чөлөөт жолооч</b><small>Цагаа өөрөө сонгож, самбараас захиалга авна</small></button></div></div>
          <div class="field"><label for="r-zone">Ажиллах дүүрэг</label><div class="input"><select id="r-zone">${DISTRICTS.map(d => `<option${d === 'Сүхбаатар' ? ' selected' : ''}>${d}</option>`).join('')}</select>${I.chevron}</div></div>
          <div class="field"><label for="r-veh">Тээврийн хэрэгсэл</label><div class="input"><select id="r-veh">${VEHICLES.map(v => `<option>${v}</option>`).join('')}</select>${I.chevron}</div></div>
          <div class="field" data-field="consent"><button type="button" class="check-row" data-consent role="checkbox" aria-checked="false"><span class="box">${I.check}</span><span>Онлайн байх үедээ байршлаа хуваалцахыг зөвшөөрч байна. Байршил зөвхөн миний авсан захиалгын захиалагчид харагдана; замыг тооцохдоо цэгүүдийг газрын зургийн үйлчилгээ (Mapbox, АНУ) руу илгээнэ.</span></button><span class="err"></span></div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Бүртгүүлэх</button></form></div>`;
      $(el, '[data-back]').addEventListener('click', () => Core.pop());
      $(el, '[data-kinds]').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b) return; kind = b.dataset.kind; el.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
      $(el, '[data-consent]').addEventListener('click', e => { consent = !consent; e.currentTarget.setAttribute('aria-checked', String(consent)); Core.fieldError(form, 'consent', ''); });
      const form = $(el, 'form');
      form.addEventListener('input', e => { const f = e.target.closest('[data-field]'); if (f) Core.fieldError(form, f.dataset.field, ''); });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = id => $(form, id).value.trim();
        let bad = false;
        if (v('#r-name').length < 2) bad = Core.fieldError(form, 'name', 'Нэрээ оруулна уу.');
        if (!/^\d{8}$/.test(v('#r-phone').replace(/\s/g, ''))) bad = Core.fieldError(form, 'phone', 'Утасны дугаар 8 оронтой байна.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('#r-email'))) bad = Core.fieldError(form, 'email', 'Имэйлээ зөв оруулна уу.');
        if ($(form, '#r-pass').value.length < 8) bad = Core.fieldError(form, 'password', 'Хамгийн багадаа 8 тэмдэгт.');
        if (!consent) bad = Core.fieldError(form, 'consent', 'Жолооч байршлаа хуваалцах шаардлагатай.');
        if (bad) return;
        const btn = $(form, 'button[type="submit"]'); Core.busy(btn, true, 'Бүртгэж байна…');
        try {
          await Core.register({ name: v('#r-name'), email: v('#r-email'), password: $(form, '#r-pass').value, type: 'Хувь хүн', phone: v('#r-phone').replace(/\s/g, ''),
            driver: { kind, zone: $(form, '#r-zone').value, vehicle: $(form, '#r-veh').value, consent: true } });
          startPolling(); Core.tab('duty'); Core.toast('Тавтай морил! Онлайн болоод захиалга аваарай.');
        } catch (err) { if (!(err.field && Core.fieldError(form, err.field, err.message))) $(form, '.form-error').textContent = err.message; Core.busy(btn, false); }
      });
    },
  });

  // ---------- home: the map and the next action ----------
  function nextStops(d) {
    const byNo = Object.fromEntries(d.active.map(o => [o.no, o]));
    if (d.plan && d.plan.stops && d.plan.stops.every(s => byNo[s.no])) return d.plan.stops.map(s => ({ ...s, o: byNo[s.no] }));
    const list = [];
    d.active.filter(o => o.stage === 'assigned').forEach(o => list.push({ kind: 'from', no: o.no, o, address: o.from }));
    d.active.forEach(o => list.push({ kind: 'to', no: o.no, o, address: o.to }));
    return list;
  }
  Core.define('duty', {
    tab: true, label: 'Самбар',
    render(el) {
      el.classList.add('duty');
      el.innerHTML = `<div class="map-box"><div class="om" data-map></div></div>
        <div class="duty-top"><button class="status-pill" data-status><i></i><span>…</span></button><span class="earn-pill">${I.coins}<span data-earn>0₮</span></span></div>
        <div class="duty-sheet"><span class="grabber" aria-hidden="true"></span><div class="sheet-scroll" data-sheet><div class="skeleton" style="height:120px"></div></div></div>`;
      let mapKey = '', mapView = null;
      // the driver's own marker follows the phone without rebuilding the map
      const onPos = p => { if (mapView && mapView.setMe) mapView.setMe(p); };
      posListeners.add(onPos);
      function draw(d) {
        const on = d.driver.online, consent = !!(Core.user() || {}).locationConsent;
        const pill = $(el, '[data-status]');
        pill.classList.toggle('on', on); $(pill, 'span').textContent = on ? 'Онлайн' : 'Офлайн';
        $(el, '[data-earn]').textContent = money(d.today.total);
        const stops = nextStops(d);
        const k = stops.map(s => s.kind + s.no).join() + '|' + on + '|' + !!myPos;
        if (k !== mapKey) { mapKey = k; killMap(el); const m = document.createElement('div'); m.className = 'om'; $(el, '.map-box').replaceChildren(m); el.classList.toggle('om-off', !on); mapView = OrderMap.stops(m, d.active, { me: myPos, plan: d.plan }); }
        const sheet = $(el, '[data-sheet]');
        if (!on) {
          sheet.innerHTML = `<div><div class="lg">Та офлайн байна</div><p class="muted" style="margin-top:4px">${d.driver.kind === 'dedicated' ? `Онлайн болмогц ${esc(d.driver.zone)} дүүргийн захиалга танд автоматаар оноогдоно.` : 'Онлайн болоод нээлттэй захиалгаас сонгож аваарай.'}</p></div>
            <button class="btn btn-online btn-block big-action" data-online>Онлайн болох</button>`;
          return;
        }
        const consentCard = consent ? '' : `<div class="consent"><b>Байршлаа хуваалцах уу?</b><p>Таны байршил зөвхөн онлайн байх үед, таны авсан захиалгын захиалагчид харагдана. Ачаа тээж яваа үеийн хурдыг замын түгжрэлийг тооцоход ашиглана.</p><button class="btn btn-primary" data-consent>Зөвшөөрөх</button></div>`;
        if (!stops.length) {
          sheet.innerHTML = `${consentCard}<div class="waiting-pulse"><i></i><div><div class="lg">Захиалга хүлээж байна</div><p class="sm muted">${d.driver.kind === 'dedicated' ? `${esc(d.driver.zone)} дүүрэгт шинэ захиалга орж ирмэгц танд оноогдоно.` : `${d.board.length} нээлттэй захиалга байна.`}</p></div></div>
            ${d.driver.kind === 'crowd' && d.board.length ? `<button class="btn btn-primary btn-block btn-lg" data-board>Нээлттэй захиалга харах (${d.board.length})</button>` : ''}
            <button class="btn btn-secondary btn-block" data-offline>Офлайн болох</button>`;
          return;
        }
        const s = stops[0], o = s.o;
        const pickup = s.kind === 'from';
        sheet.innerHTML = `${consentCard}
          <div class="next-kind"><span class="tag ${pickup ? 'accent' : 'live'}">${pickup ? 'Ачаа авах' : 'Хүргэх'} · № ${esc(o.no)}</span><span class="sm faint">${stops.length} зогсоол</span></div>
          <div class="next-addr">${esc(s.address || (pickup ? o.from : o.to))}</div>
          <div class="next-meta">${s.etaMin != null ? `<span>${I.clock}≈ ${mins(s.etaMin)} мин</span>` : ''}${pickup && s.waitMin ? `<span>Хүлээлт ≈ ${mins(s.waitMin)} мин</span>` : ''}<span>${I.box}${esc(o.title)}</span>${o.urgent ? '<span class="tag warn">Яаралтай</span>' : ''}</div>
          ${pickup && o.pickup === 'door' ? `<div class="handoff door">${I.home}<span><b>Орж авна</b><small>Захиалагчийн хаалган дээр очиж ачааг авна. Хаягийн дэлгэрэнгүйг харна уу.</small></span></div>` : ''}
          <div class="cust"><span class="avatar">${esc(initials(o.customer))}</span><span class="grow"><b>${esc(o.customer || 'Захиалагч')}</b><br><span class="sm muted">${o.note ? esc(o.note) : 'Захиалагч'}</span></span>
            ${o.customerPhone ? `<a class="round-btn" href="tel:${esc(o.customerPhone)}" aria-label="Залгах">${I.phone}</a>` : ''}<button class="round-btn" data-chat="${esc(o.no)}" aria-label="Чат">${I.chat}</button></div>
          <div class="pay-line"><span class="muted">Энэ хүргэлтийн орлого</span><b>${money(o.pay.total)}</b></div>
          <button class="btn btn-primary btn-block big-action" data-advance="${esc(o.no)}">${pickup ? 'Ачааг авлаа' : 'Хүргэлээ'}</button>
          ${pickup && o.stage === 'assigned' ? `<button class="btn btn-secondary btn-block" data-release="${esc(o.no)}">Буцаах</button>` : ''}
          ${stops.length > 1 ? `<div><div class="section-title" style="margin:0 0 4px">Дараагийн зогсоолууд${d.plan ? ` · нийт ≈ ${mins(d.plan.totalMin)} мин` : ''}</div><div class="stop-list">${stops.slice(1).map((x, i) => `<div class="stop${x.kind === 'to' ? ' drop' : ''}"><i>${i + 2}</i><span class="a"><b>${esc(x.address || (x.kind === 'from' ? x.o.from : x.o.to))}</b><small>${x.kind === 'from' ? 'Авах' : 'Хүргэх'} · № ${esc(x.no)}</small></span><span class="sm muted">${x.etaMin != null ? '≈ ' + mins(x.etaMin) + ' мин' : ''}</span></div>`).join('')}</div></div>` : ''}
          <button class="btn btn-ghost btn-block" data-offline>Офлайн болох</button>`;
      }
      el.addEventListener('click', async e => {
        const t = e.target;
        if (t.closest('[data-online]') || (t.closest('[data-status]') && data && !data.driver.online)) act('/api/driver/online', { online: true }, 'Та онлайн боллоо');
        else if (t.closest('[data-offline]') || t.closest('[data-status]')) {
          if (data && data.active.length && !(await Core.confirm({ title: 'Офлайн болох уу?', text: 'Танд хүргэгдээгүй ачаа байна. Офлайн болсон ч хүргэлтээ дуусгана уу.', ok: 'Офлайн болох' }))) return;
          act('/api/driver/online', { online: false }, 'Та офлайн боллоо');
        }
        if (t.closest('[data-consent]')) { try { const d = await api('/api/driver/consent', { accept: true }); Core.setUser(d.user); Core.toast('Байршил хуваалцаж эхэллээ'); refresh().catch(() => { }); } catch (err) { Core.toast(err.message, 'error'); } }
        if (t.closest('[data-board]')) Core.tab('board');
        const adv = t.closest('[data-advance]');
        if (adv) {
          const o = data.active.find(x => x.no === adv.dataset.advance);
          Core.busy(adv, true);
          await act('/api/driver/advance', { no: adv.dataset.advance }, o && o.stage === 'picked' ? `Хүргэгдлээ · +${money(o.pay.total)}` : 'Ачааг авлаа — хүргэлтэд гарлаа');
          if (o && o.stage === 'picked' && navigator.vibrate) navigator.vibrate(120);
        }
        const rel = t.closest('[data-release]');
        if (rel && await Core.confirm({ title: 'Захиалгыг буцаах уу?', text: 'Захиалга өөр жолоочид шилжинэ.', ok: 'Буцаах', danger: true })) act('/api/driver/release', { no: rel.dataset.release }, 'Захиалгыг буцаалаа');
        const ch = t.closest('[data-chat]');
        if (ch) { try { const c = await api('/api/chats'); const x = (c.chats || []).find(y => y.orderNo === ch.dataset.chat); if (x) Core.push('thread', { id: x.id }); else Core.tab('messages'); } catch (err) { Core.toast(err.message, 'error'); } }
      });
      const un = subscribe(draw);
      return () => { un(); posListeners.delete(onPos); killMap(el); };
    },
  });

  // ---------- open orders (crowd) / my district (dedicated) ----------
  Core.define('board', {
    tab: true, label: 'Захиалга',
    render(el) {
      el.innerHTML = `<header class="appbar"><h1>Захиалга</h1></header><div class="scroll"><div class="pad stack" data-list><div class="skeleton" style="height:140px"></div></div></div>`;
      function draw(d) {
        const list = $(el, '[data-list]');
        if (d.driver.kind === 'dedicated') {
          list.innerHTML = `<div class="card pad stack-sm"><span class="sm muted">Миний бүс</span><b class="lg">${esc(d.driver.zone)}</b><div class="zone-big num">${d.zoneQueue}</div><span class="muted">захиалга жолооч хүлээж байна</span></div>
            <div class="card pad"><p class="muted">Үндсэн жолоочид захиалгыг систем хуваарилна: шинэ захиалга таны одоогийн замд хамгийн бага хугацаа нэмэх жолоочид очно. Та нэг дор ${d.rules.maxActive} хүртэл ачаа авна.</p></div>
            <button class="btn btn-secondary btn-block" data-edit>Чөлөөт жолооч болох</button>`;
          return;
        }
        const cost = o => (o.extraMin == null ? Infinity : o.extraMin);
        const items = d.board.slice().sort((a, b) => (b.fits - a.fits) || (cost(a) - cost(b)) || (b.onTheWay - a.onTheWay));
        list.innerHTML = !d.driver.online ? `<div class="empty"><div class="ico">${I.wheel}</div><h3>Та офлайн байна</h3><p>Захиалга авахын тулд эхлээд онлайн болно уу.</p><button class="btn btn-online" data-online>Онлайн болох</button></div>`
          : items.length ? items.map(o => `<div class="card offer${o.fits ? '' : ' no-fit'}">
              <div class="top"><div style="min-width:0"><b>${esc(o.title)}</b><div class="sm muted">${esc(o.from)} → ${esc(o.to)}</div></div><div class="pay">${money(o.pay.total)}</div></div>
              <div class="chips">${o.extraMin != null ? `<span class="tag live">+${mins(o.extraMin)} мин таны замд</span>` : ''}${o.urgent ? '<span class="tag warn">Яаралтай</span>' : ''}${o.zone ? `<span class="tag">${esc(o.zone)}</span>` : ''}${(o.needs || []).map(n => `<span class="tag">${esc(n)}</span>`).join('')}</div>
              ${o.fits ? `<button class="btn btn-primary btn-block" data-take="${esc(o.no)}">Авах</button>` : '<span class="sm faint">Өөр тээврийн хэрэгсэл хэрэгтэй</span>'}</div>`).join('')
          : `<div class="empty"><div class="ico">${I.box}</div><h3>Нээлттэй захиалга алга</h3><p>Шинэ захиалга орж ирэхэд энд шууд гарч ирнэ.</p></div>`;
      }
      el.addEventListener('click', async e => {
        const tk = e.target.closest('[data-take]');
        if (tk) { Core.busy(tk, true, 'Авч байна…'); if (await act('/api/driver/take', { no: tk.dataset.take }, 'Захиалга авлаа')) Core.tab('duty'); else Core.busy(tk, false); }
        if (e.target.closest('[data-online]')) act('/api/driver/online', { online: true }, 'Та онлайн боллоо');
        if (e.target.closest('[data-edit]')) settingsSheet('crowd');
      });
      return subscribe(draw);
    },
  });

  // ---------- earnings ----------
  Core.define('earn', {
    tab: true, label: 'Орлого',
    render(el) {
      el.innerHTML = `<header class="appbar"><h1>Орлого</h1></header><div class="scroll"><div class="pad stack" data-body><div class="skeleton" style="height:180px"></div></div></div>`;
      const WD = ['Ня', 'Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя'];
      function draw(d) {
        const t = d.today, max = Math.max(...d.days.map(x => x.total), 1), into = d.todayCount % d.rules.streakEvery;
        $(el, '[data-body]').innerHTML = `
          <div class="earn-hero"><span class="sm muted">Өнөөдөр · ${t.count} хүргэлт</span><div class="big">${money(t.total)}</div>
            <div class="bars" role="img" aria-label="Сүүлийн 7 хоногийн орлого">${d.days.map((x, i) => `<span class="${i === d.days.length - 1 ? 'today' : ''}"><i style="height:${Math.max(x.total / max * 100, x.total ? 8 : 3)}%"></i><small>${WD[new Date(x.date + 'T00:00').getDay()]}</small></span>`).join('')}</div>
            <span class="sm muted">7 хоногт ${money(d.week.total)} · ${d.week.count} хүргэлт</span></div>
          <div class="card pad stack-sm"><div style="display:flex;justify-content:space-between"><b>${d.rules.streakEvery} дахь хүргэлт бүрт +${money(d.rules.streak)}</b><span class="num">${into}/${d.rules.streakEvery}</span></div>
            <div class="streak">${Array.from({ length: d.rules.streakEvery }, (_, i) => `<i${i < into ? ' class="on"' : ''}></i>`).join('')}</div></div>
          <div class="card pad kv"><div><span>Суурь хөлс</span><span>${money(t.base)}</span></div><div><span>Үнийн хувь</span><span>${money(t.commission)}</span></div><div><span>Урамшуулал</span><span>${money(t.bonus)}</span></div><div class="total"><span>Өнөөдөр нийт</span><span>${money(t.total)}</span></div></div>
          <div class="section-title">Сүүлийн хүргэлтүүд</div>
          ${d.recent.length ? `<div class="list">${d.recent.map(o => `<div class="row"><span class="ico ok">${I.check}</span><span class="grow"><span class="title" style="display:block">${esc(o.title)}</span><span class="sub" style="display:block">${esc(o.deliveredAt)} · № ${esc(o.no)}</span></span><b class="num" style="color:var(--positive)">+${money(o.pay.total)}</b></div>`).join('')}</div>`
            : `<div class="empty"><div class="ico">${I.coins}</div><h3>Хүргэлт алга</h3><p>Эхний хүргэлтээ дуусгахад орлого энд бичигдэнэ.</p></div>`}
          <div class="card pad kv sm"><div><span>Суурь хөлс · ${esc(KIND[d.driver.kind] || '')}</span><span>${money(d.rules.base[d.driver.kind] || 0)}</span></div><div><span>Захиалгын үнийн хувь</span><span>${Math.round(d.rules.rate * 100)}%</span></div><div><span>Яаралтай захиалга</span><span>+${money(d.rules.urgent)}</span></div></div>`;
      }
      return subscribe(draw);
    },
  });

  // ---------- profile ----------
  function settingsSheet(preKind) {
    const dr = (data && data.driver) || {};
    let kind = preKind || dr.kind || 'dedicated';
    Core.sheet({ title: 'Жолоочийн тохиргоо',
      html: `<div class="stack"><div class="kind-pick" data-kinds>${Object.entries(KIND).map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${k === kind}"><b>${l}</b><small>${k === 'dedicated' ? 'Нэг дүүрэгт, систем онооно' : 'Самбараас өөрөө сонгоно'}</small></button>`).join('')}</div>
        <div class="field"><label for="s-zone">Ажиллах дүүрэг</label><div class="input"><select id="s-zone">${DISTRICTS.map(z => `<option${z === dr.zone ? ' selected' : ''}>${z}</option>`).join('')}</select>${I.chevron}</div></div>
        <div class="field"><label for="s-veh">Тээврийн хэрэгсэл</label><div class="input"><select id="s-veh">${VEHICLES.map(v => `<option${v === dr.vehicle ? ' selected' : ''}>${v}</option>`).join('')}</select>${I.chevron}</div></div></div>`,
      actions: '<button class="btn btn-primary btn-block btn-lg" data-save>Хадгалах</button>',
      onMount: s => {
        $(s.el, '[data-kinds]').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b) return; kind = b.dataset.kind; s.el.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
        $(s.el, '[data-save]').addEventListener('click', async () => { if (await act('/api/driver/profile', { kind, zone: $(s.el, '#s-zone').value, vehicle: $(s.el, '#s-veh').value }, 'Хадгалагдлаа')) s.close(); });
      } });
  }
  Core.define('me', {
    tab: true, label: 'Профайл',
    render(el) {
      function draw() {
        const u = Core.user() || {}, dr = (data && data.driver) || {};
        el.innerHTML = `<header class="appbar"><h1>Профайл</h1></header><div class="scroll"><div class="pad stack">
          <div class="card pad" style="display:flex;gap:16px;align-items:center"><span class="avatar lg">${esc(initials(u.name))}</span><span style="min-width:0"><b class="lg" style="display:block">${esc(u.name)}</b><span class="sm muted">${esc(u.phone || '')}${u.phone ? ' · ' : ''}${esc(u.email || '')}</span></span></div>
          <div class="list">
            <button class="row" data-edit><span class="ico accent">${I.wheel}</span><span class="grow"><span class="b" style="display:block">${esc(KIND[dr.kind] || '')}</span><span class="sub" style="display:block">${esc(dr.zone || '')} · ${esc(dr.vehicle || '')}</span></span>${I.chevron}</button>
            <button class="row" data-consent-toggle><span class="ico live">${I.pin}</span><span class="grow"><span class="b" style="display:block">Байршил хуваалцах</span><span class="sub" style="display:block">Онлайн үед, авсан захиалгын захиалагчид</span></span><span class="switch" role="switch" aria-checked="${!!u.locationConsent}" aria-label="Байршил хуваалцах"></span></button>
            <button class="row" data-wallet><span class="ico ok">${I.wallet}</span><span class="grow"><span class="b" style="display:block">Дансны үлдэгдэл</span><span class="sub" style="display:block">Хүргэлт бүрийн орлого шууд орно</span></span><b class="num">${money(u.wallet)}</b></button>
            <button class="row" data-server><span class="ico">${I.server}</span><span class="grow"><span class="b" style="display:block">Сервер</span><span class="sub" style="display:block">${esc(Core.serverUrl().replace(/^https?:\/\//, '') || '—')}</span></span>${I.chevron}</button>
            <button class="row" data-logout><span class="ico bad">${I.logout}</span><span class="grow b" style="color:var(--danger)">Гарах</span></button>
          </div><p class="sm faint" style="text-align:center">Log22 Жолооч · хувилбар 0.3.3</p></div></div>`;
      }
      draw();
      api('/api/me').then(() => draw()).catch(() => { });
      el.addEventListener('click', async e => {
        if (e.target.closest('[data-edit]')) settingsSheet();
        if (e.target.closest('[data-server]')) Core.serverSheet();
        if (e.target.closest('[data-wallet]')) Core.tab('earn');
        if (e.target.closest('[data-consent-toggle]')) {
          const on = !(Core.user() || {}).locationConsent;
          try { const d = await api('/api/driver/consent', { accept: on }); Core.setUser(d.user); draw(); if (!on) gps(false); Core.toast(on ? 'Байршил хуваалцахыг зөвшөөрлөө' : 'Байршил хуваалцахаа зогсоолоо'); } catch (err) { Core.toast(err.message, 'error'); }
        }
        if (e.target.closest('[data-logout]')) {
          if (!(await Core.confirm({ title: 'Гарах уу?', text: 'Гарахад та офлайн болно.', ok: 'Гарах', danger: true }))) return;
          try { await api('/api/driver/online', { online: false }); } catch { }
          stopPolling(); await Core.logout(); Core.tab('login');
        }
      });
      return subscribe(() => draw());
    },
  });

  Core.defineMessages({ emptyText: 'Захиалга авмагц захиалагчтай чат энд нээгдэнэ.' });

  Core.start({
    tabs: [
      { name: 'duty', label: 'Самбар', icon: I.map },
      { name: 'board', label: 'Захиалга', icon: I.box },
      { name: 'messages', label: 'Мессеж', icon: I.chat },
      { name: 'earn', label: 'Орлого', icon: I.coins },
      { name: 'me', label: 'Профайл', icon: I.user },
    ],
    accepts: u => u.role === 'driver',
    first: 'duty', signedOut: 'login',
  });
  if (Core.user() && Core.user().role === 'driver') startPolling();
})();
