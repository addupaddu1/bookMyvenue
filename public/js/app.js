// BookMyVenue front end - core: helpers, API calls, routing, header and college selector.
// All text goes into the page as text (never as HTML), so nothing typed by a user can inject code.
(function () {
  const BMV = (window.BMV = {});
  const state = (BMV.state = { user: null, meta: null, colleges: [], collegeId: 'tcet' });
  const routes = [];

  // ---------- tiny DOM helper ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, val] of Object.entries(props || {})) {
      if (val === null || val === undefined || val === false) continue;
      if (k.startsWith('on') && typeof val === 'function') el.addEventListener(k.slice(2), val);
      else if (k === 'class') el.className = val;
      else if (k === 'value') el.value = val;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'open') el[k] = !!val;
      else if (val === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(val));
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }
  BMV.h = h;

  // ---------- server calls ----------
  async function api(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw Object.assign(new Error('Cannot reach the server. Check your connection and try again.'), { status: 0 });
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      if (res.status === 401 && state.user) {
        state.user = null;
        renderChrome();
        toast('You were logged out. Please log in again.', 'error');
        go('/login');
      }
      throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    }
    return data;
  }
  BMV.api = api;
  BMV.get = (u) => api('GET', u);
  BMV.post = (u, b) => api('POST', u, b || {});
  BMV.put = (u, b) => api('PUT', u, b || {});
  BMV.del = (u) => api('DELETE', u);

  async function uploadImage(url, file) {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    return data;
  }
  BMV.uploadImage = uploadImage;

  // ---------- messages & dialogs ----------
  function toast(msg, kind) {
    const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), role: kind === 'error' ? 'alert' : 'status' }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3800);
  }
  BMV.toast = toast;

  // Opens a modal. `body` is a node; `buttons` is [{label, primary, danger, onclick(close)}].
  function dialog(title, body, buttons) {
    const dlg = h('dialog', { 'aria-label': title });
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0));
    dlg.append(
      h('div', { class: 'dlg-body' }, h('h2', {}, title), body),
      h('div', { class: 'dlg-foot' },
        (buttons || [{ label: 'Close' }]).map((b) =>
          h('button', { class: (b.primary ? 'primary ' : '') + (b.danger ? 'danger' : ''), type: 'button', onclick: () => (b.onclick ? b.onclick(close) : close()) }, b.label)
        ))
    );
    document.body.append(dlg);
    dlg.showModal();
    return close;
  }
  BMV.dialog = dialog;

  // Resolves true/false.
  BMV.confirm = (title, text, yesLabel, danger) =>
    new Promise((resolve) => {
      dialog(title, h('p', {}, text), [
        { label: 'Keep as is', onclick: (c) => (c(), resolve(false)) },
        { label: yesLabel, primary: !danger, danger, onclick: (c) => (c(), resolve(true)) },
      ]);
    });

  // ---------- formatting ----------
  const pad = (n) => String(n).padStart(2, '0');
  BMV.fmtDate = (d) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  BMV.fmtDateShort = (d) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  BMV.fmtTime = (t) => {
    const [hh, mm] = t.split(':').map(Number);
    return `${hh % 12 || 12}:${pad(mm)} ${hh < 12 ? 'am' : 'pm'}`;
  };
  BMV.range = (a, b) => `${BMV.fmtTime(a)} to ${BMV.fmtTime(b)}`;
  BMV.fmtStamp = (iso) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: state.meta ? state.meta.timezone || 'Asia/Kolkata' : 'Asia/Kolkata' }).format(new Date(iso));
  BMV.toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  BMV.STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', ACTIVE: 'Active', INACTIVE: 'Inactive' };
  BMV.badge = (s) => h('span', { class: `badge ${s}` }, BMV.STATUS[s] || s);
  BMV.DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  BMV.code = (c) => String(c.id || c).toUpperCase();

  // ---------- form helpers ----------
  BMV.field = (label, control, hint, id) => {
    const fid = id || 'f' + Math.random().toString(36).slice(2, 8);
    control.id = fid;
    return h('div', { class: 'field' }, h('label', { for: fid }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
  };
  BMV.select = (options, value, props) =>
    h('select', props || {}, options.map((o) => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: val, selected: String(val) === String(value) }, label);
    }));
  BMV.errorBox = () => h('div', { class: 'form-error', role: 'alert', hidden: true });
  BMV.showError = (box, msg) => { box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); };

  // Runs an async action on a button so it cannot be double-clicked.
  BMV.busy = async (btn, fn) => {
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; }
  };

  // ---------- venue picture (a coloured placeholder until the admin uploads photos) ----------
  BMV.venuePic = (venue, index = 0) => {
    const img = venue.images && venue.images[index];
    if (img) return h('div', { class: 'pic' }, h('img', { src: img, alt: index === 0 ? `Photo of ${venue.name}` : `${venue.name}, photo ${index + 1}`, loading: 'lazy' }));
    return h('div', { class: `pic p${venue.id % 5}`, role: 'img', 'aria-label': `${venue.name}, seats ${venue.capacity}. No photo yet.` },
      h('div', {}, h('b', {}, venue.capacity), h('span', {}, 'seats')));
  };

  // ---------- availability strip ----------
  // busy: [{start,end,kind}]; pick: {start,end}; nowTime: 'HH:MM'
  BMV.strip = ({ openTime, closeTime, busy = [], closed = false, pick = null, nowTime = null, label }) => {
    const o = BMV.toMin(openTime), c = BMV.toMin(closeTime), span = c - o;
    const pct = (m) => Math.max(0, Math.min(100, ((m - o) / span) * 100));
    const hours = Math.max(1, Math.round(span / 60));
    const el = h('div', { class: 'strip' + (closed ? ' closed' : ''), role: 'img', 'aria-label': label || 'Availability' });
    el.style.setProperty('--hours', hours);
    if (!closed) {
      for (const s of busy) {
        const l = pct(BMV.toMin(s.start)), r = pct(BMV.toMin(s.end));
        const seg = h('div', { class: 'seg ' + (s.kind === 'unavailable' ? 'unavailable' : '') });
        seg.style.left = l + '%'; seg.style.width = Math.max(0, r - l) + '%';
        el.append(seg);
      }
      if (pick) {
        const l = pct(BMV.toMin(pick.start)), r = pct(BMV.toMin(pick.end));
        const p = h('div', { class: 'pick' });
        p.style.left = l + '%'; p.style.width = Math.max(0, r - l) + '%';
        el.append(p);
      }
      if (nowTime) {
        const m = BMV.toMin(nowTime);
        if (m >= o && m <= c) { const n = h('div', { class: 'now', title: 'Now' }); n.style.left = `calc(${pct(m)}% - 1px)`; el.append(n); }
      }
    }
    const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' });
    const step = hours > 9 ? 2 : 1;
    for (let hr = Math.ceil(o / 60); hr * 60 <= c; hr += step) {
      const t = h('span', {}, hr % 12 || 12 + (hr >= 12 ? 'pm' : 'am'));
      t.textContent = `${hr % 12 || 12}${hr < 12 ? 'am' : 'pm'}`;
      t.style.left = pct(hr * 60) + '%';
      ticks.append(t);
    }
    return h('div', { class: 'strip-wrap' }, el, ticks);
  };
  BMV.legend = () =>
    h('div', { class: 'legend' }, h('span', {}, h('i'), 'Free'), h('span', {}, h('i', { class: 'b' }), 'Booked'), h('span', {}, h('i', { class: 'u' }), 'Not available'));

  // ---------- routing ----------
  // handler(params, query) returns a node (or promise of one). auth: 'BOOKER' | 'ADMIN' | undefined.
  BMV.route = (pattern, handler, auth) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ regex, keys, handler, auth });
  };
  function go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = '#' + path;
  }
  BMV.go = go;

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const raw = location.hash.slice(1) || '/';
    const [path, qs] = raw.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const main = document.getElementById('app');
    for (const r of routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      // This only decides what to show. The server checks the real permission on every request.
      if (r.auth && (!state.user || state.user.role !== r.auth)) {
        if (!state.user) return go('/login?next=' + encodeURIComponent(raw));
        toast('That page is not available for your account.', 'error');
        return go(state.user.role === 'ADMIN' ? '/admin' : '/dashboard');
      }
      main.replaceChildren(h('div', { class: 'wrap loading' }, 'Loading…'));
      renderChrome(path);
      try {
        const node = await r.handler(params, query);
        if (token !== renderToken) return; // the person already went somewhere else
        main.replaceChildren(node);
      } catch (err) {
        if (token !== renderToken) return;
        main.replaceChildren(h('div', { class: 'wrap page' }, h('div', { class: 'empty' }, h('strong', {}, err.status === 404 ? 'Not found' : 'Something went wrong'), err.message), h('p', {}, h('a', { href: '#/' }, 'Back to home'))));
      }
      const heading = main.querySelector('h1');
      document.title = (heading ? heading.textContent + ' | ' : '') + 'BookMyVenue';
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
      return;
    }
    main.replaceChildren(h('div', { class: 'wrap page' }, h('div', { class: 'empty' }, h('strong', {}, 'Page not found'), 'That address does not exist.'), h('p', {}, h('a', { href: '#/' }, 'Back to home'))));
  }

  // ---------- header, college bar, footer ----------
  BMV.college = () => state.colleges.find((c) => c.id === state.collegeId) || state.colleges[0] || { id: state.collegeId, name: state.collegeId };

  function renderChrome(path) {
    path = path || (location.hash.slice(1) || '/').split('?')[0];
    const u = state.user;
    const link = (href, text, match) => h('a', { href: '#' + href, 'aria-current': match(path) ? 'page' : null }, text);
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
    if (u && u.role === 'ADMIN') {
      nav.append(
        link('/admin', 'Overview', (p) => p === '/admin'),
        link('/admin/venues', 'Venues', (p) => p.startsWith('/admin/venues')),
        link('/admin/bookings', 'Bookings', (p) => p.startsWith('/admin/bookings')),
        link('/admin/bookers', 'Authorized users', (p) => p.startsWith('/admin/bookers')),
        link('/admin/availability', 'Availability', (p) => p.startsWith('/admin/availability')),
        link('/admin/settings', 'Settings', (p) => p.startsWith('/admin/settings'))
      );
    } else {
      nav.append(link('/', 'Home', (p) => p === '/'), link('/venues', 'Explore venues', (p) => p.startsWith('/venues')));
      if (u) nav.append(link('/dashboard', 'My dashboard', (p) => p === '/dashboard'), link('/my-bookings', 'My requests', (p) => p.startsWith('/my-bookings')));
    }
    const who = h('div', { class: 'who' });
    if (u) {
      who.append(h('span', {}, h('b', {}, u.name), ' ', h('span', { class: 'muted' }, u.role === 'ADMIN' ? '(admin)' : '(booker)')),
        h('button', { class: 'small', type: 'button', onclick: logout }, 'Log out'));
    } else {
      who.append(h('a', { class: 'btn primary small', href: '#/login' }, 'Log in'));
    }
    document.getElementById('top').replaceChildren(h('div', { class: 'wrap' }, h('a', { class: 'brand', href: u && u.role === 'ADMIN' ? '#/admin' : '#/' }, 'BookMyVenue'), nav, who));

    const bar = document.getElementById('collegebar');
    if (u && u.role === 'ADMIN') {
      bar.className = 'collegebar admin';
      bar.replaceChildren(h('div', { class: 'wrap' }, h('span', { class: 'label' }, 'You are managing'), h('span', { class: 'code' }, u.collegeId.toUpperCase()), h('span', { class: 'name' }, u.collegeName)));
    } else {
      bar.className = 'collegebar';
      const c = BMV.college();
      bar.replaceChildren(h('div', { class: 'wrap' },
        h('span', { class: 'label' }, 'You are viewing'),
        h('span', { class: 'code' }, BMV.code(c)),
        h('span', { class: 'name' }, c.name),
        h('button', { class: 'small', type: 'button', onclick: openCollegePicker }, state.colleges.length > 1 ? 'Change college' : 'Select college')));
    }
    document.getElementById('foot').replaceChildren(h('div', { class: 'wrap' }, 'BookMyVenue is an internal venue booking platform for colleges. Each college has its own venues, authorized users and administrator.'));
  }
  BMV.renderChrome = renderChrome;

  function openCollegePicker() {
    const list = h('div', {});
    let close;
    for (const c of state.colleges) {
      list.append(h('button', {
        class: 'college-opt', type: 'button', 'aria-pressed': c.id === state.collegeId ? 'true' : 'false',
        onclick: () => { setCollege(c.id); close(); go('/'); },
      }, h('span', { class: 'code' }, BMV.code(c)), h('span', {}, h('b', {}, c.name), h('small', {}, c.status === 'ACTIVE' ? c.location : 'Coming soon'))));
    }
    close = dialog('Select college', h('div', {}, h('p', { class: 'muted' }, 'You will only see venues that belong to the college you choose.'), list), [{ label: 'Close' }]);
  }
  BMV.openCollegePicker = openCollegePicker;

  function setCollege(id) {
    state.collegeId = id;
    try { localStorage.setItem('bmv_college', id); } catch { /* storage may be blocked */ }
    renderChrome();
  }
  BMV.setCollege = setCollege;

  async function logout() {
    try { await BMV.post('/api/auth/logout'); } catch { /* already logged out */ }
    state.user = null;
    renderChrome();
    toast('You are logged out.');
    go('/');
  }
  BMV.afterLogin = (user) => {
    state.user = user;
    if (user.role === 'BOOKER') setCollege(user.collegeId);
    renderChrome();
  };

  // ---------- start ----------
  BMV.start = async function () {
    try { const saved = localStorage.getItem('bmv_college'); if (saved) state.collegeId = saved; } catch { /* ignore */ }
    try {
      const [meta, colleges, me] = await Promise.all([BMV.get('/api/meta'), BMV.get('/api/colleges'), BMV.get('/api/auth/me')]);
      state.meta = meta;
      state.colleges = colleges;
      state.user = me.user;
    } catch (err) {
      document.getElementById('app').replaceChildren(h('div', { class: 'wrap page' }, h('div', { class: 'empty' }, h('strong', {}, 'BookMyVenue is not reachable'), err.message)));
      return;
    }
    if (!state.colleges.some((c) => c.id === state.collegeId)) {
      const first = state.colleges.find((c) => c.status === 'ACTIVE') || state.colleges[0];
      if (first) state.collegeId = first.id;
    }
    if (state.user && state.user.role === 'BOOKER') state.collegeId = state.user.collegeId;
    window.addEventListener('hashchange', render);
    render();
  };
})();
