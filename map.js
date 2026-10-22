// Real maps for orders, drawn with Leaflet (vendor/leaflet) on OpenStreetMap tiles.
//   OrderMap.order(el, order)   one delivery: pickup ring, drop-off pin, the road route, and while it is
//                               on the road the driver's marker (their shared GPS, or estimated from the stage)
//   OrderMap.stops(el, orders)  a driver's batch: every stop still to make, numbered, on one route
//   OrderMap.picker(el, opts)   new-order form: tap the map to place the pickup and drop-off points
//   OrderMap.city(el)           an idle map of Ulaanbaatar
// Orders carry fromLL / toLL ([lat, lng]) when the customer placed them; older orders are placed from
// the district named in the address.
const OrderMap = (function () {
  const UB = [47.9185, 106.9177];
  const DISTRICT_LL = {
    'Баянгол': [47.9105, 106.8700], 'Баянзүрх': [47.9160, 106.9850], 'Сонгинохайрхан': [47.9220, 106.8000],
    'Сүхбаатар': [47.9290, 106.9200], 'Хан-Уул': [47.8890, 106.9050], 'Чингэлтэй': [47.9380, 106.8950],
    'Налайх': [47.7720, 107.2560], 'Багануур': [47.7830, 108.3640], 'Багахангай': [47.3420, 107.4800],
  };
  // OpenStreetMap's tile server (free for light use with this credit); for real traffic swap in a
  // hosted tile provider here — nothing else changes
  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const ROUTER = 'https://router.project-osrm.org/route/v1/driving/';

  // ---------- places ----------
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const districtOf = addr => Object.keys(DISTRICT_LL).find(d => String(addr || '').includes(d)) || '';
  // a stable point for an address that was typed but not placed: its district, spread by the address text
  function guess(addr) {
    const base = DISTRICT_LL[districtOf(addr)] || UB;
    const h = hash(addr);
    return [base[0] + ((h & 0xffff) / 0xffff - 0.5) * 0.022, base[1] + ((h >>> 16) / 0xffff - 0.5) * 0.032];
  }
  const validLL = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && isFinite(n));
  const fromOf = o => (validLL(o.fromLL) ? o.fromLL : guess(o.from));
  const toOf = o => (validLL(o.toLL) ? o.toLL : guess(o.to));
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  }
  const inService = p => validLL(p) && km(p, UB) < 150;

  // ---------- roads ----------
  // Our server answers first (server.ps1 /api/route): Mapbox traffic when it has a token, blended with our
  // drivers' measured speeds and the correction learned from past deliveries. Without the server (the
  // static demo) the public OSRM router gives the road, kept in this browser; without that, a straight line.
  const memo = new Map();
  const viaServer = () => typeof Auth !== 'undefined' && !(typeof MockApi !== 'undefined' && MockApi.enabled);
  function route(points) {
    const key = points.map(p => p.map(n => n.toFixed(4)).join(',')).join(';');
    if (memo.has(key)) return memo.get(key);
    const straight = () => {
      let d = 0; for (let i = 1; i < points.length; i++) d += km(points[i - 1], points[i]);
      return { coords: points, km: d * 1.3, min: (d * 1.3) / 22 * 60, road: false, source: 'straight' };
    };
    const p = (async () => {
      if (viaServer()) {
        try {
          const r = (await Auth.api('/api/route', { points })).route;
          if (r && r.coords && r.coords.length > 1) return { coords: r.coords, km: r.km, min: r.min, road: r.source !== 'straight', source: r.source, traffic: r.source === 'mapbox', typicalMin: r.typicalMin, ownShare: r.ownShare, congestion: r.congestion };
        } catch { }
      }
      try { const c = JSON.parse(localStorage.getItem('route:' + key)); if (c) return c; } catch { }
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(ROUTER + points.map(p => `${p[1]},${p[0]}`).join(';') + '?overview=full&geometries=geojson', { signal: ctl.signal });
        clearTimeout(t);
        const j = await r.json();
        if (j.code !== 'Ok' || !j.routes[0]) throw 0;
        const out = { coords: j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]), km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60, road: true, source: 'osrm' };
        try { localStorage.setItem('route:' + key, JSON.stringify(out)); } catch { }
        return out;
      } catch { return straight(); }
    })();
    memo.set(key, p);
    return p;
  }
  // the point a fraction of the way along a line, and the line up to it
  function along(coords, f) {
    if (coords.length < 2) return { at: coords[0], done: coords };
    const seg = []; let total = 0;
    for (let i = 1; i < coords.length; i++) { const d = km(coords[i - 1], coords[i]); seg.push(d); total += d; }
    let left = total * Math.min(Math.max(f, 0), 1);
    for (let i = 0; i < seg.length; i++) {
      if (left <= seg[i] || i === seg.length - 1) {
        const t = seg[i] ? Math.min(left / seg[i], 1) : 0, a = coords[i], b = coords[i + 1];
        const at = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        return { at, done: coords.slice(0, i + 1).concat([at]) };
      }
      left -= seg[i];
    }
  }

  // ---------- where the driver is ----------
  // Shared GPS (fresh, inside the service area) wins. Otherwise the position is estimated: before pickup
  // the driver comes in from about 1.5 km away; after pickup they move along the road at the router's pace.
  function driverEstimate(o, r) {
    const pos = o.driverPos;
    // the server's live times come from the driver's own plan (traffic, learned model, other stops first);
    // they are only meaningful when the plan starts from the driver's real position
    const lv = o.live && o.live.fromGps ? o.live : null;
    if (pos && inService([pos.lat, pos.lng]) && Date.now() - pos.at < 3 * 60e3) {
      const leg = o.stage === 'assigned' ? 'pickup' : 'drop';
      const eta = lv ? (leg === 'pickup' ? lv.pickupMin : lv.dropMin) : null;
      return { at: [pos.lat, pos.lng], real: true, leg, etaMin: eta != null ? Math.max(1, Math.round(eta)) : undefined, stopsBefore: lv ? lv.stopsBefore : 0 };
    }
    const t0 = o.stageAt ? Date.parse(o.stageAt) : NaN;
    if (o.stage === 'assigned') {
      const from = fromOf(o), h = hash(o.no + (o.driver || ''));
      const ang = (h % 360) * Math.PI / 180;
      const start = [from[0] + Math.sin(ang) * 0.013, from[1] + Math.cos(ang) * 0.019];
      const f = isNaN(t0) ? 0.4 : Math.min((Date.now() - t0) / (7 * 60e3), 0.92);
      return { at: [start[0] + (from[0] - start[0]) * f, start[1] + (from[1] - start[1]) * f], leg: 'pickup', etaMin: Math.max(1, Math.round(7 * (1 - f))) };
    }
    const dur = Math.max(r.min * 1.25, 5) * 60e3;
    let f = isNaN(t0) ? 0.45 : Math.min(Math.max((Date.now() - t0) / dur, 0.03), 0.96);
    if (lv && lv.dropMin != null && r.min > 0) f = Math.min(Math.max(1 - lv.dropMin / r.min, 0.03), 0.96);
    const a = along(r.coords, f);
    return { at: a.at, done: a.done, leg: 'drop', etaMin: Math.max(1, Math.round(lv && lv.dropMin != null ? lv.dropMin : (dur / 60e3) * (1 - f))) };
  }

  // ---------- drawing ----------
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const icon = (cls, html = '', size = 22) => L.divIcon({ className: 'om-icon ' + cls, html, iconSize: [size, size], iconAnchor: cls === 'om-pin' ? [size / 2, size] : [size / 2, size / 2] });
  const PIN = '<svg viewBox="0 0 24 30"><path d="M12 29c-6-8-10-13-10-18a10 10 0 0 1 20 0c0 5-4 10-10 18z"/><circle cx="12" cy="11" r="4"/></svg>';
  function base(el, { interactive = true } = {}) {
    if (el._om) { el._om.remove(); el._om = null; }
    el.innerHTML = '';
    el.classList.add('om');
    const map = L.map(el, { zoomSnap: 0.25, zoomControl: interactive, attributionControl: true, scrollWheelZoom: false, dragging: interactive, tap: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive });
    L.tileLayer(TILES, { attribution: ATTRIB, maxZoom: 19 }).addTo(map);
    map.attributionControl.setPrefix(false);
    el._om = map;
    // the tile grid needs a size, and cards can grow after the map is made: keep the route framed
    // until the person moves the map themselves
    map.on('dragstart', () => { map._omTouched = true; });
    if (window.ResizeObserver) new ResizeObserver(() => { map.invalidateSize(); if (map._omFit && !map._omTouched) fit(map, ...map._omFit); }).observe(el);
    return map;
  }
  // ---------- traffic ----------
  // With Mapbox, every segment of a route has a congestion level; the route is drawn in those colours
  // (runs of the same level joined into one line) with a small key in the corner.
  const TRAFFIC = { low: '#1f9d55', moderate: '#f0a020', heavy: '#e4572e', severe: '#a61b1b' };
  function trafficLayer(map, coords, congestion) {
    if (!congestion || !congestion.length || coords.length < 2) return null;
    const g = L.layerGroup();
    let start = 0;
    for (let i = 1; i <= congestion.length; i++) {
      if (i < congestion.length && congestion[i] === congestion[start]) continue;
      const color = TRAFFIC[congestion[start]];
      if (color) L.polyline(coords.slice(start, i + 1), { color, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
      start = i;
    }
    g.addTo(map);
    if (!map._omKey) {
      const key = L.control({ position: 'bottomleft' });
      key.onAdd = () => { const d = L.DomUtil.create('div', 'om-key'); d.innerHTML = '<span><i style="background:' + TRAFFIC.low + '"></i>Чөлөөтэй</span><span><i style="background:' + TRAFFIC.moderate + '"></i>Дунд</span><span><i style="background:' + TRAFFIC.heavy + '"></i>Түгжрэлтэй</span>'; return d; };
      key.addTo(map); map._omKey = key;
    }
    return g;
  }

  // pad: [top, right, bottom, left] in px, room for whatever is laid over the map
  function fit(map, pts, pad = [36, 36, 36, 36]) {
    map._omFit = [pts, pad];
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [pad[3], pad[0]], paddingBottomRight: [pad[1], pad[2]], maxZoom: 16 });
  }

  // one order; returns { update(order) } so a page can move the driver without rebuilding the map
  function order(el, o, { interactive = true, onInfo, pad } = {}) {
    const map = base(el, { interactive });
    const framed = pts => fit(map, pts, pad);
    const from = fromOf(o), to = toOf(o);
    const live = o.status === 'transit';
    const accent = css('--accent') || '#8a3d8f';
    L.marker(from, { icon: icon('om-start'), title: 'Ачаа авах', keyboard: false }).addTo(map).bindTooltip('Авах: ' + o.from);
    L.marker(to, { icon: icon('om-pin', PIN, 26), title: 'Хүргэх', keyboard: false }).addTo(map).bindTooltip('Хүргэх: ' + o.to);
    framed([from, to]);
    el.classList.toggle('om-idle', o.status === 'cancelled');
    let line = L.polyline([from, to], { color: accent, weight: 4, opacity: 0.35, dashArray: '2 8', lineCap: 'round' }).addTo(map);
    let done = null, lead = null, car = null, r = null;

    function place(cur) {
      if (!r) return;
      if (cur.status !== 'transit') {
        if (car) { car.remove(); car = null; } if (lead) { lead.remove(); lead = null; }
        if (cur.status === 'done') { if (done) done.setLatLngs(r.coords); else done = L.polyline(r.coords, { color: css('--positive') || '#1e7b4f', weight: 4, opacity: 0.9 }).addTo(map); }
        onInfo && onInfo({ km: r.km, min: r.min, road: r.road, source: r.source, traffic: r.traffic });
        return;
      }
      const est = driverEstimate(cur, r);
      if (est.done) { if (done) done.setLatLngs(est.done); else done = L.polyline(est.done, { color: accent, weight: 5, opacity: 0.95, lineCap: 'round' }).addTo(map); }
      if (est.leg === 'pickup') {
        // on its way to the pickup: dotted straight line for an estimate; the road itself when the driver's GPS is known
        const pts = [est.at, from];
        if (lead) lead.setLatLngs(pts); else lead = L.polyline(pts, { color: accent, weight: 3, opacity: 0.8, dashArray: '1 7', lineCap: 'round' }).addTo(map);
        if (est.real) route([est.at.map(n => +n.toFixed(4)), from]).then(a => { if (lead && el._om === map && a.road) { lead.setLatLngs(a.coords); lead.setStyle({ dashArray: '6 6' }); } });
      }
      else if (lead) { lead.remove(); lead = null; }
      if (car) car.setLatLng(est.at);
      else car = L.marker(est.at, { icon: icon('om-car', '<i></i>', 34), zIndexOffset: 500, keyboard: false }).addTo(map);
      car.bindTooltip(`${cur.driverName || 'Жолооч'}${est.real ? ' · бодит байршил' : ' · тооцоолсон байршил'}`);
      onInfo && onInfo({ km: r.km, min: r.min, road: r.road, source: r.source, traffic: r.traffic, leg: est.leg, etaMin: est.etaMin, real: !!est.real, stopsBefore: est.stopsBefore || 0 });
    }
    route([from, to]).then(res => {
      if (el._om !== map) return;
      r = res;
      line.setLatLngs(res.coords);
      line.setStyle({ dashArray: null, opacity: live ? 0.3 : 0.45 });
      // traffic colours on the road still ahead (a delivered or cancelled order has no traffic to show)
      if (o.status === 'waiting' || o.status === 'transit') trafficLayer(map, res.coords, res.congestion);
      place(o);
      // the driver may still be on the way to the pickup, outside the route: keep them in view too
      framed(car ? res.coords.concat([[car.getLatLng().lat, car.getLatLng().lng]]) : res.coords);
    });
    return { map, update: next => place(next) };
  }

  // a driver's stops: pickups first, then the drop-offs, on one road route
  // plan: the server's order of stops (shortest valid sequence on traffic times); without it, pickups first
  function stops(el, orders, { me, plan } = {}) {
    const map = base(el);
    const accent = css('--accent') || '#8a3d8f';
    const list = [];
    const byNo = Object.fromEntries(orders.map(o => [o.no, o]));
    if (plan && plan.stops && plan.stops.every(s => byNo[s.no])) plan.stops.forEach(s => list.push({ ll: s.ll, kind: s.kind, o: byNo[s.no] }));
    else {
      orders.filter(o => o.stage === 'assigned').forEach(o => list.push({ ll: fromOf(o), kind: 'from', o }));
      orders.forEach(o => list.push({ ll: toOf(o), kind: 'to', o }));
    }
    if (!list.length) { city(el, map); return { map }; }
    list.forEach((s, i) => L.marker(s.ll, { icon: icon('om-stop' + (i === 0 ? ' next' : '') + (s.kind === 'to' ? ' drop' : ''), `<b>${i + 1}</b>`, 26), keyboard: false })
      .addTo(map).bindTooltip(`${i + 1}. ${s.kind === 'from' ? 'Авах' : 'Хүргэх'} · № ${s.o.no}<br>${s.kind === 'from' ? s.o.from : s.o.to}`));
    const pts = (me && inService(me) ? [me] : []).concat(list.map(s => s.ll));
    let meMarker = null;
    if (me && inService(me)) meMarker = L.marker(me, { icon: icon('om-car', '<i></i>', 34), zIndexOffset: 500 }).addTo(map).bindTooltip('Таны байршил');
    fit(map, pts);
    if (pts.length > 1) route(pts).then(res => {
      if (el._om !== map) return;
      L.polyline(res.coords, { color: accent, weight: 4, opacity: 0.6, lineCap: 'round' }).addTo(map);
      trafficLayer(map, res.coords, res.congestion);
    });
    // the driver's own position moves without rebuilding the map
    return { map, setMe: ll => { if (!ll || !inService(ll)) return; if (meMarker) meMarker.setLatLng(ll); else meMarker = L.marker(ll, { icon: icon('om-car', '<i></i>', 34), zIndexOffset: 500 }).addTo(map).bindTooltip('Таны байршил'); } };
  }

  function city(el, existing) {
    const map = existing || base(el, { interactive: false });
    el.classList.add('om-idle');
    map.setView(UB, 12);
    return { map };
  }

  // the new-order form's map: one tap places the active point; points can be dragged after
  function picker(el, { onChange } = {}) {
    const map = base(el);
    map.setView(UB, 12);
    const pts = { from: null, to: null };
    const marks = {};
    let active = 'from';
    let line = null;
    const accent = css('--accent') || '#8a3d8f';
    let traffic = null;
    async function redraw() {
      if (line) { line.remove(); line = null; }
      if (traffic) { traffic.remove(); traffic = null; }
      let info = null;
      if (pts.from && pts.to) {
        const r = await route([pts.from, pts.to]);
        if (!pts.from || !pts.to) return;
        line = L.polyline(r.coords, { color: accent, weight: 4, opacity: 0.7, lineCap: 'round' }).addTo(map);
        traffic = trafficLayer(map, r.coords, r.congestion);
        info = { km: r.km, min: r.min, road: r.road, source: r.source, traffic: r.traffic };
      }
      onChange && onChange({ from: pts.from, to: pts.to, info });
    }
    function set(kind, ll, { fly = false } = {}) {
      pts[kind] = ll;
      if (marks[kind]) marks[kind].setLatLng(ll);
      else {
        marks[kind] = L.marker(ll, { draggable: true, icon: kind === 'from' ? icon('om-start') : icon('om-pin', PIN, 26), title: kind === 'from' ? 'Ачаа авах' : 'Хүргэх', autoPan: true }).addTo(map);
        marks[kind].on('dragend', () => { pts[kind] = [marks[kind].getLatLng().lat, marks[kind].getLatLng().lng]; redraw(); onPlaced && onPlaced(kind, pts[kind]); });
      }
      if (fly) map.flyTo(ll, Math.max(map.getZoom(), 14), { duration: 0.5 });
      redraw();
    }
    let onPlaced = null;
    map.on('click', e => {
      const ll = [e.latlng.lat, e.latlng.lng];
      const kind = active;
      set(kind, ll);
      onPlaced && onPlaced(kind, ll);
    });
    return {
      map,
      setActive: k => { active = k; },
      set,
      get: () => ({ from: pts.from, to: pts.to }),
      // place a point from a typed address, unless the customer already placed it by hand
      guess: (kind, addr) => { if (!districtOf(addr) || pts[kind + 'Manual']) return; set(kind, guess(addr), { fly: true }); },
      manual: kind => { pts[kind + 'Manual'] = true; },
      onPlaced: fn => { onPlaced = fn; },
      fit: () => { const p = [pts.from, pts.to].filter(Boolean); if (p.length) fit(map, p, [48, 48, 48, 48]); },
    };
  }

  // the street address at a point, from OpenStreetMap's Nominatim (used once per placed pin)
  async function addressAt(ll) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=mn&lat=${ll[0]}&lon=${ll[1]}`);
      const j = await r.json();
      const a = j.address || {};
      const parts = [a.city_district || a.suburb || a.county, a.quarter || a.neighbourhood, a.road, a.house_number].filter(Boolean);
      return parts.join(', ') || j.display_name || '';
    } catch { return ''; }
  }

  return { order, stops, city, picker, addressAt, districtOf, fromOf, toOf, km, inService };
})();
