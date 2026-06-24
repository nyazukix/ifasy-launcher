// IFASY Launcher — renderer logic
const $ = (id) => document.getElementById(id);
const api = window.ifasy;
let channel = 'live';
let published = { live: false, ptb: false };

const GAME_DESC =
  'IFASY ist ein Koop Zombie Shooter. Schlagt euch solo oder mit bis zu vier Freunden durch endlose Horden. ' +
  'Der Zombie Modus bietet eine storygetriebene Kampagne im Koop sowie einen Wellen Modus im CoD Stil mit ' +
  'Highscore Jagd und Punkte Economy. Später erwartet euch zusätzlich kompetitiver Multiplayer gegen andere Spieler.';
const GAME_DESC_PTB =
  'Public Test Build. Die neueste Entwicklungsversion von IFASY zum Ausprobieren neuer Inhalte. ' +
  'Diese Version kann instabil sein und enthält Funktionen, die noch in Arbeit sind.';

/* ---- window controls ---- */
$('minBtn').onclick = () => api.minimize();
$('closeBtn').onclick = () => api.close();

/* ============================ AUTH / SESSION ============================ */
const loginBtn = $('loginBtn');
const lbLabel = loginBtn.querySelector('.btn__label');
const spinner = loginBtn.querySelector('.spinner');
const ERR = {
  invalid_credentials: 'Benutzername oder Passwort falsch.',
  banned: 'Dieses Konto ist gesperrt.',
  network_error: 'Keine Verbindung zum Server.',
  bad_response: 'Unerwartete Server-Antwort.',
  server_error: 'Serverfehler. Bitte später erneut.',
};
const setMsg = (m, k) => { const e = $('loginStatus'); e.textContent = m || ''; e.className = 'formmsg' + (k ? ' ' + k : ''); };

function showLogin() { document.body.className = 'state-login'; $('identifier').focus(); }
function showSplash() { document.body.className = 'state-splash'; }

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('identifier').value.trim();
  const pw = $('password').value;
  if (!id || !pw) return setMsg('Bitte beide Felder ausfüllen.', 'err');
  loginBtn.disabled = true; spinner.hidden = false; lbLabel.textContent = 'PRÜFE…'; setMsg('');
  const res = await api.login(id, pw);
  loginBtn.disabled = false; spinner.hidden = true; lbLabel.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> EINLOGGEN';
  if (res && res.data && res.data.ok) {
    setMsg('Angemeldet ✔', 'ok');
    setTimeout(() => enterApp(res.data.user || {}), 250);
  } else {
    setMsg(ERR[(res && res.data && res.data.error)] || 'Login fehlgeschlagen.', 'err');
  }
});

function enterApp(user) {
  $('userName').textContent = user.username || user.email || 'Spieler';
  $('userRole').textContent = user.role || 'user';
  $('avatar').textContent = (user.username || user.email || '?').charAt(0).toUpperCase();
  document.body.className = 'state-app';
  selectChannel('live');
  startSocialPolling();
}

$('logoutBtn').onclick = async () => {
  stopSocialPolling();
  await api.logoutSession();
  $('password').value = ''; setMsg('');
  showLogin();
};

// Auto-login on launch: try to restore the persisted session.
(async function bootSession() {
  showSplash();
  const r = await api.restoreSession();
  if (r && r.ok) { enterApp(r.user || {}); }
  else { showLogin(); }
})();

/* ============================ CHANNELS / PLAY ============================ */
document.querySelectorAll('.game').forEach((b) => b.addEventListener('click', () => selectChannel(b.dataset.channel)));

async function selectChannel(ch) {
  channel = ch;
  const ptb = ch === 'ptb';
  document.querySelectorAll('.game').forEach((b) => b.classList.toggle('game--active', b.dataset.channel === ch));
  $('heroChip').querySelector('.chip__txt').textContent = ptb ? 'PTB · DEV' : 'LIVE';
  $('heroChip').classList.toggle('ptb', ptb);
  $('heroArt').classList.toggle('ptb', ptb);
  $('heroDesc').textContent = ptb ? GAME_DESC_PTB : GAME_DESC;
  $('setChannel').textContent = ptb ? 'PTB' : 'LIVE';

  const play = $('playBtn');
  play.classList.toggle('ptb', ptb);
  play.disabled = true; play.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> PRÜFE…';
  $('abState').textContent = 'Version wird geladen…';

  const v = await api.gameVersion(ch);
  if (v && v.available) {
    published[ch] = true;
    $('abState').textContent = 'Version ' + v.version + (v.size ? '  ·  ' + (v.size / 1048576).toFixed(0) + ' MB' : '');
    play.disabled = false; play.innerHTML = '<i class="fa-solid fa-download"></i> INSTALLIEREN';
    play.onclick = () => openInstallModal(ch);
  } else {
    published[ch] = false;
    $('abState').textContent = 'Spiel wurde noch nicht veröffentlicht';
    play.disabled = true; play.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> BALD';
    play.onclick = null;
  }
}

/* ============================ INSTALL FLOW ============================ */
const installModal = $('installModal'), installScrim = $('installScrim');
let installChannel = 'live';
let installBase = '';

function fmtTarget(base, ch) {
  const sep = base.includes('\\') ? '\\' : '/';
  return base + sep + 'client' + sep + (ch === 'ptb' ? 'ptb' : 'live');
}
async function openInstallModal(ch) {
  if (!published[ch]) return;
  installChannel = ch;
  const info = await api.installGetBase();
  installBase = info.base;
  $('installPathPreview').textContent = installBase;
  $('installTargetPreview').textContent = 'Installationsziel: ' + fmtTarget(installBase, ch);
  installScrim.hidden = false; installModal.hidden = false;
}
function closeInstallModal() { installModal.hidden = true; installScrim.hidden = true; }
$('installCancel').onclick = closeInstallModal;
installScrim.onclick = closeInstallModal;
$('installPick').onclick = async () => {
  const r = await api.installPickFolder();
  if (r && r.ok) {
    installBase = r.base;
    $('installPathPreview').textContent = installBase;
    $('installTargetPreview').textContent = 'Installationsziel: ' + fmtTarget(installBase, installChannel);
  }
};
$('installConfirm').onclick = async () => {
  const r = await api.installStart(installChannel);
  closeInstallModal();
  if (r && r.ok) {
    $('abState').textContent = 'Download gestartet · Ziel: ' + r.target;
  } else {
    $('abState').textContent = 'Installation fehlgeschlagen.';
  }
};

/* ============================ SETTINGS DRAWER ============================ */
const drawer = $('settings'), scrim = $('scrim');
async function openDrawer() {
  $('launcherVer').textContent = 'v' + (await api.launcherVersion());
  const info = await api.installGetBase();
  $('setInstallPath').textContent = info.base;
  scrim.hidden = false; drawer.classList.add('open');
}
function closeDrawer() { drawer.classList.remove('open'); scrim.hidden = true; }
$('gearBtn').onclick = openDrawer;
$('setClose').onclick = closeDrawer;
scrim.onclick = closeDrawer;
$('setPickFolder').onclick = async () => {
  const r = await api.installPickFolder();
  if (r && r.ok) $('setInstallPath').textContent = r.base;
};

/* ---- launcher self-update ---- */
$('updBtn').onclick = async () => {
  $('updStatus').textContent = 'Suche nach Updates…';
  const r = await api.checkLauncherUpdate();
  if (!r.ok) $('updStatus').textContent = 'Update-Prüfung fehlgeschlagen: kein Release verfügbar.';
};
api.onUpdate('checking', () => { $('updStatus').textContent = 'Suche nach Updates…'; });
api.onUpdate('available', (v) => { $('updStatus').textContent = 'Update ' + v + ' wird geladen…'; });
api.onUpdate('progress', (p) => { $('updStatus').textContent = 'Update wird geladen… ' + p + '%'; });
api.onUpdate('downloaded', (v) => { $('updStatus').innerHTML = 'Update ' + v + ' bereit — <b>Neustart…</b>'; setTimeout(() => api.installLauncherUpdate(), 1200); });
api.onUpdate('none', () => { $('updStatus').textContent = 'Launcher ist aktuell. ✔'; });
api.onUpdate('error', () => { $('updStatus').textContent = 'Kein Update verfügbar / noch kein Release.'; });

/* ============================ FRIENDS & MESSAGING ============================ */
const fDrawer = $('friendsDrawer'), fScrim = $('friendsScrim');
let socialTimer = null, chatTimer = null;
let activeChat = null; // { id, username }
let lastMsgId = 0;

$('navFriends').onclick = openFriends;
$('friendsClose').onclick = closeFriends;
fScrim.onclick = closeFriends;

function openFriends() { fScrim.hidden = false; fDrawer.classList.add('open'); refreshSocial(); }
function closeFriends() { fDrawer.classList.remove('open'); fScrim.hidden = true; closeChat(); }

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function avatarLetter(name) { return (name || '?').charAt(0).toUpperCase(); }

async function refreshSocial() {
  const o = await api.socialOverview();
  if (!o || !o.ok) return;
  // badge = incoming requests + unread messages
  const badgeN = (o.incoming ? o.incoming.length : 0) + (o.unread || 0);
  const badge = $('friendsBadge');
  if (badgeN > 0) { badge.hidden = false; badge.textContent = badgeN > 99 ? '99+' : badgeN; }
  else badge.hidden = true;

  // incoming
  const sIn = $('secIncoming'), inList = $('incomingList');
  if (o.incoming && o.incoming.length) {
    sIn.hidden = false;
    inList.innerHTML = o.incoming.map((u) => `
      <div class="frow">
        <div class="frow__av">${esc(avatarLetter(u.username))}</div>
        <div class="frow__name">${esc(u.username)}</div>
        <button class="iconbtn iconbtn--ok" data-accept="${u.id}" title="Annehmen"><i class="fa-solid fa-check"></i></button>
        <button class="iconbtn iconbtn--no" data-decline="${u.id}" title="Ablehnen"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  } else { sIn.hidden = true; inList.innerHTML = ''; }

  // outgoing
  const sOut = $('secOutgoing'), outList = $('outgoingList');
  if (o.outgoing && o.outgoing.length) {
    sOut.hidden = false;
    outList.innerHTML = o.outgoing.map((u) => `
      <div class="frow">
        <div class="frow__av frow__av--dim">${esc(avatarLetter(u.username))}</div>
        <div class="frow__name frow__name--dim">${esc(u.username)} <span class="frow__pending">ausstehend</span></div>
        <button class="iconbtn iconbtn--no" data-cancel="${u.id}" title="Zurückziehen"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  } else { sOut.hidden = true; outList.innerHTML = ''; }

  // friends
  const fl = $('friendsList');
  $('friendCount').textContent = o.friends ? o.friends.length : 0;
  if (o.friends && o.friends.length) {
    fl.innerHTML = o.friends.map((u) => `
      <div class="frow frow--friend" data-chat="${u.id}" data-name="${esc(u.username)}">
        <div class="frow__av">${esc(avatarLetter(u.username))}</div>
        <div class="frow__name">${esc(u.username)}</div>
        <button class="iconbtn" data-chat="${u.id}" data-name="${esc(u.username)}" title="Nachricht"><i class="fa-solid fa-comment"></i></button>
        <button class="iconbtn iconbtn--no" data-remove="${u.id}" title="Entfernen"><i class="fa-solid fa-user-minus"></i></button>
      </div>`).join('');
  } else { fl.innerHTML = '<div class="flist__empty">Noch keine Freunde.</div>'; }
}

// event delegation for the friends list
$('flistWrap').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-accept],[data-decline],[data-cancel],[data-remove],[data-chat]');
  if (!t) return;
  if (t.dataset.accept) { await api.socialAccept(+t.dataset.accept); refreshSocial(); }
  else if (t.dataset.decline) { await api.socialDecline(+t.dataset.decline); refreshSocial(); }
  else if (t.dataset.cancel) { await api.socialRemove(+t.dataset.cancel); refreshSocial(); }
  else if (t.dataset.remove) { await api.socialRemove(+t.dataset.remove); refreshSocial(); }
  else if (t.dataset.chat) { openChat(+t.dataset.chat, t.dataset.name); }
});

$('friendAddBtn').onclick = sendFriendRequest;
$('friendAddInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendFriendRequest(); });
async function sendFriendRequest() {
  const name = $('friendAddInput').value.trim();
  const msg = $('friendAddMsg');
  if (!name) return;
  msg.textContent = 'Sende Anfrage…'; msg.className = 'fdrawer__msg';
  const r = await api.socialRequest({ username: name });
  if (r && r.ok) {
    msg.textContent = r.status === 'accepted' ? 'Ihr seid jetzt Freunde ✔' : 'Anfrage gesendet ✔';
    msg.className = 'fdrawer__msg ok';
    $('friendAddInput').value = '';
    refreshSocial();
  } else {
    const m = {
      user_not_found: 'Benutzer nicht gefunden.',
      cannot_add_self: 'Du kannst dich nicht selbst hinzufügen.',
      already_friends: 'Ihr seid bereits Freunde.',
      request_already_sent: 'Anfrage wurde bereits gesendet.',
      no_session: 'Nicht angemeldet.',
      network_error: 'Keine Verbindung zum Server.',
    };
    msg.textContent = m[r && r.error] || 'Anfrage fehlgeschlagen.';
    msg.className = 'fdrawer__msg err';
  }
}

/* ---- chat ---- */
function openChat(id, username) {
  activeChat = { id, username };
  lastMsgId = 0;
  $('chatName').textContent = username;
  $('chatAvatar').textContent = avatarLetter(username);
  $('chatMsgs').innerHTML = '';
  $('chatPanel').hidden = false;
  $('flistWrap').classList.add('hidden');
  loadChat(true);
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(() => loadChat(false), 3000);
  $('chatInput').focus();
}
function closeChat() {
  activeChat = null;
  $('chatPanel').hidden = true;
  $('flistWrap').classList.remove('hidden');
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
}
$('chatBack').onclick = closeChat;

async function loadChat(scroll) {
  if (!activeChat) return;
  const r = await api.socialMessages(activeChat.id, lastMsgId);
  if (!r || !r.ok || !r.messages) return;
  if (!r.messages.length) return;
  const box = $('chatMsgs');
  const me = await myId();
  for (const m of r.messages) {
    lastMsgId = Math.max(lastMsgId, m.id);
    const mine = m.sender_id === me;
    const div = document.createElement('div');
    div.className = 'msg ' + (mine ? 'msg--me' : 'msg--them');
    div.innerHTML = '<span class="msg__b">' + esc(m.body) + '</span>';
    box.appendChild(div);
  }
  if (scroll || true) box.scrollTop = box.scrollHeight;
  // refresh badge (messages now read)
  refreshSocial();
}

$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeChat) return;
  const text = $('chatInput').value.trim();
  if (!text) return;
  $('chatInput').value = '';
  const r = await api.socialSend(activeChat.id, text);
  if (r && r.ok) { loadChat(true); }
});

// cache my user id (from session)
let _myId = null;
async function myId() {
  if (_myId != null) return _myId;
  const o = await api.socialOverview();
  if (o && o.ok && o.me) _myId = o.me.id;
  return _myId;
}

/* ---- background polling for the badge (light) ---- */
function startSocialPolling() {
  refreshSocial();
  if (socialTimer) clearInterval(socialTimer);
  socialTimer = setInterval(refreshSocial, 15000);
}
function stopSocialPolling() {
  if (socialTimer) { clearInterval(socialTimer); socialTimer = null; }
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  _myId = null;
}
