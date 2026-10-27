const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.message || 'The request could not be completed.');
  return result;
}

function setSignedIn(user) {
  const name = document.querySelector('#signed-in-user');
  const signIn = document.querySelector('#sign-in');
  const signOut = document.querySelector('#sign-out');
  name.textContent = user.username;
  name.hidden = false;
  signIn.hidden = true;
  signOut.hidden = false;
    signOut.addEventListener('click', async () => {
      await requestJson('/portal/auth/logout', { method: 'POST' });
      window.location.reload();
  });
}

function showMember(session) {
  const status = document.querySelector('#connection-status');
  const content = document.querySelector('#account-content');
  const linked = session.linkedUser;
  if (session.memberAccess && linked) {
    status.className = 'status status-good';
    status.innerHTML = '<i></i> Account connected';
    content.innerHTML = `<div class="account-row"><div><p class="identity-label">DISCORD IDENTITY</p><div class="discord-identity">${session.user.avatar ? `<img class="avatar" src="${escapeText(session.user.avatar)}" alt="">` : `<span class="avatar-placeholder">${escapeText(session.user.username.slice(0, 1).toUpperCase())}</span>`}<div><div class="identity-name">${escapeText(session.user.username)}</div><div class="identity-id">${escapeText(session.user.id)}</div></div></div></div><div class="linked-account"><div><p class="identity-label">LINKED ROBLOX ACCOUNT</p><strong>${escapeText(linked.robloxUsername)}</strong><div class="identity-id">Roblox ID ${escapeText(linked.robloxId)}</div></div><a href="https://www.roblox.com/users/${encodeURIComponent(linked.robloxId)}/profile" target="_blank" rel="noopener noreferrer">View profile ↗</a></div></div>`;
    return;
  }

  status.className = 'status status-bad';
  status.innerHTML = '<i></i> Access not confirmed';
  const isAdmin = session.isAdmin;
  const accessMessage = !session.linkedAccountConfigured
    ? `No linked Roblox account was found for Discord ID ${session.user.id}.`
    : !session.robloxGroupVerificationAvailable
      ? 'Roblox group membership could not be verified. Try again shortly.'
      : 'The linked Roblox account is not a member of the MoCS Roblox group.';
  content.innerHTML = `<div class="empty-state"><h2>${isAdmin ? 'Administrator account' : 'Member record unavailable'}</h2><p>${isAdmin ? 'Your Discord account has administrator access. ' : ''}${escapeText(accessMessage)}</p>${!isAdmin ? '<a class="button button-light" href="/portal/admin">Contact an administrator <span aria-hidden="true">↗</span></a>' : ''}</div>`;
}

function renderDashboardRows(element, rows, valueForRow) {
  if (!rows.length) {
    element.innerHTML = '<div class="dashboard-empty">No records found.</div>';
    return;
  }
  element.innerHTML = rows.map((row) => `<div class="dashboard-row"><strong>${escapeText(row.label)}</strong><span>${escapeText(valueForRow(row))}</span></div>`).join('');
}

function renderActivity(element, rows, availability, emptyMessage) {
  if (!availability) {
    element.innerHTML = '<div class="dashboard-empty">Activity data is temporarily unavailable.</div>';
    return;
  }
  if (!rows.length) {
    element.innerHTML = `<div class="dashboard-empty">${emptyMessage}</div>`;
    return;
  }
  element.innerHTML = rows.map((row) => `<article class="activity-entry"><div class="activity-entry-heading"><strong>${escapeText(row.activity || 'Activity')}</strong><time>${escapeText(row.date)}</time></div>${row.description ? `<p>${escapeText(row.description)}</p>` : ''}${row.host ? `<p>Hosted by ${escapeText(row.host)}</p>` : ''}${row.passed ? '<p class="activity-outcome">Passed</p>' : ''}</article>`).join('');
}

function formatRuntimeDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return 'Unavailable';
  const totalSeconds = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function formatRuntimeBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function renderMemberIdentity(profile, available) {
  const avatar = document.querySelector('#member-avatar');
  const placeholder = document.querySelector('#member-avatar-placeholder');
  const displayName = profile.displayName || profile.username || 'Roblox member';
  document.querySelector('#member-display-name').textContent = displayName;
  document.querySelector('#member-username').textContent = `@${profile.username || 'Unknown'} · ID ${profile.id || 'Unavailable'}`;
  const created = profile.created ? new Date(profile.created) : null;
  document.querySelector('#member-created').textContent = available && created && !Number.isNaN(created.valueOf())
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(created)
    : 'Unavailable';
  const profileLink = document.querySelector('#member-profile-link');
  profileLink.href = `https://www.roblox.com/users/${encodeURIComponent(profile.id)}/profile`;
  if (profile.avatarUrl) {
    avatar.src = profile.avatarUrl;
    avatar.hidden = false;
    placeholder.hidden = true;
  } else {
    avatar.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = displayName.slice(0, 1).toUpperCase();
  }
}

function renderRuntime(runtime = {}) {
  const status = document.querySelector('#runtime-status');
  status.classList.toggle('runtime-status-online', Boolean(runtime.online));
  status.innerHTML = `<i></i> ${runtime.online ? 'Online' : 'Connecting'}`;
  document.querySelector('#runtime-uptime').textContent = formatRuntimeDuration(runtime.uptimeSeconds);
  document.querySelector('#runtime-latency').textContent = Number.isFinite(runtime.latencyMs) ? `${runtime.latencyMs} ms` : 'Unavailable';
  document.querySelector('#runtime-memory').textContent = formatRuntimeBytes(runtime.memoryBytes);
  document.querySelector('#runtime-version').textContent = runtime.version ? `v${runtime.version}` : 'Unavailable';
}

function renderMemberDashboard(data) {
  renderMemberIdentity(data.profile || {}, data.availability.profile);
  renderRuntime(data.runtime);

  const rankRows = data.ranks.map((rank) => ({ label: rank.label, value: rank.rankName }));
  if (!data.availability.ranks) {
    document.querySelector('#dashboard-ranks').innerHTML = '<div class="dashboard-empty">Rank information is temporarily unavailable.</div>';
  } else {
    renderDashboardRows(document.querySelector('#dashboard-ranks'), rankRows, (rank) => rank.value);
  }

  if (!data.availability.quota) {
    document.querySelector('#dashboard-quota').innerHTML = '<div class="dashboard-empty">Quota information is temporarily unavailable.</div>';
  } else {
    const quotaRows = data.quota.map((department) => ({
      label: department.department,
      value: department.status === 'Active' ? `${department.points} QP` : department.status,
    }));
    renderDashboardRows(document.querySelector('#dashboard-quota'), quotaRows, (department) => department.value);
  }

  renderActivity(document.querySelector('#dashboard-attended'), data.attended, data.availability.activity, 'No recent events attended.');
  renderActivity(document.querySelector('#dashboard-hosted'), data.hosted, data.availability.activity, 'No recent events hosted.');

  const partial = Object.entries(data.availability).filter(([, available]) => !available).map(([name]) => name);
  const message = document.querySelector('#dashboard-message');
  message.textContent = partial.length ? `Some ${partial.join(', ')} data could not be loaded. Try refreshing.` : '';
  message.classList.toggle('error', partial.length > 0);
}

async function loadMemberDashboard() {
  const refresh = document.querySelector('#dashboard-refresh');
  const message = document.querySelector('#dashboard-message');
  refresh.disabled = true;
  message.textContent = 'Refreshing dashboard…';
  message.classList.remove('error');
  try {
    const data = await requestJson('/portal/api/member/dashboard');
    renderMemberDashboard(data);
  } catch (error) {
    message.textContent = error.message || 'Dashboard data is temporarily unavailable.';
    message.classList.add('error');
  } finally {
    refresh.disabled = false;
  }
}

function initializeMemberDashboard() {
  document.querySelector('#dashboard-refresh').addEventListener('click', loadMemberDashboard);
}

function renderLinkedUsers(users) {
  const body = document.querySelector('#linked-user-rows');
  const count = document.querySelector('#record-count');
  count.textContent = `${users.length} ${users.length === 1 ? 'record' : 'records'}`;
  const query = document.querySelector('#linked-user-search').value.trim().toLowerCase();
  const matches = users.filter((user) => [user.discordId, user.robloxId, user.robloxUsername].some((value) => String(value).toLowerCase().includes(query)));
  if (matches.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="empty-table">${users.length ? 'No records match that search.' : 'No linked accounts are recorded yet.'}</td></tr>`;
    return;
  }
  body.innerHTML = matches.map((user) => `<tr><td><code>${escapeText(user.discordId)}</code></td><td><div class="roblox-cell"><a href="https://www.roblox.com/users/${encodeURIComponent(user.robloxId)}/profile" target="_blank" rel="noopener noreferrer">${escapeText(user.robloxUsername)} ↗</a><code>${escapeText(user.robloxId)}</code></div></td><td><button class="button button-danger remove-button" type="button" data-discord-id="${escapeText(user.discordId)}">Delete</button></td></tr>`).join('');
  body.querySelectorAll('[data-discord-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm(`Delete the linked account for Discord ID ${button.dataset.discordId}? This cannot be undone.`)) return;
      try {
        await requestJson('/portal/api/admin/linked-users', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', discordId: button.dataset.discordId }),
        });
        await loadLinkedUsers();
        showAdminMessage('Linked account deleted.');
      } catch (error) {
        showAdminMessage(error.message, true);
      }
    });
  });
}

let linkedUsers = [];

async function loadLinkedUsers() {
  const result = await requestJson('/portal/api/admin/linked-users');
  linkedUsers = result.users;
  renderLinkedUsers(linkedUsers);
}

function showAdminMessage(message, isError = false) {
  const element = document.querySelector('#form-message');
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function showAdminDenied(message) {
  document.querySelector('#admin-content').innerHTML = `<div class="access-denied"><h2>${escapeText(message)}</h2><p>Administration is restricted to Discord users listed as privileged in the bot configuration.</p></div>`;
}

let currentAdminId = null;

function showPrivilegedMessage(message, isError = false) {
  const element = document.querySelector('#privileged-message');
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function renderPrivilegedUsers(users) {
  const body = document.querySelector('#privileged-user-rows');
  document.querySelector('#privileged-count').textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;
  if (users.length === 0) {
    body.innerHTML = '<tr><td colspan="2" class="empty-table">No privileged users are recorded.</td></tr>';
    return;
  }
  body.innerHTML = users.map((user) => {
    const locked = user.protected || user.discordId === currentAdminId;
    const action = locked
      ? `<span class="record-count">${user.protected ? 'Protected owner' : 'You'}</span>`
      : `<button class="button button-danger remove-button" type="button" data-privileged-id="${escapeText(user.discordId)}">Remove</button>`;
    return `<tr><td><code>${escapeText(user.discordId)}</code></td><td>${action}</td></tr>`;
  }).join('');
  body.querySelectorAll('[data-privileged-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm(`Remove privileged access for Discord ID ${button.dataset.privilegedId}?`)) return;
      try {
        const result = await requestJson('/portal/api/admin/privileged-users', {
          method: 'POST',
          body: JSON.stringify({ action: 'remove', discordId: button.dataset.privilegedId }),
        });
        showPrivilegedMessage(result.message);
        await loadPrivilegedUsers();
      } catch (error) {
        showPrivilegedMessage(error.message, true);
      }
    });
  });
}

async function loadPrivilegedUsers() {
  const result = await requestJson('/portal/api/admin/privileged-users');
  renderPrivilegedUsers(result.users);
}

function initializePrivilegedManager(session) {
  currentAdminId = session.user.id;
  document.querySelector('#privileged-panel').hidden = false;
  document.querySelector('#privileged-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const discordId = new FormData(form).get('discordId');
    try {
      const result = await requestJson('/portal/api/admin/privileged-users', {
        method: 'POST',
        body: JSON.stringify({ action: 'add', discordId }),
      });
      form.reset();
      showPrivilegedMessage(result.message);
      await loadPrivilegedUsers();
    } catch (error) {
      showPrivilegedMessage(error.message, true);
    }
  });
  return loadPrivilegedUsers();
}

async function startMemberPortal() {
  initializeMemberDashboard();
  try {
    const session = await requestJson('/portal/api/session');
    if (!session.authenticated) {
      showMemberSignedOut();
      return;
    }
    setSignedIn(session.user);
    showMember(session);
    if (session.memberAccess && session.linkedUser) {
      document.querySelector('#member-dashboard').hidden = false;
      await loadMemberDashboard();
    }
  } catch {
    showMemberSignedOut();
  }
}

function showMemberSignedOut() {
  const loginError = new URLSearchParams(window.location.search).has('login')
    ? '<p class="form-message error">Discord sign-in could not be completed. Please try again.</p>'
    : '';
  document.querySelector('#connection-status').className = 'status status-muted';
  document.querySelector('#connection-status').innerHTML = '<i></i> Sign in required';
  document.querySelector('#account-content').innerHTML = `${loginError}<div class="empty-state"><h2>Sign in to view your record</h2><p>Use your Discord account to access the Roblox profile linked to your member record.</p><a class="button button-dark" href="/portal/auth/discord?next=%2Fportal%2F">Sign in with Discord <span aria-hidden="true">↗</span></a></div>`;
}

function showAdminSignedOut() {
  const loginError = new URLSearchParams(window.location.search).has('login')
    ? '<p class="form-message error">Discord sign-in could not be completed. Please try again.</p>'
    : '';
  document.querySelector('#admin-content').innerHTML = `${loginError}<div class="empty-state"><h2>Administrator sign-in required</h2><p>Sign in with a Discord account on the privileged-user list to continue.</p><a class="button button-dark" href="/portal/auth/discord?next=%2Fportal%2Fadmin">Sign in with Discord <span aria-hidden="true">↗</span></a></div>`;
}

async function startAdminPortal() {
  try {
    const session = await requestJson('/portal/api/session');
    if (!session.authenticated) {
      showAdminSignedOut();
      return;
    }
    setSignedIn(session.user);
    if (!session.isAdmin) {
      showAdminDenied(`Discord ID ${session.user.id} is not listed as a privileged user.`);
      return;
    }
    document.querySelector('#admin-content').innerHTML = `<div class="admin-toolbar"><label class="search-wrap"><span class="search-icon" aria-hidden="true">⌕</span><input id="linked-user-search" type="search" placeholder="Search Discord ID or Roblox account" autocomplete="off" aria-label="Search linked accounts"></label><div class="admin-toolbar-actions"><span class="record-count">Signed in as ${escapeText(session.user.username)}</span></div></div><div class="table-wrap"><table class="records-table"><thead><tr><th>DISCORD ID</th><th>ROBLOX ACCOUNT</th><th>ACTION</th></tr></thead><tbody id="linked-user-rows"><tr><td colspan="3" class="empty-table">Loading records…</td></tr></tbody></table></div><div class="admin-form-wrap"><div class="form-heading"><h2>Add or update a link</h2><p>Saving an existing Discord ID replaces its current Roblox link.</p></div><form id="link-form" class="link-form"><label class="field">DISCORD USER ID<input name="discordId" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" required placeholder="17–20 digits"></label><label class="field">ROBLOX USER ID<input name="robloxId" inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20" required placeholder="Numeric ID"></label><label class="field">ROBLOX USERNAME<input name="robloxUsername" maxlength="64" required placeholder="Username"></label><button class="button button-dark" type="submit">Save link <span aria-hidden="true">↗</span></button></form><p id="form-message" class="form-message" role="status"></p></div>`;
    document.querySelector('#linked-user-search').addEventListener('input', () => renderLinkedUsers(linkedUsers));
    document.querySelector('#link-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const values = Object.fromEntries(form.entries());
      try {
        const result = await requestJson('/portal/api/admin/linked-users', {
          method: 'POST',
          body: JSON.stringify({ action: 'add', ...values }),
        });
        event.currentTarget.reset();
        await loadLinkedUsers();
        showAdminMessage(result.message);
      } catch (error) {
        showAdminMessage(error.message, true);
      }
    });
    await Promise.all([loadLinkedUsers(), initializePrivilegedManager(session)]);
  } catch (error) {
    if (error.message === 'This page is restricted to privileged Discord users.') {
      showAdminDenied(error.message);
      return;
    }
    showAdminSignedOut();
  }
}

if (document.body.dataset.portal === 'admin') startAdminPortal();
else startMemberPortal();