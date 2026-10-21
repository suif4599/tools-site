const $ = (id) => document.getElementById(id);
const msg = $('msg');

function show(text) {
  msg.textContent = text;
  msg.hidden = !text;
}

async function api(path, opts = {}) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  const res = await fetch('api/' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function fmtDate(unix) {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

let me = null;

async function setPassword(u) {
  const pw = prompt(`New password for ${u.username} (min 8 chars):`);
  if (!pw) return;
  try {
    await api(`users/${u.id}/password`, { method: 'POST', body: JSON.stringify({ password: pw }) });
    show(`Password updated for ${u.username}.`);
  } catch (e) {
    show(String(e.message || e));
  }
}

async function patch(u, body) {
  try {
    await api(`users/${u.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    show('');
    load();
  } catch (e) {
    show(String(e.message || e));
  }
}

async function remove(u) {
  if (!confirm(`Delete user ${u.username}?`)) return;
  try {
    await api(`users/${u.id}`, { method: 'DELETE' });
    show('');
    load();
  } catch (e) {
    show(String(e.message || e));
  }
}

function btn(label, onClick, disabled, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.disabled = !!disabled;
  if (!disabled) b.addEventListener('click', onClick);
  return b;
}

function load() {
  return Promise.all([api('session'), api('users')]).then(([session, users]) => {
    me = session.username;
    const activeAdmins = users.filter((u) => u.role === 'admin' && !u.disabled).length;
    const tbody = $('users');
    tbody.textContent = '';
    for (const u of users) {
      const self = u.username === me;
      // at least one active admin must remain: no role change / disable / delete on the last one
      const lastAdmin = u.role === 'admin' && activeAdmins <= 1;
      const locked = self || lastAdmin;

      const tr = document.createElement('tr');

      const name = document.createElement('td');
      name.textContent = u.username + (self ? ' (you)' : '');

      const role = document.createElement('td');
      const roleBadge = document.createElement('span');
      roleBadge.className = 'badge' + (u.role === 'admin' ? ' admin' : '');
      roleBadge.textContent = u.role;
      role.append(roleBadge);

      const status = document.createElement('td');
      if (u.disabled) {
        const off = document.createElement('span');
        off.className = 'badge off';
        off.textContent = 'disabled';
        status.append(off);
      } else {
        status.textContent = 'active';
      }

      const created = document.createElement('td');
      created.textContent = fmtDate(u.created_at);

      const actions = document.createElement('td');
      actions.className = 'actions';
      actions.append(btn('Password', () => setPassword(u)));
      actions.append(btn(u.role === 'admin' ? 'Make user' : 'Make admin', () => patch(u, { role: u.role === 'admin' ? 'user' : 'admin' }), locked, 'secondary'));
      actions.append(btn(u.disabled ? 'Enable' : 'Disable', () => patch(u, { disabled: !u.disabled }), !u.disabled && locked, 'secondary'));
      actions.append(btn('Delete', () => remove(u), locked, 'danger'));

      tr.append(name, role, status, created, actions);
      tbody.append(tr);
    }
  });
}

$('create').addEventListener('submit', async (e) => {
  e.preventDefault();
  show('');
  try {
    await api('users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('new-username').value.trim(),
        password: $('new-password').value,
        role: $('new-role').value,
      }),
    });
    $('create').reset();
    load();
  } catch (err) {
    show(String(err.message || err));
  }
});

load().catch((e) => show(String(e.message || e)));
