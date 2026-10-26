// College Admin screens. Everything here works inside the admin's own college;
// the server enforces that no matter what this page asks for.
(function () {
  const { h, get, post, put, del, field, select, errorBox, showError, busy, strip, legend, fmtDate, fmtDateShort, range, fmtStamp, badge, toast } = BMV;
  const state = BMV.state;
  const A = 'ADMIN';

  const th = (cols) => h('thead', {}, h('tr', {}, cols.map((t) => h('th', { scope: 'col' }, t))));
  const emptyBox = (title, text) => h('div', { class: 'empty' }, h('strong', {}, title), text);
  const head = (title, text, ...actions) => h('div', { class: 'page-head row between' }, h('div', {}, h('h1', {}, title), text ? h('p', {}, text) : null), actions.length ? h('div', { class: 'row' }, actions) : null);
  const page = (...kids) => h('div', { class: 'wrap page' }, kids);

  // ---------- approve / reject / cancel with an optional note ----------
  function decide(booking, status, after) {
    const verbs = { APPROVED: ['Approve', 'Approve this request?'], REJECTED: ['Reject', 'Reject this request?'], CANCELLED: ['Cancel booking', 'Cancel this booking?'] };
    const [label, title] = verbs[status];
    const note = h('textarea', { maxlength: 500, placeholder: status === 'APPROVED' ? 'Optional, for example "Please collect the keys from the office."' : 'Optional, but helpful: tell them why.' });
    const err = errorBox();
    BMV.dialog(title, h('div', {},
      h('p', {}, h('b', {}, booking.eventName), ` by ${booking.bookerName}, ${booking.venueName}, ${fmtDateShort(booking.date)}, ${range(booking.startTime, booking.endTime)}.`),
      err, field('Note for the booker', note)), [
      { label: 'Go back' },
      {
        label, primary: status === 'APPROVED', danger: status !== 'APPROVED',
        onclick: async (close) => {
          err.hidden = true;
          try {
            await post(`/api/admin/bookings/${booking.id}/status`, { status, note: note.value });
            close();
            toast(`${booking.requestId} ${BMV.STATUS[status].toLowerCase()}.`);
            after();
          } catch (e) { showError(err, e.message); }
        },
      },
    ]);
  }

  function actionButtons(b, after) {
    const mk = (label, cls, status) => h('button', { class: `small ${cls}`, type: 'button', onclick: (e) => { e.stopPropagation(); decide(b, status, after); } }, label);
    if (b.status === 'PENDING') return h('div', { class: 'actions' }, mk('Approve', 'ok', 'APPROVED'), mk('Reject', 'danger', 'REJECTED'));
    if (b.status === 'APPROVED') return h('div', { class: 'actions' }, mk('Cancel', 'danger', 'CANCELLED'));
    return null;
  }

  function bookingsTable(list, after) {
    if (!list.length) return null;
    return h('div', { class: 'tablewrap' }, h('table', {}, th(['Request', 'Event', 'Venue', 'When', 'Booker', 'Status', '']),
      h('tbody', {}, list.map((b) => {
        const row = h('tr', { class: 'clickable' },
          h('td', {}, h('a', { class: 'reqid', href: `#/admin/bookings/${b.id}` }, b.requestId)),
          h('td', {}, b.eventName, h('div', { class: 'sub' }, `${b.eventType}, ${b.participants} people`)),
          h('td', {}, b.venueName),
          h('td', {}, fmtDateShort(b.date), h('div', { class: 'sub' }, range(b.startTime, b.endTime))),
          h('td', {}, b.bookerName, h('div', { class: 'sub' }, b.organization)),
          h('td', {}, badge(b.status)),
          h('td', {}, actionButtons(b, after)));
        row.addEventListener('click', (e) => { if (!['A', 'BUTTON'].includes(e.target.tagName)) BMV.go(`/admin/bookings/${b.id}`); });
        return row;
      }))));
  }

  // ---------- Overview ----------
  BMV.route('/admin', async () => {
    const o = await get('/api/admin/overview');
    const refresh = () => BMV.go('/admin');
    return page(
      head(`${BMV.code(o.college)} dashboard`, `Requests and venues for ${o.college.name}.`),
      h('div', { class: 'statline' },
        h('div', {}, h('strong', {}, o.counts.PENDING), h('span', {}, 'Waiting for a decision')),
        h('div', {}, h('strong', {}, o.counts.APPROVED), h('span', {}, 'Approved')),
        h('div', {}, h('strong', {}, o.venues), h('span', {}, 'Active venues')),
        h('div', {}, h('strong', {}, o.bookers), h('span', {}, 'Authorized users'))),
      h('h2', { style: 'margin-top:28px' }, 'Needs a decision'),
      bookingsTable(o.pending, refresh) || emptyBox('All caught up', 'There are no pending requests.'),
      o.counts.PENDING > o.pending.length ? h('p', { style: 'margin-top:8px' }, h('a', { href: '#/admin/bookings?status=PENDING' }, `See all ${o.counts.PENDING} pending requests`)) : null,
      h('h2', { style: 'margin-top:28px' }, 'Coming up'),
      bookingsTable(o.upcoming, refresh) || emptyBox('Nothing scheduled', 'Approved bookings from today onwards will appear here.'));
  }, A);

  // ---------- Bookings list ----------
  BMV.route('/admin/bookings', async (_p, query) => {
    const [{ venues }] = await Promise.all([get('/api/admin/venues')]);
    const status = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(query.status) ? query.status : '';
    const params = new URLSearchParams();
    for (const k of ['status', 'venueId', 'from', 'to']) if (query[k]) params.set(k, query[k]);
    const { bookings } = await get('/api/admin/bookings?' + params);

    const nav = (extra) => BMV.go('/admin/bookings?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...query, ...extra }).filter(([, v]) => v))));
    const venue = select([['', 'All venues'], ...venues.map((v) => [v.id, v.name])], query.venueId || '');
    const from = h('input', { type: 'date', value: query.from || '' });
    const to = h('input', { type: 'date', value: query.to || '' });
    venue.addEventListener('change', () => nav({ venueId: venue.value }));
    from.addEventListener('change', () => nav({ from: from.value }));
    to.addEventListener('change', () => nav({ to: to.value }));
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, ['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) =>
      h('button', { role: 'tab', type: 'button', 'aria-selected': s === status ? 'true' : 'false', onclick: () => nav({ status: s }) }, s ? BMV.STATUS[s] : 'All')));

    return page(head('Bookings', 'Every request for your college. Approve, reject or cancel from here.'), tabs,
      h('div', { class: 'filters' }, field('Venue', venue), field('From date', from), field('To date', to)),
      h('p', { class: 'muted small' }, `${bookings.length} ${bookings.length === 1 ? 'request' : 'requests'}${bookings.length === 500 ? ' (showing the latest 500)' : ''}`),
      bookingsTable(bookings, () => BMV.go('/admin/bookings?' + params)) || emptyBox('No requests found', 'Try a different status or date range.'));
  }, A);

  // ---------- One booking ----------
  BMV.route('/admin/bookings/:id', async ({ id }) => {
    const { booking: b } = await get(`/api/admin/bookings/${id}`);
    const a = await get(`/api/colleges/${state.user.collegeId}/venues/${b.venueId}/availability?date=${b.date}`).catch(() => null);
    const others = a ? a.busy : [];
    const after = () => BMV.go(`/admin/bookings/${b.id}`);
    return h('div', { class: 'wrap page' },
      h('p', { class: 'small' }, h('a', { href: '#/admin/bookings' }, 'All bookings')),
      h('div', { class: 'cols' },
        h('div', {},
          h('h1', {}, b.eventName),
          h('p', {}, h('span', { class: 'reqid' }, b.requestId), ' ', badge(b.status)),
          b.adminNote ? h('div', { class: 'notice' }, h('b', {}, 'Your note: '), b.adminNote) : null,
          h('div', { class: 'panel' }, h('dl', { class: 'kv' },
            h('dt', {}, 'Venue'), h('dd', {}, b.venueName),
            h('dt', {}, 'Date'), h('dd', {}, fmtDate(b.date)),
            h('dt', {}, 'Time'), h('dd', {}, range(b.startTime, b.endTime)),
            h('dt', {}, 'Event type'), h('dd', {}, b.eventType),
            h('dt', {}, 'Expected participants'), h('dd', {}, b.participants),
            h('dt', {}, 'Department / organization'), h('dd', {}, b.organization),
            h('dt', {}, 'Purpose'), h('dd', {}, b.purpose),
            h('dt', {}, 'Additional requirements'), h('dd', {}, b.requirements || 'None'),
            h('dt', {}, 'Requested by'), h('dd', {}, `${b.bookerName} (${b.bookerEmail})`),
            h('dt', {}, 'Submitted'), h('dd', {}, fmtStamp(b.createdAt)),
            h('dt', {}, 'Last updated'), h('dd', {}, fmtStamp(b.updatedAt)))),
          h('div', { style: 'margin-top:16px' }, actionButtons(b, after) || h('p', { class: 'muted' }, 'This request is closed, so it cannot be changed.'))),
        h('aside', { class: 'panel' },
          h('h2', {}, 'That day'),
          a && a.isOpenDay
            ? h('div', {}, strip({ openTime: a.openTime, closeTime: a.closeTime, busy: others, pick: { start: b.startTime, end: b.endTime }, label: 'Availability' }), legend(),
              h('p', { class: 'small muted', style: 'margin-top:10px' }, 'The highlighted box is this request. Approved bookings and blocked times are shown in the strip.'))
            : h('p', { class: 'muted' }, a ? 'The venue is closed on this day.' : 'Availability could not be loaded.'))));
  }, A);

  // ---------- Venues list ----------
  BMV.route('/admin/venues', async () => {
    const { venues } = await get('/api/admin/venues');
    return page(
      head('Venues', 'The halls and rooms people can request at your college.', h('a', { class: 'btn primary', href: '#/admin/venues/new' }, 'Add venue')),
      venues.length ? h('div', { class: 'tablewrap' }, h('table', {}, th(['Venue', 'Seats', 'Bookable hours', 'Photos', 'Status', '']),
        h('tbody', {}, venues.map((v) => h('tr', {},
          h('td', {}, h('a', { href: `#/admin/venues/${v.id}` }, h('b', {}, v.name)), h('div', { class: 'sub' }, v.location)),
          h('td', {}, v.capacity),
          h('td', {}, range(v.openTime, v.closeTime), h('div', { class: 'sub' }, v.openDays.map((d) => BMV.DAYS[d]).join(', '))),
          h('td', {}, v.images.length),
          h('td', {}, badge(v.status)),
          h('td', {}, h('a', { class: 'btn small', href: `#/admin/venues/${v.id}` }, 'Edit'))))))) : emptyBox('No venues yet', 'Add your first venue so people can request it.'));
  }, A);

  // ---------- Add / edit venue ----------
  async function venueForm(id) {
    const meta = state.meta || (await get('/api/meta'));
    const v = id ? (await get(`/api/admin/venues/${id}`)).venue : { name: '', description: '', location: '', capacity: '', facilities: [], suitableEventTypes: [], rules: '', openTime: '08:00', closeTime: '18:00', openDays: [1, 2, 3, 4, 5, 6], status: 'ACTIVE', images: [] };
    const f = {
      name: h('input', { type: 'text', value: v.name, maxlength: 100, required: true }),
      capacity: h('input', { type: 'number', value: v.capacity, min: 1, max: 5000, required: true }),
      location: h('input', { type: 'text', value: v.location, maxlength: 200 }),
      description: h('textarea', { maxlength: 2000 }, v.description),
      facilities: h('textarea', { maxlength: 1500 }, v.facilities.join('\n')),
      rules: h('textarea', { maxlength: 2000 }, v.rules),
      openTime: h('input', { type: 'time', value: v.openTime, required: true }),
      closeTime: h('input', { type: 'time', value: v.closeTime, required: true }),
      status: select([['ACTIVE', 'Active (people can request it)'], ['INACTIVE', 'Hidden (not shown to the public)']], v.status),
    };
    const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((d) => h('input', { type: 'checkbox', value: d, checked: v.openDays.includes(d) }));
    const typeBoxes = meta.eventTypes.map((t) => h('input', { type: 'checkbox', value: t, checked: v.suitableEventTypes.includes(t) }));
    const err = errorBox();
    const save = h('button', { class: 'primary', type: 'submit' }, id ? 'Save changes' : 'Add venue');

    const form = h('form', { novalidate: true }, err,
      field('Name', f.name),
      h('div', { class: 'grid2' }, field('Seats', f.capacity), field('Where on campus', f.location, 'For example "Main building, 2nd floor".')),
      field('Description', f.description),
      field('Facilities', f.facilities, 'One per line, for example "Projector & screen".'),
      h('div', { class: 'field' }, h('label', {}, 'Suitable for'), h('div', { class: 'checks' }, typeBoxes.map((b, i) => h('label', {}, b, meta.eventTypes[i])))),
      field('Rules', f.rules, 'One per line. Shown to people before they book.'),
      h('div', { class: 'grid2' }, field('Bookable from', f.openTime), field('Bookable until', f.closeTime)),
      h('div', { class: 'field' }, h('label', {}, 'Open on'), h('div', { class: 'checks' }, dayBoxes.map((b) => h('label', {}, b, BMV.DAYS[b.value])))),
      field('Visibility', f.status),
      h('div', { class: 'row' }, save, h('a', { class: 'btn', href: '#/admin/venues' }, 'Back')));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.hidden = true;
      const payload = {
        name: f.name.value, capacity: f.capacity.value, location: f.location.value, description: f.description.value,
        facilities: f.facilities.value.split('\n'), suitableEventTypes: typeBoxes.filter((b) => b.checked).map((b) => b.value),
        rules: f.rules.value, openTime: f.openTime.value, closeTime: f.closeTime.value,
        openDays: dayBoxes.filter((b) => b.checked).map((b) => Number(b.value)), status: f.status.value,
      };
      busy(save, async () => {
        try {
          const res = id ? await put(`/api/admin/venues/${id}`, payload) : await post('/api/admin/venues', payload);
          toast(id ? 'Venue saved.' : 'Venue added. You can now add photos.');
          BMV.go(`/admin/venues/${res.venue.id}`);
        } catch (e2) { showError(err, e2.message); }
      });
    });

    return { v, form };
  }

  function photosPanel(v) {
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp' });
    const err = errorBox();
    const upload = h('button', { type: 'button', class: 'primary small' }, 'Upload photo');
    upload.addEventListener('click', () => {
      err.hidden = true;
      const pick = file.files[0];
      if (!pick) return showError(err, 'Choose a photo first.');
      if (pick.size > 2 * 1024 * 1024) return showError(err, 'That photo is larger than 2 MB. Please choose a smaller one.');
      busy(upload, async () => {
        try { await BMV.uploadImage(`/api/admin/venues/${v.id}/images`, pick); toast('Photo added.'); BMV.go(`/admin/venues/${v.id}`); }
        catch (e) { showError(err, e.message); }
      });
    });
    return h('section', { class: 'panel' },
      h('h2', {}, 'Photos'),
      v.images.length ? h('div', { class: 'row', style: 'align-items:flex-start' }, v.images.map((src, i) =>
        h('div', { style: 'width:150px' }, h('div', { class: 'pic', style: 'aspect-ratio:4/3' }, h('img', { src, alt: `${v.name}, photo ${i + 1}` })),
          h('button', { type: 'button', class: 'small danger', style: 'margin-top:6px;width:100%', onclick: async () => {
            if (!(await BMV.confirm('Remove this photo?', 'The photo will be deleted.', 'Remove photo', true))) return;
            try { await del(`/api/admin/venues/${v.id}/images/${i}`); toast('Photo removed.'); BMV.go(`/admin/venues/${v.id}`); } catch (e) { toast(e.message, 'error'); }
          } }, 'Remove')))) : h('p', { class: 'muted' }, 'No photos yet. Visitors see a coloured placeholder until you add one.'),
      h('div', { style: 'margin-top:14px' }, err, field('Add a photo', file, 'JPG, PNG, GIF or WebP, up to 2 MB. Up to 8 photos. The first one is the main photo.'), upload));
  }

  BMV.route('/admin/venues/new', async () => {
    const { form } = await venueForm(null);
    return h('div', { class: 'wrap page narrow' }, h('p', { class: 'small' }, h('a', { href: '#/admin/venues' }, 'All venues')), h('h1', {}, 'Add venue'), h('div', { class: 'panel' }, form));
  }, A);

  BMV.route('/admin/venues/:id', async ({ id }) => {
    const { v, form } = await venueForm(id);
    const remove = h('button', { type: 'button', class: 'danger' }, 'Delete venue');
    remove.addEventListener('click', async () => {
      if (!(await BMV.confirm('Delete this venue?', 'If the venue has booking history it is hidden instead of erased, so past records stay correct.', 'Delete venue', true))) return;
      try {
        const r = await del(`/api/admin/venues/${v.id}`);
        toast(r.removed ? 'Venue deleted.' : 'The venue has booking history, so it was hidden instead.');
        BMV.go('/admin/venues');
      } catch (e) { toast(e.message, 'error'); }
    });
    return h('div', { class: 'wrap page narrow' },
      h('p', { class: 'small' }, h('a', { href: '#/admin/venues' }, 'All venues')),
      h('div', { class: 'row between' }, h('h1', {}, v.name), badge(v.status)),
      h('div', { class: 'panel' }, form),
      photosPanel(v),
      h('p', { style: 'margin-top:16px' }, h('a', { href: `#/admin/availability?venue=${v.id}` }, 'Block dates or hours for this venue'), ' · ', h('a', { href: `#/venues/${v.id}` }, 'See the public page')),
      h('p', {}, remove));
  }, A);

  // ---------- Availability (blocked dates and hours) ----------
  BMV.route('/admin/availability', async (_p, query) => {
    const meta = await get('/api/meta');
    const { venues } = await get('/api/admin/venues');
    if (!venues.length) return page(head('Availability'), emptyBox('No venues yet', 'Add a venue first.'));
    const current = venues.find((v) => String(v.id) === query.venue) || venues[0];
    const { blocks } = await get(`/api/admin/venues/${current.id}/blocks`);

    const picker = select(venues.map((v) => [v.id, v.name]), current.id);
    picker.addEventListener('change', () => BMV.go(`/admin/availability?venue=${picker.value}`));

    const date = h('input', { type: 'date', min: meta.today, required: true });
    const allDay = h('input', { type: 'checkbox', checked: true });
    const start = h('input', { type: 'time', value: '09:00' });
    const end = h('input', { type: 'time', value: '17:00' });
    const reason = h('input', { type: 'text', maxlength: 200, placeholder: 'For example "Exams" or "Floor polishing"' });
    const timeRow = h('div', { class: 'grid2', hidden: true }, field('From', start), field('To', end));
    allDay.addEventListener('change', () => { timeRow.hidden = allDay.checked; });
    const err = errorBox();
    const add = h('button', { class: 'primary', type: 'submit' }, 'Block this time');
    const form = h('form', { novalidate: true }, err, field('Date', date), h('div', { class: 'field' }, h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, allDay, 'Block the whole day')), timeRow, field('Reason', reason, 'Only you see the reason. Visitors just see the time as not available.'), add);
    form.addEventListener('submit', (e) => {
      e.preventDefault(); err.hidden = true;
      busy(add, async () => {
        try {
          await post(`/api/admin/venues/${current.id}/blocks`, { date: date.value, allDay: allDay.checked, startTime: start.value, endTime: end.value, reason: reason.value });
          toast('Time blocked.'); BMV.go(`/admin/availability?venue=${current.id}`);
        } catch (e2) { showError(err, e2.message); }
      });
    });

    return page(
      head('Availability', 'Block dates or hours when a venue cannot be booked, such as exams, maintenance or holidays.'),
      h('div', { class: 'filters' }, field('Venue', picker)),
      h('p', { class: 'muted small' }, `${current.name} is normally bookable ${range(current.openTime, current.closeTime)} on ${current.openDays.map((d) => BMV.DAYS[d]).join(', ')}. `, h('a', { href: `#/admin/venues/${current.id}` }, 'Change regular hours')),
      h('div', { class: 'cols' },
        h('div', {}, h('h2', {}, 'Blocked times'),
          blocks.length ? h('div', { class: 'tablewrap' }, h('table', {}, th(['Date', 'Time', 'Reason', '']),
            h('tbody', {}, blocks.map((b) => h('tr', {},
              h('td', {}, fmtDate(b.date)),
              h('td', {}, b.startTime === '00:00' && b.endTime === '23:59' ? 'All day' : range(b.startTime, b.endTime)),
              h('td', {}, b.reason || ''),
              h('td', {}, h('button', { class: 'small danger', type: 'button', onclick: async () => {
                try { await del(`/api/admin/blocks/${b.id}`); toast('Block removed.'); BMV.go(`/admin/availability?venue=${current.id}`); } catch (e) { toast(e.message, 'error'); }
              } }, 'Remove'))))))) : emptyBox('Nothing blocked', 'This venue is open whenever its regular hours allow.')),
        h('aside', { class: 'panel' }, h('h2', {}, 'Block a time'), form)));
  }, A);

  // ---------- Authorized users (bookers) ----------
  function showSecret(title, intro, password) {
    BMV.dialog(title, h('div', {}, h('p', {}, intro), h('p', { class: 'secret' }, password), h('p', { class: 'hint' }, 'This is shown only once. Copy it now and send it to the person privately. They can change it after logging in.')), [{ label: 'Done', primary: true }]);
  }

  BMV.route('/admin/bookers', async () => {
    const { bookers, maxBookers } = await get('/api/admin/bookers');
    const active = bookers.filter((b) => b.status === 'ACTIVE').length;
    const refresh = () => BMV.go('/admin/bookers');

    function addDialog() {
      const name = h('input', { type: 'text', maxlength: 100 });
      const email = h('input', { type: 'email', autocomplete: 'off' });
      const err = errorBox();
      BMV.dialog('Add authorized user', h('div', {}, err, field('Full name', name), field('Email', email, 'They will log in with this email.')), [
        { label: 'Cancel' },
        { label: 'Create account', primary: true, onclick: async (close) => {
          err.hidden = true;
          try {
            const r = await post('/api/admin/bookers', { name: name.value, email: email.value });
            close(); showSecret('Account created', `Login for ${r.booker.name} (${r.booker.email}). Their temporary password:`, r.password); refresh();
          } catch (e) { showError(err, e.message); }
        } },
      ]);
    }

    return page(
      head('Authorized users', `Only these people can request venues at your college. There is no public sign-up. ${active} of ${maxBookers} places used.`,
        h('button', { class: 'primary', type: 'button', disabled: active >= maxBookers, onclick: addDialog }, 'Add user')),
      active >= maxBookers ? h('div', { class: 'notice warn' }, 'All places are used. Deactivate a user to add someone new.') : null,
      bookers.length ? h('div', { class: 'tablewrap' }, h('table', {}, th(['Name', 'Email', 'Status', '']),
        h('tbody', {}, bookers.map((b) => h('tr', {},
          h('td', {}, h('b', {}, b.name)), h('td', {}, b.email), h('td', {}, badge(b.status)),
          h('td', {}, h('div', { class: 'actions' },
            h('button', { class: 'small', type: 'button', onclick: async () => {
              if (!(await BMV.confirm('Reset password?', `${b.name} will be logged out and get a new temporary password.`, 'Reset password'))) return;
              try { const r = await post(`/api/admin/bookers/${b.id}/reset-password`); showSecret('New password', `New temporary password for ${b.name}:`, r.password); } catch (e) { toast(e.message, 'error'); }
            } }, 'Reset password'),
            h('button', { class: 'small ' + (b.status === 'ACTIVE' ? 'danger' : 'ok'), type: 'button', onclick: async () => {
              const next = b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
              if (next === 'INACTIVE' && !(await BMV.confirm('Deactivate this user?', `${b.name} will be logged out and cannot log in or send requests. Their past requests are kept.`, 'Deactivate', true))) return;
              try { await put(`/api/admin/bookers/${b.id}`, { status: next }); toast(next === 'ACTIVE' ? 'User reactivated.' : 'User deactivated.'); refresh(); } catch (e) { toast(e.message, 'error'); }
            } }, b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate')))))))) : emptyBox('No authorized users yet', 'Add the people who should be able to request venues.'));
  }, A);

  // ---------- Settings ----------
  BMV.route('/admin/settings', async () => {
    const { college } = await get('/api/admin/settings');
    const u = state.user;
    const location = h('input', { type: 'text', value: college.location, maxlength: 200 });
    const description = h('textarea', { maxlength: 1000 }, college.description);
    const err = errorBox();
    const save = h('button', { class: 'primary', type: 'submit' }, 'Save changes');
    const form = h('form', { novalidate: true }, err, field('Location', location), field('Description', description, 'Shown to visitors in the college list.'), save);
    form.addEventListener('submit', (e) => {
      e.preventDefault(); err.hidden = true;
      busy(save, async () => { try { await put('/api/admin/settings', { location: location.value, description: description.value }); toast('Settings saved.'); } catch (e2) { showError(err, e2.message); } });
    });
    return h('div', { class: 'wrap page narrow' },
      head('Settings'),
      h('section', { class: 'panel' }, h('h2', {}, 'College'),
        h('dl', { class: 'kv', style: 'margin-bottom:16px' }, h('dt', {}, 'Name'), h('dd', {}, college.name), h('dt', {}, 'Code'), h('dd', {}, college.id.toUpperCase())), form),
      h('section', { class: 'panel' }, h('h2', {}, 'My account'),
        h('dl', { class: 'kv', style: 'margin-bottom:16px' }, h('dt', {}, 'Name'), h('dd', {}, u.name), h('dt', {}, 'Email'), h('dd', {}, u.email)),
        h('button', { type: 'button', onclick: BMV.changePassword }, 'Change password')));
  }, A);
})();
