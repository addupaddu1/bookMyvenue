// Booker screens: Dashboard, Booking Form + summary, My Requests, Booking Details.
(function () {
  const { h, get, post, field, select, errorBox, showError, busy, strip, legend, fmtDate, fmtDateShort, fmtTime, range, fmtStamp, badge } = BMV;
  const state = BMV.state;

  // ---------- change password (used by bookers and admins) ----------
  BMV.changePassword = function () {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const next = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = errorBox();
    const body = h('div', {}, err, field('Current password', cur), field('New password', next, 'At least 8 characters.'));
    BMV.dialog('Change password', body, [
      { label: 'Cancel' },
      {
        label: 'Change password', primary: true,
        onclick: async (close) => {
          err.hidden = true;
          try {
            await post('/api/auth/password', { current: cur.value, next: next.value });
            close();
            state.user = null;
            BMV.renderChrome();
            BMV.toast('Password changed. Please log in again.');
            BMV.go('/login');
          } catch (e) { showError(err, e.message); }
        },
      },
    ]);
  };

  const when = (b) => `${fmtDate(b.date)}, ${range(b.startTime, b.endTime)}`;
  const isUpcoming = (b, today) => b.date >= today && (b.status === 'APPROVED' || b.status === 'PENDING');

  function bookingTable(list, today) {
    if (list.length === 0) return null;
    return h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Request', 'Event', 'Venue', 'When', 'Status'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, list.map((b) => {
        const row = h('tr', { class: 'clickable' },
          h('td', {}, h('a', { href: `#/my-bookings/${b.id}`, class: 'reqid' }, b.requestId)),
          h('td', {}, b.eventName, h('div', { class: 'sub' }, b.eventType)),
          h('td', {}, b.venueName),
          h('td', {}, fmtDateShort(b.date), h('div', { class: 'sub' }, range(b.startTime, b.endTime))),
          h('td', {}, badge(b.status)));
        row.addEventListener('click', (e) => { if (e.target.tagName !== 'A') BMV.go(`/my-bookings/${b.id}`); });
        return row;
      }))));
  }

  // ---------- Dashboard ----------
  BMV.route('/dashboard', async () => {
    const u = state.user;
    const meta = await get('/api/meta');
    state.meta = meta;
    const { bookings } = await get('/api/bookings');
    const upcoming = bookings.filter((b) => b.status === 'APPROVED' && b.date >= meta.today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const pending = bookings.filter((b) => b.status === 'PENDING' && b.date >= meta.today);
    const count = (s) => bookings.filter((b) => b.status === s).length;

    return h('div', { class: 'wrap page' },
      h('div', { class: 'page-head row between' },
        h('div', {}, h('h1', {}, `Hello, ${u.name.split(' ')[0]}`), h('p', {}, `Your requests for venues at ${u.collegeName}.`)),
        h('a', { class: 'btn primary', href: '#/venues' }, 'Request a venue')),
      h('div', { class: 'statline' },
        h('div', {}, h('strong', {}, upcoming.length), h('span', {}, 'Upcoming approved')),
        h('div', {}, h('strong', {}, pending.length), h('span', {}, 'Waiting for a decision')),
        h('div', {}, h('strong', {}, count('REJECTED')), h('span', {}, 'Rejected')),
        h('div', {}, h('strong', {}, bookings.length), h('span', {}, 'All requests'))),
      h('div', { class: 'cols', style: 'margin-top:24px' },
        h('div', {},
          h('h2', {}, 'Upcoming bookings'),
          upcoming.length ? bookingTable(upcoming, meta.today) : h('div', { class: 'empty' }, h('strong', {}, 'Nothing booked yet'), 'Approved bookings will appear here.'),
          h('h2', { style: 'margin-top:28px' }, 'Pending requests'),
          pending.length ? bookingTable(pending, meta.today) : h('div', { class: 'empty' }, h('strong', {}, 'No pending requests'), 'Requests waiting for the admin will appear here.'),
          h('p', { style: 'margin-top:16px' }, h('a', { href: '#/my-bookings' }, 'See all my requests'))),
        h('aside', { class: 'panel' },
          h('h2', {}, 'My profile'),
          h('dl', { class: 'kv', style: 'grid-template-columns:90px 1fr' },
            h('dt', {}, 'Name'), h('dd', {}, u.name),
            h('dt', {}, 'Email'), h('dd', {}, u.email),
            h('dt', {}, 'College'), h('dd', {}, u.collegeName),
            h('dt', {}, 'Role'), h('dd', {}, 'Authorized booker')),
          h('p', { style: 'margin-top:16px' }, h('button', { type: 'button', class: 'small', onclick: BMV.changePassword }, 'Change password')))));
  }, 'BOOKER');

  // ---------- My requests ----------
  BMV.route('/my-bookings', async (_p, query) => {
    const meta = await get('/api/meta');
    const { bookings } = await get('/api/bookings');
    const filter = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(query.status) ? query.status : 'ALL';
    const shown = filter === 'ALL' ? bookings : bookings.filter((b) => b.status === filter);
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) =>
      h('button', { role: 'tab', type: 'button', 'aria-selected': s === filter ? 'true' : 'false', onclick: () => BMV.go('/my-bookings' + (s === 'ALL' ? '' : '?status=' + s)) },
        `${s === 'ALL' ? 'All' : BMV.STATUS[s]} (${s === 'ALL' ? bookings.length : bookings.filter((b) => b.status === s).length})`)));
    return h('div', { class: 'wrap page' },
      h('div', { class: 'page-head row between' }, h('h1', {}, 'My booking requests'), h('a', { class: 'btn primary', href: '#/venues' }, 'Request a venue')),
      tabs,
      bookingTable(shown, meta.today) || h('div', { class: 'empty' }, h('strong', {}, filter === 'ALL' ? 'No requests yet' : 'Nothing here'), filter === 'ALL' ? 'Open a venue and choose "Request this venue" to send your first request.' : 'No requests have this status.'));
  }, 'BOOKER');

  // ---------- Booking details & status ----------
  BMV.route('/my-bookings/:id', async ({ id }, query) => {
    const meta = await get('/api/meta');
    const { booking: b } = await get(`/api/bookings/${id}`);
    const canCancel = ['PENDING', 'APPROVED'].includes(b.status) && b.date >= meta.today;

    const steps = [h('li', { class: 'done' }, `Submitted ${fmtStamp(b.createdAt)}`)];
    if (b.status === 'PENDING') steps.push(h('li', {}, 'Waiting for the admin to decide'));
    else if (b.status === 'APPROVED') steps.push(h('li', { class: 'good' }, `Approved ${fmtStamp(b.updatedAt)}`));
    else if (b.status === 'REJECTED') steps.push(h('li', { class: 'bad' }, `Rejected ${fmtStamp(b.updatedAt)}`));
    else steps.push(h('li', { class: 'bad' }, `Cancelled ${fmtStamp(b.updatedAt)}`));

    const cancel = h('button', { class: 'danger', type: 'button' }, 'Cancel this request');
    cancel.addEventListener('click', async () => {
      if (!(await BMV.confirm('Cancel this request?', `${b.requestId} for ${b.venueName} on ${fmtDate(b.date)} will be cancelled. This cannot be undone.`, 'Cancel request', true))) return;
      busy(cancel, async () => {
        try { await post(`/api/bookings/${b.id}/cancel`); BMV.toast('Request cancelled.'); BMV.go(`/my-bookings/${b.id}`); }
        catch (e) { BMV.toast(e.message, 'error'); }
      });
    });

    const statusLine = {
      PENDING: 'Your request has been sent to the college administrator. You will see the decision here.',
      APPROVED: 'Approved. The venue is reserved for you at this time.',
      REJECTED: 'This request was not approved.',
      CANCELLED: 'This request was cancelled.',
    }[b.status];

    return h('div', { class: 'wrap page narrow' },
      h('p', { class: 'small' }, h('a', { href: '#/my-bookings' }, 'All my requests')),
      query.new ? h('div', { class: 'notice' }, 'Your request was sent. Keep the request ID below for reference.') : null,
      h('h1', {}, b.eventName),
      h('p', {}, h('span', { class: 'reqid' }, b.requestId), ' ', badge(b.status)),
      h('ol', { class: 'progress', 'aria-label': 'Request progress' }, steps),
      h('p', {}, statusLine),
      b.adminNote ? h('div', { class: 'notice warn' }, h('b', {}, 'Note from the admin: '), b.adminNote) : null,
      h('div', { class: 'panel' }, h('dl', { class: 'kv' },
        h('dt', {}, 'Venue'), h('dd', {}, `${b.venueName}${b.venueLocation ? ' (' + b.venueLocation + ')' : ''}`),
        h('dt', {}, 'Date'), h('dd', {}, fmtDate(b.date)),
        h('dt', {}, 'Time'), h('dd', {}, range(b.startTime, b.endTime)),
        h('dt', {}, 'Event type'), h('dd', {}, b.eventType),
        h('dt', {}, 'Expected participants'), h('dd', {}, b.participants),
        h('dt', {}, 'Department / organization'), h('dd', {}, b.organization),
        h('dt', {}, 'Purpose'), h('dd', {}, b.purpose),
        h('dt', {}, 'Additional requirements'), h('dd', {}, b.requirements || 'None'))),
      canCancel ? h('p', { style: 'margin-top:16px' }, cancel) : null);
  }, 'BOOKER');

  // ---------- Booking form -> summary -> sent ----------
  BMV.route('/book/:venueId', async ({ venueId }, query) => {
    const u = state.user;
    const meta = await get('/api/meta');
    state.meta = meta;
    const { venue } = await get(`/api/colleges/${u.collegeId}/venues/${venueId}`);
    const host = h('div', { class: 'wrap page narrow' });
    const values = {
      eventName: '', eventType: venue.suitableEventTypes[0] || meta.eventTypes[0], date: query.date || meta.today,
      startTime: query.start || '', endTime: query.end || '', participants: '', organization: '', purpose: '', requirements: '',
    };

    function showForm(error) {
      const f = {
        eventName: h('input', { type: 'text', value: values.eventName, maxlength: 150, required: true }),
        eventType: select(meta.eventTypes, values.eventType),
        date: h('input', { type: 'date', value: values.date, min: meta.today, required: true }),
        startTime: h('input', { type: 'time', value: values.startTime, step: 900, required: true }),
        endTime: h('input', { type: 'time', value: values.endTime, step: 900, required: true }),
        participants: h('input', { type: 'number', value: values.participants, min: 1, max: venue.capacity, required: true }),
        organization: h('input', { type: 'text', value: values.organization, maxlength: 150, required: true }),
        purpose: h('textarea', { maxlength: 1000, required: true }, values.purpose),
        requirements: h('textarea', { maxlength: 1000 }, values.requirements),
      };
      const err = errorBox();
      if (error) showError(err, error);
      const avail = h('div', { 'aria-live': 'polite', style: 'margin-bottom:16px' });
      async function drawAvail() {
        if (!f.date.value) return;
        try {
          const a = await get(`/api/colleges/${u.collegeId}/venues/${venue.id}/availability?date=${f.date.value}`);
          if (!a.isOpenDay) { avail.replaceChildren(h('div', { class: 'notice warn' }, `${venue.name} is closed on that day. Choose another date.`)); return; }
          const pick = f.startTime.value && f.endTime.value && f.endTime.value > f.startTime.value ? { start: f.startTime.value, end: f.endTime.value } : null;
          avail.replaceChildren(h('div', { class: 'small muted', style: 'margin-bottom:4px' }, `Availability on ${fmtDate(f.date.value)}. Bookable ${range(a.openTime, a.closeTime)}.`),
            strip({ openTime: a.openTime, closeTime: a.closeTime, busy: a.busy, pick, nowTime: f.date.value === meta.today ? meta.now : null, label: 'Availability' }), legend());
        } catch { avail.replaceChildren(); }
      }
      [f.date, f.startTime, f.endTime].forEach((i) => i.addEventListener('change', drawAvail));
      drawAvail();

      const review = h('button', { class: 'primary', type: 'submit' }, 'Review request');
      const form = h('form', { novalidate: true },
        err,
        BMV.field('Event name', f.eventName),
        h('div', { class: 'grid2' }, BMV.field('Type of event', f.eventType), BMV.field('Expected participants', f.participants, `${venue.name} seats ${venue.capacity}.`)),
        h('div', { class: 'grid3' }, BMV.field('Date', f.date), BMV.field('Start time', f.startTime), BMV.field('End time', f.endTime)),
        avail,
        BMV.field('Department, class or organization', f.organization, 'For example "Computer Engineering, TE-A" or "Cultural committee".'),
        BMV.field('Purpose of the event', f.purpose, 'Say what will happen and who it is for.'),
        BMV.field('Additional requirements', f.requirements, 'Optional. Mics, extra chairs, a laptop connection, early access.'),
        h('div', { class: 'row' }, review, h('a', { class: 'btn', href: `#/venues/${venue.id}` }, 'Cancel')));

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        err.hidden = true;
        for (const k of Object.keys(f)) values[k] = f[k].value;
        const missing = [['eventName', 'event name'], ['date', 'date'], ['startTime', 'start time'], ['endTime', 'end time'], ['participants', 'number of participants'], ['organization', 'department, class or organization'], ['purpose', 'purpose']].find(([k]) => !String(values[k]).trim());
        if (missing) return showError(err, `Please fill in the ${missing[1]}.`);
        busy(review, async () => {
          try {
            await post('/api/bookings/check', { venueId: venue.id, ...values, participants: Number(values.participants) });
            showSummary();
          } catch (e2) { showError(err, e2.message); }
        });
      });

      host.replaceChildren(
        h('p', { class: 'small' }, h('a', { href: `#/venues/${venue.id}` }, venue.name)),
        h('h1', {}, 'Request this venue'),
        h('p', { class: 'muted' }, `${venue.name} at ${u.collegeName}. Seats ${venue.capacity}. Step 1 of 2: event details.`),
        h('div', { class: 'panel' }, form));
    }

    function showSummary() {
      const err = errorBox();
      const send = h('button', { class: 'primary', type: 'button' }, 'Send request');
      send.addEventListener('click', () => busy(send, async () => {
        try {
          const { booking } = await post('/api/bookings', { venueId: venue.id, ...values, participants: Number(values.participants) });
          showSent(booking);
        } catch (e) { showError(err, e.message); }
      }));
      host.replaceChildren(
        h('h1', {}, 'Check your request'),
        h('p', { class: 'muted' }, 'Step 2 of 2: review the details, then send. The administrator will approve or decline it.'),
        err,
        h('div', { class: 'panel' }, h('dl', { class: 'kv' },
          h('dt', {}, 'Venue'), h('dd', {}, `${venue.name} (seats ${venue.capacity})`),
          h('dt', {}, 'College'), h('dd', {}, u.collegeName),
          h('dt', {}, 'Event'), h('dd', {}, `${values.eventName} (${values.eventType})`),
          h('dt', {}, 'Date'), h('dd', {}, fmtDate(values.date)),
          h('dt', {}, 'Time'), h('dd', {}, range(values.startTime, values.endTime)),
          h('dt', {}, 'Expected participants'), h('dd', {}, values.participants),
          h('dt', {}, 'Department / organization'), h('dd', {}, values.organization),
          h('dt', {}, 'Purpose'), h('dd', {}, values.purpose),
          h('dt', {}, 'Additional requirements'), h('dd', {}, values.requirements || 'None'),
          h('dt', {}, 'Requested by'), h('dd', {}, `${u.name} (${u.email})`))),
        h('div', { class: 'row', style: 'margin-top:16px' }, send, h('button', { type: 'button', onclick: () => showForm() }, 'Edit details')));
    }

    function showSent(b) {
      host.replaceChildren(
        h('h1', {}, 'Request sent'),
        h('p', {}, 'Your request is pending until the college administrator decides. Your request ID:'),
        h('p', {}, h('span', { class: 'bigid' }, b.requestId)),
        h('p', { class: 'muted' }, `${b.venueName}, ${when(b)}.`),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/my-bookings/${b.id}` }, 'Track this request'), h('a', { class: 'btn', href: '#/my-bookings' }, 'All my requests')));
      window.scrollTo(0, 0);
    }

    showForm();
    return host;
  }, 'BOOKER');
})();
