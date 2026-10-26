// Public screens: Home, Explore Venues, Venue Details, Login.
(function () {
  const { h, state, get, post, field, select, errorBox, showError, busy, strip, legend, venuePic, fmtDate, fmtTime, range, toMin } = Object.assign({}, BMV, { state: BMV.state });

  const noCollege = () =>
    h('div', { class: 'wrap page' }, h('div', { class: 'empty' }, h('strong', {}, 'No venues here yet'), 'This college has not been set up on BookMyVenue yet. Use "Change college" above to pick another one.'));

  // What a venue is doing right now, in words.
  function nowState(a, now) {
    if (!a.isOpenDay) return { text: 'Closed today', cls: 'closed' };
    if (now >= a.closeTime) return { text: 'Closed for today', cls: 'closed' };
    const current = a.busy.find((s) => s.start <= now && s.end > now);
    if (current) return { text: `In use until ${fmtTime(current.end)}`, cls: 'busy' };
    if (now < a.openTime) return { text: `Opens at ${fmtTime(a.openTime)}`, cls: 'closed' };
    const next = a.busy.find((s) => s.start > now);
    return { text: next ? `Free until ${fmtTime(next.start)}` : 'Free for the rest of the day', cls: 'free' };
  }

  // ---------- Home ----------
  BMV.route('/', async () => {
    const college = BMV.college();
    const meta = await get('/api/meta');
    state.meta = meta;
    const { venues } = await get(`/api/colleges/${college.id}/venues`);
    const code = BMV.code(college);

    const hero = h('section', { class: 'hero' },
      h('h1', {}, `Find and book a hall at ${code}`),
      h('p', {}, 'See which halls and seminar rooms are free today, open one for its details, and send a booking request. Your college administrator approves or declines it.'));

    let board;
    if (college.status !== 'ACTIVE' || venues.length === 0) {
      board = h('div', { class: 'empty', style: 'margin-top:24px' }, h('strong', {}, 'No venues yet'), `${college.name} has not added any venues to BookMyVenue.`);
    } else {
      const avail = await Promise.all(venues.map((v) => get(`/api/colleges/${college.id}/venues/${v.id}/availability?date=${meta.today}`)));
      board = h('section', { class: 'board', 'aria-label': 'Venues today' },
        h('div', { class: 'board-head' }, h('h2', {}, 'Today'), h('span', {}, fmtDate(meta.today))),
        venues.map((v, i) => {
          const a = avail[i], st = nowState(a, meta.now);
          return h('a', { class: 'board-row', href: `#/venues/${v.id}` },
            h('div', {}, h('div', { class: 'vname' }, v.name), h('div', { class: 'vmeta' }, `Seats ${v.capacity}`)),
            strip({ openTime: a.openTime, closeTime: a.closeTime, busy: a.busy, closed: !a.isOpenDay, nowTime: a.isOpenDay ? meta.now : null, label: `${v.name} availability today. ${st.text}.` }),
            h('div', { class: 'state ' + st.cls }, st.text));
        }),
        h('div', { style: 'padding:12px 20px;border-top:1px solid var(--line-2)' }, legend()));
    }

    const steps = h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Choose your college'), h('span', {}, 'Venues are shown for one college at a time.')),
      h('li', {}, h('b', {}, 'Pick a venue'), h('span', {}, 'Check capacity, facilities, rules and free hours.')),
      h('li', {}, h('b', {}, 'Send a request'), h('span', {}, 'Log in with the account your college gave you.')),
      h('li', {}, h('b', {}, 'Track the decision'), h('span', {}, 'Your request starts as pending until the admin decides.')));

    return h('div', { class: 'wrap' }, hero, board, steps);
  });

  // ---------- Explore venues ----------
  BMV.route('/venues', async () => {
    const college = BMV.college();
    const { venues } = await get(`/api/colleges/${college.id}/venues`);
    if (college.status !== 'ACTIVE' || venues.length === 0) return noCollege();
    const types = [...new Set(venues.flatMap((v) => v.suitableEventTypes))].sort();

    const q = h('input', { type: 'search', placeholder: 'Name or facility, for example "projector"' });
    const cap = h('input', { type: 'number', min: 1, placeholder: 'For example 150' });
    const type = select([['', 'Any event'], ...types.map((t) => [t, t])], '');
    const list = h('div', { class: 'vlist' });
    const count = h('p', { class: 'muted', 'aria-live': 'polite' });

    function draw() {
      const text = q.value.trim().toLowerCase();
      const need = Number(cap.value) || 0;
      const shown = venues.filter((v) =>
        (!text || [v.name, v.location, v.description, ...v.facilities].join(' ').toLowerCase().includes(text)) &&
        v.capacity >= need && (!type.value || v.suitableEventTypes.includes(type.value)));
      count.textContent = `${shown.length} of ${venues.length} venues`;
      if (shown.length === 0) {
        list.replaceChildren(h('div', { class: 'empty', style: 'margin-top:16px' }, h('strong', {}, 'No venue matches'), 'Try a smaller capacity or a different event type.'));
        return;
      }
      list.replaceChildren(...shown.map((v) =>
        h('article', { class: 'vitem' },
          venuePic(v),
          h('div', {},
            h('h3', {}, h('a', { href: `#/venues/${v.id}` }, v.name)),
            h('div', { class: 'muted small' }, `Seats ${v.capacity}${v.location ? ' · ' + v.location : ''}`),
            h('p', { style: 'margin:8px 0 0;max-width:60ch' }, v.description),
            h('ul', { class: 'chips' }, v.facilities.slice(0, 5).map((f) => h('li', {}, f)))),
          h('a', { class: 'btn', href: `#/venues/${v.id}` }, 'View details'))));
    }
    [q, cap].forEach((i) => i.addEventListener('input', draw));
    type.addEventListener('change', draw);
    draw();

    return h('div', { class: 'wrap page' },
      h('div', { class: 'page-head' }, h('h1', {}, `Venues at ${BMV.code(college)}`), h('p', {}, 'Filter by size or event, then open a venue to check when it is free.')),
      h('div', { class: 'filters' }, field('Search', q), field('Seats needed', cap), field('Type of event', type)),
      count, list);
  });

  // ---------- Venue details ----------
  BMV.route('/venues/:id', async ({ id }, query) => {
    const college = BMV.college();
    const { venue: v } = await get(`/api/colleges/${college.id}/venues/${id}`);
    const meta = await get('/api/meta');
    state.meta = meta;

    // gallery
    const main = h('div', { class: 'main' }, venuePic(v, 0));
    const gallery = h('div', { class: 'gallery' }, main);
    if (v.images.length > 1) {
      gallery.append(h('div', { class: 'thumbs' }, v.images.map((src, i) =>
        h('button', { type: 'button', 'aria-label': `Show photo ${i + 1}`, onclick: () => main.replaceChildren(venuePic(v, i)) }, h('img', { src, alt: '' })))));
    }

    // availability checker
    const date = h('input', { type: 'date', value: query.date || meta.today, min: meta.today });
    const start = h('input', { type: 'time', value: query.start || '', step: 900 });
    const end = h('input', { type: 'time', value: query.end || '', step: 900 });
    const result = h('div', { 'aria-live': 'polite' });
    const cta = h('div', { class: 'stack' });
    let last = null;

    function pickState() {
      if (start.value && end.value && last && last.isOpenDay) {
        if (end.value <= start.value) return { bad: 'The end time must be after the start time.' };
        if (start.value < last.openTime || end.value > last.closeTime) return { bad: `This venue can be booked between ${fmtTime(last.openTime)} and ${fmtTime(last.closeTime)}.` };
        const clash = last.busy.find((s) => s.start < end.value && s.end > start.value);
        if (clash) return { bad: `That time overlaps a slot that is taken (${range(clash.start, clash.end)}).` };
        return { ok: `${range(start.value, end.value)} is free.`, pick: { start: start.value, end: end.value } };
      }
      return {};
    }

    function drawCta() {
      cta.replaceChildren();
      const u = state.user;
      const p = pickState();
      const qs = new URLSearchParams({ date: date.value });
      if (start.value) qs.set('start', start.value);
      if (end.value) qs.set('end', end.value);
      const target = `/book/${v.id}?${qs}`;
      if (!u) {
        cta.append(h('a', { class: 'btn primary', href: `#/login?next=${encodeURIComponent(target)}` }, 'Log in to request this venue'),
          h('p', { class: 'hint' }, 'Only authorized users of this college can send requests. Anyone can look at venues.'));
      } else if (u.role === 'BOOKER' && u.collegeId === v.collegeId) {
        cta.append(h('a', { class: 'btn primary', href: `#${target}`, 'aria-disabled': p.bad ? 'true' : null }, 'Request this venue'));
      } else if (u.role === 'BOOKER') {
        cta.append(h('div', { class: 'notice warn' }, `Your account belongs to ${u.collegeName}. You can only request venues at your own college.`));
      } else {
        cta.append(h('div', { class: 'notice' }, 'Administrators manage venues and bookings from the admin pages.'));
      }
    }

    async function check() {
      if (!date.value) return;
      try {
        last = await get(`/api/colleges/${college.id}/venues/${v.id}/availability?date=${date.value}`);
      } catch (err) {
        result.replaceChildren(h('div', { class: 'form-error' }, err.message));
        return;
      }
      const isToday = date.value === meta.today;
      if (!last.isOpenDay) {
        result.replaceChildren(h('div', { class: 'notice warn' }, `${v.name} is closed on ${BMV.DAYS[new Date(date.value + 'T00:00:00Z').getUTCDay()]}days.`), strip({ openTime: last.openTime, closeTime: last.closeTime, closed: true, label: 'Closed' }));
      } else {
        const p = pickState();
        result.replaceChildren(...[
          strip({ openTime: last.openTime, closeTime: last.closeTime, busy: last.busy, pick: p.pick, nowTime: isToday ? meta.now : null, label: `Availability on ${fmtDate(date.value)}` }),
          legend(),
          p.bad ? h('div', { class: 'form-error', style: 'margin-top:12px' }, p.bad) : null,
          p.ok ? h('div', { class: 'notice', style: 'margin-top:12px' }, p.ok) : null,
          last.busy.length
            ? h('ul', { class: 'small', style: 'padding-left:18px' }, last.busy.map((s) => h('li', {}, `${range(s.start, s.end)}: ${s.kind === 'booked' ? 'booked' : 'not available'}`)))
            : h('p', { class: 'small muted', style: 'margin-top:10px' }, `Nothing is booked between ${fmtTime(last.openTime)} and ${fmtTime(last.closeTime)}.`)
        ].filter(Boolean));
      }
      drawCta();
    }
    [date, start, end].forEach((i) => i.addEventListener('change', check));
    check();

    const dl = (pairs) => h('dl', { class: 'specs' }, pairs.map(([k, val]) => h('div', {}, h('dt', {}, k), h('dd', {}, val))));
    const openDays = v.openDays.map((d) => BMV.DAYS[d]).join(', ');

    return h('div', { class: 'wrap page' },
      h('p', { class: 'small' }, h('a', { href: '#/venues' }, 'All venues')),
      h('div', { class: 'cols' },
        h('div', {},
          h('h1', {}, v.name), gallery,
          dl([['Seats', v.capacity], ['Where', v.location || 'Not added yet'], ['Bookable hours', range(v.openTime, v.closeTime)], ['Open on', openDays]]),
          h('p', { style: 'max-width:65ch' }, v.description || 'No description has been added yet.'),
          h('h3', {}, 'Facilities'),
          v.facilities.length ? h('ul', { class: 'chips' }, v.facilities.map((f) => h('li', {}, f))) : h('p', { class: 'muted' }, 'None listed.'),
          h('h3', { style: 'margin-top:24px' }, 'Suitable for'),
          v.suitableEventTypes.length ? h('ul', { class: 'chips' }, v.suitableEventTypes.map((f) => h('li', {}, f))) : h('p', { class: 'muted' }, 'Any event.'),
          h('h3', { style: 'margin-top:24px' }, 'Rules'),
          h('p', { class: 'rules', style: 'max-width:65ch' }, v.rules || 'No special rules.')),
        h('aside', { class: 'panel', 'aria-label': 'Check availability' },
          h('h2', {}, 'Check availability'),
          field('Date', date),
          h('div', { class: 'grid2' }, field('From', start), field('To', end)),
          result,
          h('div', { style: 'margin-top:16px' }, cta))));
  });

  // ---------- Login ----------
  function loginPage(admin) {
    return async (_p, query) => {
      if (state.user) return (BMV.go(state.user.role === 'ADMIN' ? '/admin' : '/dashboard'), h('div', {}));
      const email = h('input', { type: 'email', autocomplete: 'username', required: true });
      const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
      const err = errorBox();
      const btn = h('button', { class: 'primary', type: 'submit' }, 'Log in');
      const form = h('form', { novalidate: true }, err, field('Email', email), field('Password', pass), btn);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        err.hidden = true;
        busy(btn, async () => {
          try {
            const { user } = await post('/api/auth/login', { email: email.value, password: pass.value });
            BMV.afterLogin(user);
            const next = query.next && query.next.startsWith('/') && !query.next.startsWith('//') ? query.next : null;
            if (user.role === 'ADMIN') BMV.go(next && next.startsWith('/admin') ? next : '/admin');
            else BMV.go(next && !next.startsWith('/admin') ? next : '/dashboard');
          } catch (e2) { showError(err, e2.message); }
        });
      });
      return h('div', { class: 'wrap page narrow' },
        h('h1', {}, admin ? 'Admin log in' : 'Log in'),
        h('p', { class: 'muted' }, admin ? 'For college administrators. You will manage only your own college.' : 'Use the account your college administrator created for you. There is no public sign-up.'),
        h('div', { class: 'panel' }, form),
        h('p', { class: 'small muted', style: 'margin-top:14px' }, admin ? h('span', {}, 'Not an administrator? ', h('a', { href: '#/login' }, 'Go to booker log in')) : h('span', {}, 'College administrator? ', h('a', { href: '#/admin/login' }, 'Admin log in')), '. Forgotten your password? Ask your college administrator to reset it.'));
    };
  }
  BMV.route('/login', loginPage(false));
  BMV.route('/admin/login', loginPage(true));
})();
