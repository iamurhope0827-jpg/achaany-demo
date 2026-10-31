// Reuse the form's search and map so the popup and saved order share one location.
(() => {
  const dialog = document.createElement('dialog');
  dialog.className = 'address-dialog';
  dialog.setAttribute('aria-labelledby', 'address-dialog-title');
  dialog.innerHTML = `<header><svg class="address-car" viewBox="0 0 32 26" aria-hidden="true"><path d="M3 17V9a3 3 0 0 1 3-3h12l6 6 5 2v7h-4M3 21H2v-8h22M10 21h10M12 6v7"/><circle cx="7" cy="21" r="3"/><circle cx="23" cy="21" r="3"/></svg><h2 id="address-dialog-title"></h2><button type="button" class="address-close" aria-label="Хаах"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <div class="address-toolbar"><div class="address-search-slot"></div><div class="address-locate-slot"></div></div>
    <div class="address-map-slot"></div>
    <footer><p role="status">Газрын зураг дээр дарж эсвэл цэгийг чирж хаягаа сонгоно уу.</p><button type="button" class="btn btn-primary address-done">Хаяг сонгох</button></footer>`;
  document.body.append(dialog);
  const mapSection = document.getElementById('pick-map').parentElement;
  const mapHome = document.createComment('map home');
  mapSection.before(mapHome);
  const locate = document.getElementById('locate');
  const locateHome = document.createComment('locate home');
  locate.before(locateHome);
  let current = null, trigger = null;
  function open(kind, button) {
    current = document.getElementById(kind).closest('.addr-wrap');
    current._home = document.createComment('address home');
    current.before(current._home);
    trigger = button;
    dialog.querySelector('h2').textContent = kind === 'from' ? 'Ачаа авах хаяг' : 'Хүргэлтийн хаяг';
    dialog.querySelector('.address-search-slot').append(current);
    dialog.querySelector('.address-locate-slot').append(locate);
    locate.dataset.kind = kind;
    dialog.querySelector('.address-map-slot').append(mapSection);
    setMode(kind);
    dialog.showModal();
    document.body.classList.add('address-picker-open');
    picker.map.invalidateSize();
    const point = picker.get()[kind];
    if (point) picker.map.setView(point, 15);
    document.getElementById(kind).focus();
  }
  for (const kind of ['from', 'to']) {
    const input = document.getElementById(kind);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'address-open';
    button.textContent = 'Газрын зураг дээр сонгох';
    button.setAttribute('aria-haspopup', 'dialog');
    input.closest('.addr-wrap').after(button);
    button.addEventListener('click', () => open(kind, button));
  }
  dialog.querySelector('.address-close').onclick = () => dialog.close();
  dialog.querySelector('.address-done').onclick = () => dialog.close();
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => {
    current._home.replaceWith(current);
    locateHome.after(locate);
    delete locate.dataset.kind;
    mapHome.after(mapSection);
    current.querySelector('.addr-suggest').hidden = true;
    document.body.classList.remove('address-picker-open');
    picker.map.invalidateSize();
    trigger.focus();
  });
})();
