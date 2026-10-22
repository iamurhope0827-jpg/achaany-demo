// Log22 — customer app: send a parcel, watch it on the map, talk to the driver.
(() => {
  const { esc, money, initials, $, icons: I, api } = Core;
  const STATUS = {
    waiting: { label: 'Жолооч хайж байна', tag: 'warn', ico: 'clock', cls: 'warn' },
    transit: { label: 'Замдаа', tag: 'live', ico: 'truck', cls: 'live' },
    done: { label: 'Хүргэгдсэн', tag: 'ok', ico: 'check', cls: 'ok' },
    cancelled: { label: 'Цуцлагдсан', tag: '', ico: 'close', cls: '' },
  };
  const DRIVER_KIND = { dedicated: 'Үндсэн жолооч', crowd: 'Чөлөөт жолооч' };
  // what kind of place a point is, optional; each kind asks only for the details a driver needs to find the door
  const PLACES = {
    flat: { label: 'Байр', fields: [['bldg', 'Байр', '5'], ['entr', 'Орц', '2'], ['floor', 'Давхар', '3'], ['door', 'Тоот', '45']] },
    office: { label: 'Оффис', fields: [['org', 'Байгууллага', 'Компанийн нэр', 2], ['floor', 'Давхар', '7'], ['door', 'Тоот', '702']] },
    house: { label: 'Хашаа', fields: [['door', 'Хашааны тоот', '17', 2], ['street', 'Гудамж', '3-р гудамж', 2]] },
    other: { label: 'Бусад', fields: [['text', 'Тайлбар', 'Жишээ: Их дэлгүүрийн хойд хаалга', 4]] },
  };
  // the details as words added to the address, e.g. "5-р байр, 2-р орц, 3 давхар, 45 тоот"
  const placeText = (type, v) => {
    const f = k => (v[k] || '').trim();
    const parts = type === 'flat' ? [f('bldg') && f('bldg') + '-р байр', f('entr') && f('entr') + '-р орц', f('floor') && f('floor') + ' давхар', f('door') && f('door') + ' тоот']
      : type === 'office' ? [f('org'), f('floor') && f('floor') + ' давхар', f('door') && f('door') + ' тоот']
      : type === 'house' ? [f('street'), f('door') && f('door') + ' тоот хашаа']
      : [f('text')];
    return parts.filter(Boolean).join(', ');
  };
  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Сайн байна уу' : h < 12 ? 'Өглөөний мэнд' : h < 18 ? 'Өдрийн мэнд' : 'Оройн мэнд'; };
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const killMap = el => { el && el.querySelectorAll('.om').forEach(m => { if (m._om) { m._om.remove(); m._om = null; } }); };

  // ---------- sign in / register ----------
  function authScreen(mode) {
    return {
      label: mode === 'login' ? 'Нэвтрэх' : 'Бүртгүүлэх',
      render(el) {
        el.classList.add('auth-screen');
        const reg = mode === 'register';
        el.innerHTML = `<div class="scroll">
          <div class="auth-hero"><div class="brand-mark">${I.mark}</div>
            <h1>${reg ? 'Бүртгэл үүсгэх' : 'Log22'}</h1>
            <p>${reg ? 'Хэдхэн секундэд бүртгүүлээд ачаагаа илгээгээрэй.' : 'Ачаагаа илгээж, хаана яваа нь газрын зураг дээр хараарай.'}</p></div>
          <form class="auth-form" novalidate>
            <div class="form-error" role="alert"></div>
            ${reg ? `<div class="field" data-field="name"><label for="f-name">Нэр</label><div class="input">${I.user}<input id="f-name" autocomplete="name" placeholder="Болд Бат" /></div><span class="err"></span></div>` : ''}
            <div class="field" data-field="email"><label for="f-email">${reg ? 'Имэйл' : 'Имэйл эсвэл нэвтрэх нэр'}</label><div class="input"><input id="f-email" type="${reg ? 'email' : 'text'}" inputmode="email" autocapitalize="off" autocomplete="${reg ? 'email' : 'username'}" placeholder="tanii@email.mn" /></div><span class="err"></span></div>
            <div class="field" data-field="password"><label for="f-pass">Нууц үг</label><div class="input"><input id="f-pass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="${reg ? 'Хамгийн багадаа 8 тэмдэгт' : ''}" /></div><span class="err"></span></div>
            <button class="btn btn-primary btn-block btn-lg" type="submit">${reg ? 'Бүртгүүлэх' : 'Нэвтрэх'}</button>
          </form>
          <p class="auth-alt">${reg ? 'Бүртгэлтэй юу?' : 'Шинэ хэрэглэгч үү?'} <button type="button" data-switch>${reg ? 'Нэвтрэх' : 'Бүртгүүлэх'}</button><br><button type="button" data-server class="sm">${I.server.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} Сервер</button></p>
        </div>`;
        $(el, '[data-switch]').addEventListener('click', () => Core.tab(reg ? 'login' : 'register'));
        $(el, '[data-server]').addEventListener('click', () => Core.serverSheet());
        const form = $(el, 'form');
        form.addEventListener('input', e => { const f = e.target.closest('[data-field]'); if (f) Core.fieldError(form, f.dataset.field, ''); $(form, '.form-error').textContent = ''; });
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const btn = $(form, 'button[type="submit"]');
          const email = $(form, '#f-email').value.trim(), password = $(form, '#f-pass').value, name = reg ? $(form, '#f-name').value.trim() : '';
          let bad = false;
          if (reg && name.length < 2) bad = Core.fieldError(form, 'name', 'Нэрээ оруулна уу.');
          if (!email) bad = Core.fieldError(form, 'email', reg ? 'Имэйлээ оруулна уу.' : 'Имэйл эсвэл нэвтрэх нэрээ оруулна уу.');
          if (password.length < (reg ? 8 : 1)) bad = Core.fieldError(form, 'password', reg ? 'Хамгийн багадаа 8 тэмдэгт.' : 'Нууц үгээ оруулна уу.');
          if (bad) return;
          Core.busy(btn, true, reg ? 'Бүртгэж байна…' : 'Нэвтэрч байна…');
          try {
            const u = reg ? await Core.register({ name, email, password, type: 'Хувь хүн' }) : await Core.login(email, password);
            if (u.role === 'driver') { await Core.logout(); throw new Error('Энэ бол жолоочийн бүртгэл. "Log22 Жолооч" аппаар нэвтэрнэ үү.'); }
            Core.tab('home');
          } catch (err) {
            if (!(err.field && Core.fieldError(form, err.field, err.message))) $(form, '.form-error').textContent = err.message;
          } finally { Core.busy(btn, false); }
        });
      },
    };
  }
  Core.define('login', authScreen('login'));
  Core.define('register', authScreen('register'));

  // ---------- home ----------
  const statusLine = (o, info) => {
    if (o.status === 'waiting') return 'Танд ойр жолооч хайж байна';
    if (o.status === 'transit' && info && info.etaMin) return info.leg === 'pickup' ? `Жолооч ≈ ${info.etaMin} минутад ирнэ` : `≈ ${info.etaMin} минутад хүргэгдэнэ`;
    if (o.status === 'transit') return o.stage === 'picked' ? 'Ачаа замдаа' : 'Жолооч ачааг авахаар явж байна';
    return STATUS[o.status].label;
  };
  Core.define('home', {
    tab: true, label: 'Нүүр',
    render(el) {
      const u = Core.user() || {};
      const first = (u.name || '').split(/\s+/)[0];
      el.innerHTML = `<header class="appbar home-bar"><div class="hello"><small>${esc(greeting())}</small><b>${first ? esc(first) : 'Тавтай морил'}</b></div>
          <button class="icon-btn soft" data-notes aria-label="Мэдэгдэл">${I.bell}<i class="dot-badge" hidden></i></button></header>
        <div class="scroll"><div class="pad stack home">
          <section class="card where">
            <button class="where-field" data-new><span class="where-pin">${I.pin}</span><span class="grow"><b>Хаашаа илгээх вэ?</b><small>Хоёр цэгээ газрын зураг дээр сонгоно</small></span>${I.chevron}</button>
            <button class="btn btn-primary btn-block btn-lg" data-new>${I.plus}Шинэ захиалга</button>
          </section>
          <div data-active class="stack"></div>
          <div class="card wallet-row"><span class="ico accent">${I.wallet}</span><span class="grow"><small>Хэтэвч</small><b class="num" data-balance>${money(u.wallet)}</b></span><button class="btn btn-tint btn-sm" data-topup>${I.plus}Цэнэглэх</button></div>
          <div data-recent></div>
        </div></div>`;
      el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => Core.push('new')));
      $(el, '[data-topup]').addEventListener('click', () => topupSheet(() => load()));
      $(el, '[data-notes]').addEventListener('click', notesSheet);
      const views = {};
      async function load() {
        try {
          const [d, me, n] = await Promise.all([api('/api/orders'), api('/api/me'), api('/api/notifications').catch(() => ({}))]);
          $(el, '[data-balance]').textContent = money(me.user.wallet);
          $(el, '.dot-badge').hidden = !n.unread;
          const orders = d.orders || [];
          const active = orders.filter(o => o.status === 'waiting' || o.status === 'transit').slice(0, 3);
          const box = $(el, '[data-active]');
          const keys = active.map(o => o.no + o.status + (o.stage || '')).join();
          if (box.dataset.keys !== keys) {
            killMap(box); box.dataset.keys = keys;
            box.innerHTML = active.length ? `<div class="section-title">Идэвхтэй хүргэлт</div>` + active.map(o => `
              <button class="card live-card tap" data-open="${esc(o.no)}">
                <div class="map-box"><div class="om" data-map="${esc(o.no)}"></div></div>
                <div class="live-body">
                  <div class="live-top"><span class="tag ${STATUS[o.status].tag}">${STATUS[o.status].label}</span><span class="cap faint num">№ ${esc(o.no)}</span></div>
                  <div class="eta" data-eta="${esc(o.no)}">${esc(statusLine(o))}</div>
                  <div class="mini-route"><span><i></i>${esc(o.from)}</span><span><i class="to"></i>${esc(o.to)}</span></div>
                  ${o.driverName ? `<div class="live-driver"><span class="avatar">${esc(initials(o.driverName))}</span><span class="grow"><b>${esc(o.driverName)}</b><small>${esc(DRIVER_KIND[o.driverKind] || 'Жолооч')}</small></span>${I.chevron}</div>` : ''}
                </div>
              </button>`).join('') : '';
            active.forEach(o => {
              const m = box.querySelector(`[data-map="${CSS.escape(o.no)}"]`);
              views[o.no] = OrderMap.order(m, o, { interactive: false, onInfo: i => { const e = box.querySelector(`[data-eta="${CSS.escape(o.no)}"]`); if (e) e.textContent = statusLine(o, i); } });
            });
          } else active.forEach(o => views[o.no] && views[o.no].update(o));
          const recent = orders.filter(o => o.status === 'done' || o.status === 'cancelled').slice(0, 3);
          $(el, '[data-recent]').innerHTML = recent.length ? `<div class="section-title">Сүүлийн захиалга <button data-all>Бүгд</button></div><div class="list">${recent.map(orderRow).join('')}</div>`
            : (!active.length ? `<div class="empty"><div class="ico accent">${I.map}</div><h3>Анхны ачаагаа илгээгээрэй</h3><p>Хаанаас хаашаа гэдгээ газрын зураг дээр 2 товшилтоор сонгоно. Үнэ нь зайгаар шууд бодогдоно.</p></div>` : '');
        } catch (e) { Core.toast(e.message, 'error'); }
      }
      el.addEventListener('click', e => {
        const o = e.target.closest('[data-open]'); if (o) Core.push('order', { no: o.dataset.open });
        if (e.target.closest('[data-all]')) Core.tab('orders');
      });
      load();
      const iv = setInterval(load, 15000);
      return () => { clearInterval(iv); killMap(el); };
    },
  });

  const orderRow = o => `<button class="row" data-open="${esc(o.no)}"><span class="ico ${STATUS[o.status].cls}">${I[STATUS[o.status].ico]}</span>
    <span class="grow"><span class="title" style="display:block">${esc(o.title)}</span><span class="sub" style="display:block">${esc(o.from)} → ${esc(o.to)}</span></span>
    <span class="end"><b class="num">${money(o.price)}</b><br><span class="sm faint">${esc(String(o.date || '').slice(5, 16).replace('-', '.'))}</span></span></button>`;

  // ---------- new delivery ----------
  Core.define('new', {
    label: 'Шинэ хүргэлт',
    render(el, params = {}) {
      el.classList.add('new-screen');
      el.innerHTML = `<div class="map-box"><div class="om" data-map></div>
          <div class="map-top"><button class="icon-btn on-map" data-back aria-label="Буцах">${I.back}</button>
            <div class="seg" role="group" aria-label="Аль цэгийг тэмдэглэх"><button type="button" data-mode="from" aria-pressed="true">Авах цэг</button><button type="button" data-mode="to" aria-pressed="false">Хүргэх цэг</button></div></div>
          <div class="map-hint" data-hint>Газрын зураг дээр товшиж ачаа авах цэгээ тэмдэглэ</div></div>
        <div class="panel"><button class="grabber-btn" data-grab aria-label="Дэлгэрэнгүй"><span class="grabber"></span></button>
          <form class="panel-body" novalidate>
            <div class="addr-input">
              <span class="dot"></span><div class="input" data-addr="from"><input data-in="from" placeholder="Авах хаяг (газрын зургаас)" autocomplete="off" /><button type="button" class="loc-btn" data-locate aria-label="Миний байгаа газар"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span>Миний байршил</span></button></div>
              <span class="vline"></span><span></span>
              <span class="dot to"></span><div class="input" data-addr="to"><input data-in="to" placeholder="Хүргэх хаяг" autocomplete="off" /></div>
            </div>
            ${['from', 'to'].map(k => `<div class="place" data-place="${k}"><div class="place-head"><span>${k === 'from' ? 'Авах газар' : 'Хүргэх газар'}</span><small>заавал биш</small></div>
              <div class="chips">${Object.entries(PLACES).map(([t, p]) => `<button type="button" class="chip" data-ptype="${t}" aria-pressed="false">${p.label}</button>`).join('')}</div>
              <div class="place-detail" hidden></div></div>`).join('')}
            <div class="field" data-field="title"><label for="n-title">Юу илгээх вэ?</label>
              <div class="chips" data-kinds>${['Бичиг баримт', 'Хүнс', 'Цэцэг', 'Хувцас', 'Электрон бараа', 'Тавилга'].map(k => `<button type="button" class="chip" data-kind="${k}" aria-pressed="false">${k}</button>`).join('')}</div>
              <div class="input"><input id="n-title" maxlength="80" placeholder="Эсвэл өөрөө бичнэ үү" /></div><span class="err"></span></div>
            <div class="field"><label>Овор хэмжээ</label><div class="size-pick" data-sizes></div></div>
            <div class="field" data-field="weight"><label for="n-weight">Жин</label><div class="input"><input id="n-weight" inputmode="decimal" placeholder="0" /><span class="faint">кг</span></div><span class="err"></span></div>
            <button type="button" class="toggle-row" data-urgent aria-pressed="false"><span class="ico warn">${I.bolt}</span><span class="grow"><b>Яаралтай</b><br><span class="sm muted">Жолооч түрүүлж авна</span></span><span class="switch" aria-hidden="true"></span></button>
            <div class="field"><label>Тээврийн хэрэгсэл</label><div class="chips" data-needs>${['Мопед', 'Суудлын автомашин', 'Портер', 'Ачигч'].map(n => `<button type="button" class="chip" data-need="${n}" aria-pressed="false">${n}</button>`).join('')}</div></div>
            <div class="field"><label for="n-note">Жолоочид тэмдэглэл</label><div class="input"><textarea id="n-note" maxlength="400" placeholder="Жишээ: 2 давхарт, хэврэг ачаа"></textarea></div></div>
            <div class="fare" data-field="price"><div class="fare-head"><b>Хүргэлтийн төлбөр</b><span class="sm muted" data-trip></span></div>
              <div class="kv sm" data-lines></div>
              <div class="want"><span class="muted sm">Таны санал болгох үнэ</span><b class="num" data-want>—</b></div>
              <div class="boosts" data-boosts></div><span class="err sm" style="color:var(--danger)"></span>
              <p class="sm faint">Үнээ нэмбэл жолооч хурдан олдоно.</p></div>
          </form>
          <div class="panel-foot"><button class="btn btn-primary btn-block btn-lg" data-submit disabled>Захиалах</button></div></div>`;
      $(el, '[data-back]').addEventListener('click', () => Core.pop());
      $(el, '[data-grab]').addEventListener('click', () => $(el, '.panel').classList.toggle('expanded'));
      const form = $(el, 'form');
      let tariff = null, trip = null, want = 0, size = 'small', urgent = false, mode = 'from', placed = { from: false, to: false };
      const roundUp = n => Math.ceil(n / tariff.round) * tariff.round;
      const picker = OrderMap.picker($(el, '[data-map]'), { onChange: ({ from, to, info }) => {
        trip = info;
        $(el, '[data-hint]').textContent = !from ? 'Газрын зураг дээр товшиж ачаа авах цэгээ тэмдэглэ' : !to ? 'Одоо хүргэх цэгээ тэмдэглэ' : info ? `${info.km < 10 ? info.km.toFixed(1) : Math.round(info.km)} км · замд ≈ ${Math.max(1, Math.round(info.min))} мин${info.traffic ? ' · түгжрэлийг тооцсон' : ''}` : 'Замыг тооцоолж байна…';
        renderFare();
      } });
      function setMode(k) {
        mode = k; picker.setActive(k);
        el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === k)));
        el.querySelectorAll('[data-addr]').forEach(b => b.classList.toggle('active', b.dataset.addr === k));
      }
      el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
      el.querySelectorAll('[data-in]').forEach(inp => {
        inp.addEventListener('focus', () => setMode(inp.dataset.in));
        inp.addEventListener('change', () => picker.guess(inp.dataset.in, inp.value));
      });
      // the pickup point from where the customer is standing now (the phone's GPS)
      $(el, '[data-locate]').addEventListener('click', e => {
        const btn = e.currentTarget;
        if (!navigator.geolocation) { Core.toast('Энэ төхөөрөмж байршил тодорхойлж чадахгүй байна.', 'error'); return; }
        btn.classList.add('busy');
        navigator.geolocation.getCurrentPosition(async pos => {
          btn.classList.remove('busy');
          const ll = [pos.coords.latitude, pos.coords.longitude];
          if (OrderMap.inService && !OrderMap.inService(ll)) { Core.toast('Таны байршил Улаанбаатараас гадна байна. Газрын зураг дээр товшиж сонгоно уу.', 'error'); return; }
          setMode('from');
          picker.set('from', ll, { fly: true });
          $(el, '[data-in="from"]').value = '';
          await placedAt('from', ll);
        }, err => {
          btn.classList.remove('busy');
          Core.toast(err.code === 1 ? 'Байршлын зөвшөөрөл өгөөгүй байна. Утасны тохиргооноос зөвшөөрөх эсвэл газрын зураг дээр товшиж сонгоно уу.' : 'Байршил олдсонгүй. Газрын зураг дээр товшиж сонгоно уу.', 'error');
        }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
      });
      picker.onPlaced((kind, ll) => placedAt(kind, ll));
      async function placedAt(kind, ll) {
        picker.manual(kind); placed[kind] = true;
        if (kind === 'from' && !picker.get().to) setMode('to');
        const inp = $(el, `[data-in="${kind}"]`);
        if (!inp.value.trim()) { const a = await OrderMap.addressAt(ll); if (a && !inp.value.trim()) { inp.value = a; validate(); } }
        validate();
      }
      // optional place kind and its details, for both points
      const place = { from: null, to: null };
      el.querySelectorAll('[data-place]').forEach(box => {
        const k = box.dataset.place, detail = $(box, '.place-detail');
        box.addEventListener('click', e => {
          const b = e.target.closest('[data-ptype]'); if (!b) return;
          const t = place[k] === b.dataset.ptype ? null : b.dataset.ptype;   // tapping the chosen kind again clears it
          place[k] = t;
          box.querySelectorAll('[data-ptype]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.ptype === t)));
          detail.hidden = !t;
          detail.innerHTML = t ? PLACES[t].fields.map(([n, label, ph, span]) => `<label class="pd" style="grid-column:span ${span || 1}"><small>${label}</small><input data-pf="${n}" placeholder="${esc(ph)}" maxlength="60" autocomplete="off" ${['bldg', 'entr', 'floor'].includes(n) ? 'inputmode="numeric"' : ''} /></label>`).join('') : '';
          if (t) { const f = detail.querySelector('input'); if (f) f.focus({ preventScroll: true }); }
        });
      });
      const placeOf = k => {
        if (!place[k]) return '';
        const v = {}; el.querySelectorAll(`[data-place="${k}"] [data-pf]`).forEach(i => { v[i.dataset.pf] = i.value; });
        return placeText(place[k], v);
      };
      const withPlace = k => { const a = $(el, `[data-in="${k}"]`).value.trim(), d = placeOf(k); return d ? `${a}, ${d}` : a; };
      setMode('from');
      // selection over typing: the common parcel kinds are one tap
      $(el, '[data-kinds]').addEventListener('click', e => {
        const b = e.target.closest('[data-kind]'); if (!b) return;
        el.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $(el, '#n-title').value = b.dataset.kind; Core.fieldError(form, 'title', ''); validate();
      });
      if (params.kind) { const pre = el.querySelector(`[data-kind="${CSS.escape(params.kind)}"]`); if (pre) pre.click(); }
      $(el, '#n-title').addEventListener('input', () => { el.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', 'false')); validate(); });
      $(el, '[data-needs]').addEventListener('click', e => { const b = e.target.closest('[data-need]'); if (b) b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); });
      $(el, '[data-urgent]').addEventListener('click', e => { urgent = !urgent; const b = e.currentTarget; b.setAttribute('aria-pressed', String(urgent)); $(b, '.switch').setAttribute('aria-checked', String(urgent)); });
      $(el, '#n-weight').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^\d.]/g, ''); renderFare(); });
      $(el, '[data-boosts]').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b || !tariff || !trip) return;
        const sys = system();
        want = b.dataset.reset ? roundUp(sys.total) : want + Number(b.dataset.add);
        renderFare(true);
      });
      function system() {
        const km = Math.round(trip.km * 10) / 10, kg = Number($(el, '#n-weight').value) || 0;
        const w = tariff.weight.find(t => kg <= t.upTo).fee, s = tariff.size[size].fee, dist = Math.round(km * tariff.perKm / 100) * 100;
        return { km, dist, extra: w + s, total: dist + tariff.call + w + s };
      }
      let lastSys = null;
      function renderFare(keepWant) {
        if (!tariff) return;
        const lines = $(el, '[data-lines]');
        if (!trip) { lines.innerHTML = `<div><span>Тариф</span><span>1 км = ${fmt(tariff.perKm)}₮</span></div><div><span>Дуудлага</span><span>${fmt(tariff.call)}₮</span></div>`; $(el, '[data-want]').textContent = '—'; $(el, '[data-trip]').textContent = 'Хоёр цэгээ сонгоно уу'; validate(); return; }
        const sys = system();
        if (!keepWant) { const added = lastSys && want ? Math.max(0, want - roundUp(lastSys.total)) : 0; want = roundUp(sys.total) + added; }
        lastSys = sys;
        $(el, '[data-trip]').textContent = `${sys.km} км`;
        lines.innerHTML = `<div><span>Зай ${sys.km} км × ${fmt(tariff.perKm)}₮</span><span>${fmt(sys.dist)}₮</span></div>
          <div><span>Дуудлага</span><span>${fmt(tariff.call)}₮</span></div>
          <div><span>Жин, овор</span><span>${fmt(sys.extra)}₮</span></div>
          <div class="total"><span>Бодогдсон үнэ</span><span>${fmt(sys.total)}₮</span></div>`;
        $(el, '[data-want]').textContent = fmt(want) + '₮';
        validate();
      }
      function validate() {
        const ok = !!(trip && tariff && $(el, '#n-title').value.trim().length >= 2 && $(el, '[data-in="from"]').value.trim().length >= 3 && $(el, '[data-in="to"]').value.trim().length >= 3);
        const btn = $(el, '[data-submit]');
        btn.disabled = !ok;
        btn.textContent = trip && tariff ? `Захиалах · ${fmt(want)}₮` : 'Захиалах';
      }
      api('/api/pricing').then(d => {
        tariff = d.fare;
        $(el, '[data-sizes]').innerHTML = Object.entries(tariff.size).map(([k, s]) => `<button type="button" data-size="${k}" aria-pressed="${k === size}"><b>${esc(s.label)}</b><small>${esc(s.hint)}</small><em>${s.fee ? '+' + fmt(s.fee) + '₮' : 'Нэмэгдэлгүй'}</em></button>`).join('');
        $(el, '[data-boosts]').innerHTML = tariff.boosts.map(v => `<button type="button" data-add="${v}">+${fmt(v)}₮</button>`).join('') + `<button type="button" data-reset aria-label="Анхны үнэ">${I.close}</button>`;
        renderFare();
      }).catch(e => Core.toast(e.message, 'error'));
      $(el, '[data-sizes]').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (!b) return; size = b.dataset.size; el.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderFare(); });
      $(el, '[data-submit]').addEventListener('click', async e => {
        const btn = e.currentTarget; const ll = picker.get();
        const body = { type: 'delivery', title: $(el, '#n-title').value.trim(), from: withPlace('from'), to: withPlace('to'), fromPlace: place.from, toPlace: place.to,
          fromLL: ll.from, toLL: ll.to, km: lastSys ? lastSys.km : null, size, weight: $(el, '#n-weight').value.trim(), price: want, urgent,
          needs: [...el.querySelectorAll('[data-need][aria-pressed="true"]')].map(b => b.dataset.need), note: $(el, '#n-note').value.trim(),
          pickupDate: Core.today() };
        Core.busy(btn, true, 'Илгээж байна…');
        try {
          const r = await api('/api/orders', body);
          Core.toast(r.order.driverName ? `Жолооч олдлоо: ${r.order.driverName}` : 'Захиалга үүслээ — жолооч хайж байна');
          Core.replace('order', { no: r.order.no });
        } catch (err) {
          if (!(err.field && Core.fieldError(form, err.field, err.message))) Core.toast(err.message, 'error');
          Core.busy(btn, false); validate();
        }
      });
      return () => killMap(el);
    },
  });

  // ---------- orders ----------
  Core.define('orders', {
    tab: true, label: 'Захиалга',
    render(el) {
      let filter = 'active', orders = [];
      el.innerHTML = `<header class="appbar"><h1>Захиалга</h1><button class="icon-btn" data-new aria-label="Шинэ хүргэлт">${I.plus}</button></header>
        <div class="pad" style="padding-top:0"><div class="seg" role="group" aria-label="Шүүлтүүр"><button data-f="active" aria-pressed="true">Идэвхтэй</button><button data-f="done" aria-pressed="false">Дууссан</button><button data-f="cancelled" aria-pressed="false">Цуцалсан</button></div></div>
        <div class="scroll"><div class="pad" style="padding-top:0" data-list><div class="skeleton" style="height:220px"></div></div></div>`;
      const draw = () => {
        const list = orders.filter(o => filter === 'active' ? (o.status === 'waiting' || o.status === 'transit') : o.status === filter);
        $(el, '[data-list]').innerHTML = list.length ? `<div class="list">${list.map(orderRow).join('')}</div>`
          : `<div class="empty"><div class="ico">${I.box}</div><h3>${filter === 'active' ? 'Идэвхтэй захиалга алга' : 'Энд хоосон байна'}</h3><p>${filter === 'active' ? 'Шинэ хүргэлт үүсгэхэд энд харагдана.' : 'Дууссан захиалгууд энд хадгалагдана.'}</p>${filter === 'active' ? `<button class="btn btn-primary" data-new>${I.plus}Хүргэлт үүсгэх</button>` : ''}</div>`;
      };
      el.addEventListener('click', e => {
        const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; el.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === f))); draw(); }
        const o = e.target.closest('[data-open]'); if (o) Core.push('order', { no: o.dataset.open });
        if (e.target.closest('[data-new]')) Core.push('new');
      });
      const load = () => api('/api/orders').then(d => { orders = d.orders || []; draw(); }).catch(e => Core.toast(e.message, 'error'));
      load();
      const iv = setInterval(load, 20000);
      return () => clearInterval(iv);
    },
    resume() { },
  });

  // ---------- order detail ----------
  Core.define('order', {
    label: 'Захиалга',
    render(el, { no }) {
      el.classList.add('detail-screen');
      el.innerHTML = `<div class="map-box"><div class="om" data-map></div><div class="map-top"><button class="icon-btn on-map" data-back aria-label="Буцах">${I.back}</button><span class="eta-chip" data-chip hidden></span></div></div>
        <div class="detail-sheet" data-body><div class="skeleton" style="height:120px"></div></div>`;
      $(el, '[data-back]').addEventListener('click', () => Core.pop());
      let view = null, key = '', info = null, order = null, chatId = null;
      const step = o => (o.status === 'done' ? 3 : o.status === 'transit' ? (o.stage === 'picked' ? 2 : 1) : 0);
      function draw(o) {
        order = o;
        const s = STATUS[o.status];
        const st = step(o);
        const steps = ['Захиалсан', 'Жолооч', 'Замдаа', 'Хүргэсэн'];
        const f = o.fare;
        $(el, '[data-body]').innerHTML = `
          <div><span class="tag ${s.tag}">${s.label}</span><div class="headline" style="margin-top:8px" data-headline>${esc(statusLine(o, info))}</div><div class="sm faint">№ ${esc(o.no)} · ${esc(o.date)}</div></div>
          ${o.status !== 'cancelled' ? `<div class="steps" aria-label="Хүргэлтийн явц">${steps.map((n, i) => `<div class="${i < st || o.status === 'done' ? 'done' : i === st ? 'now' : ''}"><i></i>${n}</div>`).join('')}</div>` : ''}
          ${o.driverName ? `<div class="card pad driver-card"><span class="avatar">${esc(initials(o.driverName))}</span><span class="grow"><b>${esc(o.driverName)}</b><br><span class="sm muted">${esc(DRIVER_KIND[o.driverKind] || 'Жолооч')} · ${esc(o.driverVehicle || '')}</span></span>
            ${o.driverPhone && o.status === 'transit' ? `<a class="round-btn" href="tel:${esc(o.driverPhone)}" aria-label="Залгах">${I.phone}</a>` : ''}<button class="round-btn" data-chat aria-label="Чат">${I.chat}</button></div>` : ''}
          <div class="card pad"><div class="route"><span class="pt"><i></i></span><div class="addr"><small>Авах</small><div>${esc(o.from)}</div></div><span class="line"></span><span></span><span class="pt to"><i></i></span><div class="addr"><small>Хүргэх</small><div>${esc(o.to)}</div></div></div></div>
          <div class="card pad kv"><div><span>Ачаа</span><span>${esc(o.title)}</span></div>${o.weight ? `<div><span>Жин</span><span>${esc(o.weight)} кг</span></div>` : ''}${o.urgent ? '<div><span>Яаралтай</span><span>Тийм</span></div>' : ''}${(o.needs || []).length ? `<div><span>Хэрэгсэл</span><span>${esc(o.needs.join(', '))}</span></div>` : ''}${o.note ? `<div><span>Тэмдэглэл</span><span>${esc(o.note)}</span></div>` : ''}</div>
          <div class="card pad kv">${f ? `<div><span>Зай ${esc(f.km)} км</span><span>${fmt(f.distance)}₮</span></div><div><span>Дуудлага</span><span>${fmt(f.call)}₮</span></div>${f.weight ? `<div><span>Жин, овор</span><span>${fmt(f.weight)}₮</span></div>` : ''}${f.extra ? `<div><span>Таны нэмсэн</span><span>+${fmt(f.extra)}₮</span></div>` : ''}` : ''}<div class="total"><span>Нийт</span><span>${money(o.price)}</span></div></div>
          ${o.status === 'waiting' || o.status === 'transit' ? '<button class="btn btn-danger btn-block" data-cancel>Захиалга цуцлах</button>' : ''}
          ${o.status === 'cancelled' ? '<button class="btn btn-secondary btn-block" data-restore>Дахин захиалах</button>' : ''}`;
      }
      async function load() {
        try {
          const d = await api('/api/orders');
          const o = (d.orders || []).find(x => x.no === no);
          if (!o) { Core.toast('Захиалга олдсонгүй', 'error'); return; }
          const k = [o.status, o.stage, o.driver, (o.history || []).length].join('|');
          if (k !== key) {
            key = k; draw(o);
            if (!view || view.status !== o.status) {
              killMap(el); const m = document.createElement('div'); m.className = 'om'; $(el, '.map-box').prepend(m); $(el, '[data-map]') && $(el, '[data-map]').remove(); m.setAttribute('data-map', '');
              view = OrderMap.order(m, o, { pad: [72, 24, 40, 24], onInfo: i => {
                info = i; const chip = $(el, '[data-chip]');
                chip.hidden = false;
                chip.textContent = o.status === 'transit' && i.etaMin ? (i.leg === 'pickup' ? `Жолооч ≈ ${i.etaMin} мин` : `≈ ${i.etaMin} мин`) : `${i.km < 10 ? i.km.toFixed(1) : Math.round(i.km)} км${i.traffic ? ' · түгжрэл тооцсон' : ''}`;
                const hl = $(el, '[data-headline]'); if (hl && order) hl.textContent = statusLine(order, i);
              } });
              view.status = o.status;
            } else view.update(o);
          } else if (view) view.update(o);
          if (o.driver && !chatId) { api('/api/chats').then(c => { const ch = (c.chats || []).find(x => x.orderNo === no && x.kind === 'driver'); if (ch) chatId = ch.id; }).catch(() => { }); }
        } catch (e) { Core.toast(e.message, 'error'); }
      }
      el.addEventListener('click', async e => {
        if (e.target.closest('[data-chat]')) { if (chatId) Core.push('thread', { id: chatId }); else Core.tab('messages'); }
        if (e.target.closest('[data-cancel]')) {
          if (!(await Core.confirm({ title: 'Захиалга цуцлах уу?', text: order && order.driverName ? `${order.driverName} таны захиалгыг авсан байна. Цуцалбал түүнд мэдэгдэнэ.` : 'Жолооч хайлт зогсоно.', ok: 'Цуцлах', danger: true }))) return;
          try { await api('/api/orders/action', { no, action: 'cancel' }); Core.toast('Захиалга цуцлагдлаа'); key = ''; load(); } catch (err) { Core.toast(err.message, 'error'); }
        }
        if (e.target.closest('[data-restore]')) { try { await api('/api/orders/action', { no, action: 'restore' }); Core.toast('Дахин захиаллаа'); key = ''; load(); } catch (err) { Core.toast(err.message, 'error'); } }
      });
      load();
      const iv = setInterval(() => { if (!order || order.status === 'waiting' || order.status === 'transit') load(); }, 12000);
      return () => { clearInterval(iv); killMap(el); };
    },
  });

  // ---------- messages (shared) ----------
  Core.defineMessages({ emptyText: 'Жолооч таны захиалгыг авмагц энд чат нээгдэнэ. Асуулт байвал тусламжийн багт бичээрэй.' });

  // ---------- profile ----------
  function topupSheet(done) {
    let amount = 20000;
    Core.sheet({ title: 'Хэтэвч цэнэглэх',
      html: `<div class="amounts" data-amounts>${[10000, 20000, 50000, 100000].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === amount}">${money(v)}</button>`).join('')}</div>
        <div class="field" style="margin-top:16px"><label>Төлбөрийн хэрэгсэл</label><div class="seg" data-method><button type="button" aria-pressed="true">QPay</button><button type="button" aria-pressed="false">Карт</button></div></div>
        <p class="sm faint" style="margin-top:12px">Туршилтын горим: төлбөр шууд баталгаажна.</p>`,
      actions: `<button class="btn btn-primary btn-block btn-lg" data-pay>${money(amount)} цэнэглэх</button>`,
      onMount: s => {
        const pay = $(s.el, '[data-pay]');
        $(s.el, '[data-amounts]').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; amount = Number(b.dataset.v); s.el.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pay.textContent = `${money(amount)} цэнэглэх`; });
        $(s.el, '[data-method]').addEventListener('click', e => { const b = e.target.closest('button'); if (b) s.el.querySelectorAll('[data-method] button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
        pay.addEventListener('click', async () => {
          Core.busy(pay, true, 'Төлж байна…');
          try { const d = await api('/api/wallet/topup', { amount, method: $(s.el, '[data-method] [aria-pressed="true"]').textContent }); Core.setUser(d.user); Core.toast(`${money(amount)} цэнэглэгдлээ`); s.close(); done && done(); }
          catch (err) { Core.toast(err.message, 'error'); Core.busy(pay, false); }
        });
      } });
  }
  function notesSheet() {
    Core.sheet({ title: 'Мэдэгдэл', html: '<div data-notes><div class="skeleton" style="height:64px"></div></div>', onMount: async s => {
      try {
        const d = await api('/api/notifications');
        const list = (d.notifications || []).slice(0, 25);
        $(s.el, '[data-notes]').innerHTML = list.length ? `<div class="list" style="box-shadow:none">${list.map(n => `<div class="row"><span class="ico ${n.kind === 'ok' ? 'ok' : n.kind === 'alert' ? 'bad' : 'live'}">${n.kind === 'ok' ? I.check : n.kind === 'alert' ? I.alert : I.bell}</span><span class="grow"><b style="display:block">${esc(n.title)}</b><span class="sm muted">${esc(n.text)}</span><br><span class="sm faint">${esc(n.at)}</span></span></div>`).join('')}</div>` : '<div class="empty"><div class="ico">' + I.bell + '</div><h3>Мэдэгдэл алга</h3></div>';
        api('/api/notifications/read', {}).catch(() => { });
      } catch (e) { $(s.el, '[data-notes]').textContent = e.message; }
    } });
  }
  Core.define('profile', {
    tab: true, label: 'Профайл',
    render(el) {
      const draw = (u, tx) => {
        el.innerHTML = `<header class="appbar"><h1>Профайл</h1></header>
          <div class="scroll"><div class="pad stack">
            <div class="card pad profile-head"><span class="avatar lg">${esc(initials(u.name))}</span><span style="min-width:0"><b class="lg" style="display:block">${esc(u.name)}</b><span class="sm muted">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</span></span></div>
            <div class="card pad stack-sm"><span class="sm muted">Хэтэвчний үлдэгдэл</span><div class="balance num">${money(u.wallet)}</div><button class="btn btn-primary btn-block" data-topup>${I.plus}Цэнэглэх</button></div>
            ${tx && tx.length ? `<div class="section-title">Сүүлийн гүйлгээ</div><div class="list">${tx.slice(0, 5).map(t => `<div class="row"><span class="ico ${t.amount >= 0 ? 'ok' : ''}">${I.coins}</span><span class="grow"><span class="title" style="display:block">${esc(t.title)}</span><span class="sub" style="display:block">${esc(t.at)} · ${esc(t.method)}</span></span><b class="num" style="color:${t.amount >= 0 ? 'var(--positive)' : 'var(--text)'}">${t.amount >= 0 ? '+' : '−'}${money(Math.abs(t.amount))}</b></div>`).join('')}</div>` : ''}
            <div class="section-title">Тохиргоо</div>
            <div class="list">
              ${[['notifyEmail', 'Имэйл мэдэгдэл'], ['notifySms', 'SMS мэдэгдэл']].map(([k, l]) => `<button class="row" data-set="${k}"><span class="ico">${I.bell}</span><span class="grow b">${l}</span><span class="switch" aria-checked="${!!(u.settings || {})[k]}" role="switch" aria-label="${l}"></span></button>`).join('')}
              <button class="row" data-server><span class="ico">${I.server}</span><span class="grow"><span class="b" style="display:block">Сервер</span><span class="sub" style="display:block">${esc(Core.serverUrl().replace(/^https?:\/\//, '') || '—')}</span></span>${I.chevron}</button>
              <button class="row" data-logout><span class="ico bad">${I.logout}</span><span class="grow b" style="color:var(--danger)">Гарах</span></button>
            </div>
            <p class="sm faint" style="text-align:center">Log22 · хувилбар 0.3.3</p>
          </div></div>`;
      };
      draw(Core.user() || {}, []);
      const load = async () => { try { const [me, w] = await Promise.all([api('/api/me'), api('/api/wallet')]); draw(me.user, w.transactions); } catch (e) { Core.toast(e.message, 'error'); } };
      el.addEventListener('click', async e => {
        if (e.target.closest('[data-topup]')) topupSheet(load);
        if (e.target.closest('[data-server]')) Core.serverSheet();
        const s = e.target.closest('[data-set]');
        if (s) { const sw = $(s, '.switch'); const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); try { const d = await api('/api/settings', { [s.dataset.set]: on }); Core.setUser(d.user); } catch (err) { sw.setAttribute('aria-checked', String(!on)); Core.toast(err.message, 'error'); } }
        if (e.target.closest('[data-logout]')) { if (await Core.confirm({ title: 'Гарах уу?', text: 'Дахин нэвтрэхэд нууц үгээ оруулна.', ok: 'Гарах', danger: true })) { await Core.logout(); Core.tab('login'); } }
      });
      load();
    },
  });

  Core.start({
    tabs: [
      { name: 'home', label: 'Нүүр', icon: I.home },
      { name: 'orders', label: 'Захиалга', icon: I.box },
      { name: 'messages', label: 'Мессеж', icon: I.chat },
      { name: 'profile', label: 'Профайл', icon: I.user },
    ],
    accepts: u => u.role !== 'driver',
    first: 'home', signedOut: 'login',
  });
})();
