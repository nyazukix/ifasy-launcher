// IFASY Launcher — renderer logic
const $ = (id) => document.getElementById(id);
const api = window.ifasy;
let channel = 'live';
// per-channel state: { available, latest, installedVersion, onDisk }
let chState = { live: {}, ptb: {} };

const GAME_DESC =
  'IFASY ist ein Koop Zombie Shooter. Schlagt euch solo oder mit bis zu vier Freunden durch endlose Horden. ' +
  'Der Zombie Modus bietet eine storygetriebene Kampagne im Koop sowie einen Wellen Modus im CoD Stil mit ' +
  'Highscore Jagd und Punkte Economy. Später erwartet euch zusätzlich kompetitiver Multiplayer gegen andere Spieler.';
const GAME_DESC_PTB =
  'Public Test Build. Die neueste Entwicklungsversion von IFASY zum Ausprobieren neuer Inhalte. ' +
  'Diese Version kann instabil sein und enthält Funktionen, die noch in Arbeit sind.';

/* ---- window controls ---- */
$('minBtn').onclick = () => api.minimize();
$('maxBtn').onclick = () => api.maximize();
$('closeBtn').onclick = () => api.close();
function setMaxIcon(maxd) {
  $('maxBtn').innerHTML = maxd ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
  $('maxBtn').title = maxd ? 'Wiederherstellen' : 'Maximieren';
}
api.onWinState((s) => setMaxIcon(s && s.maximized));
api.isMaximized().then(setMaxIcon).catch(() => {});

/* ============================ AUTH / SESSION ============================ */
const loginBtn = $('loginBtn');
const lbLabel = loginBtn.querySelector('.btn__label');
const spinner = loginBtn.querySelector('.spinner');
spinner.hidden = true; // ensure idle state (no premature spinner)

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
  refreshUpdateIndicator();
}

$('logoutBtn').onclick = async () => {
  stopSocialPolling();
  await api.logoutSession();
  $('password').value = ''; setMsg('');
  showLogin();
};

// Auto-login on launch
(async function bootSession() {
  showSplash();
  const r = await api.restoreSession();
  if (r && r.ok) { enterApp(r.user || {}); }
  else { showLogin(); }
})();

/* ============================ CHANNELS / ACTION STATE MACHINE ============================ */
document.querySelectorAll('.game').forEach((b) => b.addEventListener('click', () => selectChannel(b.dataset.channel)));

function fmtBytes(n) {
  if (!n) return '0 MB';
  const mb = n / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(0) + ' MB';
}
function fmtEta(sec) {
  if (!sec || sec <= 0 || !isFinite(sec)) return '–';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m > 0 ? m + ' min ' + s + ' s' : s + ' s';
}

async function selectChannel(ch) {
  channel = ch;
  const ptb = ch === 'ptb';
  document.querySelectorAll('.game').forEach((b) => b.classList.toggle('game--active', b.dataset.channel === ch));
  $('heroChip').querySelector('.chip__txt').textContent = ptb ? 'PTB · DEV' : 'LIVE';
  $('heroChip').classList.toggle('ptb', ptb);
  $('heroArt').classList.toggle('ptb', ptb);
  $('heroDesc').textContent = ptb ? GAME_DESC_PTB : GAME_DESC;
  $('setChannel').textContent = ptb ? 'PTB' : 'LIVE';

  resetDownloadUi();
  const play = $('playBtn');
  play.className = 'btn btn--play' + (ptb ? ' ptb' : '');
  play.disabled = true; play.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> PRÜFE…';
  $('abState').textContent = 'Version wird geladen…';
  $('uninstallBtn').hidden = true;

  const [v, st] = await Promise.all([api.gameVersion(ch), api.installStatus(ch)]);
  const available = !!(v && v.available);
  const latest = available ? v.version : null;
  const installedVersion = st && (st.installedVersion === true ? (latest || 'installed') : st.installedVersion);
  const installed = !!(st && st.onDisk && installedVersion);
  chState[ch] = { available, latest, size: v && v.size, installedVersion, installed };

  renderActionState(ch);
}

function renderActionState(ch) {
  if (ch !== channel) return;
  const s = chState[ch];
  const play = $('playBtn');
  const uninstall = $('uninstallBtn');
  play.className = 'btn btn--play' + (ch === 'ptb' ? ' ptb' : '');
  play.disabled = false;
  uninstall.hidden = true;

  if (!s.available) {
    // unpublished
    $('abState').textContent = 'Spiel wurde noch nicht veröffentlicht';
    play.disabled = true; play.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> BALD';
    play.onclick = null;
    return;
  }

  if (!s.installed) {
    // published, not installed -> Installieren
    $('abState').textContent = 'Version ' + s.latest + (s.size ? '  ·  ' + fmtBytes(s.size) : '');
    play.innerHTML = '<i class="fa-solid fa-download"></i> INSTALLIEREN';
    play.onclick = () => openInstallModal(ch);
    return;
  }

  // installed
  uninstall.hidden = false;
  $('uninstallBtn').onclick = () => doUninstall(ch);

  if (s.latest && s.installedVersion && String(s.installedVersion) !== String(s.latest)) {
    // installed but outdated -> Updaten
    $('abState').textContent = 'Update verfügbar · ' + s.installedVersion + ' → ' + s.latest;
    play.classList.add('play--update');
    play.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i> UPDATEN';
    play.onclick = () => startGameDownload(ch, s.latest);
  } else {
    // installed + up to date -> Spielen
    $('abState').textContent = 'Installiert · Version ' + (s.installedVersion || s.latest);
    play.classList.add('play--ready');
    play.innerHTML = '<i class="fa-solid fa-play"></i> SPIELEN';
    play.onclick = () => playGame(ch);
  }
}

function playGame(ch) {
  // The game launch (spawn the .exe from client/<ch>/) lands once the build exists.
  $('abState').textContent = 'Start des Spiels folgt, sobald ein Build veröffentlicht ist.';
}

async function doUninstall(ch) {
  $('abState').textContent = 'Wird deinstalliert…';
  const r = await api.installUninstall(ch);
  if (r && r.ok) { chState[ch].installed = false; chState[ch].installedVersion = null; }
  selectChannel(ch);
}

/* ============================ DOWNLOAD UI ============================ */
function resetDownloadUi() {
  $('progress').hidden = true;
  $('dlMeta').hidden = true;
  $('barFill').style.width = '0%';
  $('cancelDlBtn').hidden = true;
}
function setDownloading(on) {
  $('progress').hidden = !on;
  $('dlMeta').hidden = !on;
  $('cancelDlBtn').hidden = !on;
  $('playBtn').disabled = on;
  $('uninstallBtn').hidden = on ? true : $('uninstallBtn').hidden;
}

api.onDownload('progress', (p) => {
  if (!p || p.channel !== channel) return;
  $('barFill').style.width = (p.percent || 0) + '%';
  const got = fmtBytes(p.received), tot = fmtBytes(p.total);
  $('dlMeta').textContent =
    (p.percent || 0).toFixed(1) + '%  ·  ' + got + ' / ' + tot +
    '  ·  ' + (p.speedMBps || 0).toFixed(2) + ' MB/s' +
    '  ·  Restzeit ' + fmtEta(p.etaSec);
  $('abState').textContent = 'Wird heruntergeladen…';
});
api.onDownload('done', (p) => {
  if (!p) return;
  if (chState[p.channel]) { chState[p.channel].installed = true; chState[p.channel].installedVersion = p.version || chState[p.channel].latest; }
  setDownloading(false);
  resetDownloadUi();
  selectChannel(p.channel);
});
api.onDownload('cancelled', (p) => { setDownloading(false); resetDownloadUi(); $('abState').textContent = 'Download abgebrochen.'; if (p) selectChannel(p.channel); });
api.onDownload('error', (p) => { setDownloading(false); resetDownloadUi(); $('abState').textContent = 'Download fehlgeschlagen.'; });

$('cancelDlBtn').onclick = () => api.installCancel();

async function startGameDownload(ch, version) {
  setDownloading(true);
  $('abState').textContent = 'Download wird vorbereitet…';
  const r = await api.installStart(ch, version);
  if (!r || !r.ok) {
    setDownloading(false); resetDownloadUi();
    $('abState').textContent = r && r.error === 'download_unavailable'
      ? 'Spiel wurde noch nicht veröffentlicht'
      : 'Download fehlgeschlagen.';
  }
}

/* ============================ INSTALL MODAL ============================ */
const installModal = $('installModal'), installScrim = $('installScrim');
let installChannel = 'live';
let installBase = '';

function fmtTarget(base, ch) {
  const sep = base.includes('\\') ? '\\' : '/';
  return base + sep + 'client' + sep + (ch === 'ptb' ? 'ptb' : 'live');
}
async function openInstallModal(ch) {
  if (!chState[ch] || !chState[ch].available) return;
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
  closeInstallModal();
  startGameDownload(installChannel, chState[installChannel] && chState[installChannel].latest);
};

/* ============================ SETTINGS DRAWER ============================ */
const drawer = $('settings'), scrim = $('scrim');
async function openDrawer() {
  $('launcherVer').textContent = 'v' + (await api.launcherVersion());
  const info = await api.installGetBase();
  $('setInstallPath').textContent = info.base;
  const s = await api.getSettings();
  $('rateInput').value = s && s.maxRateMBps ? s.maxRateMBps : '';
  await refreshUpdateBanner();
  scrim.hidden = false; drawer.classList.add('open');
}
function closeDrawer() { drawer.classList.remove('open'); scrim.hidden = true; }
$('gearBtn').onclick = openDrawer;
$('setClose').onclick = closeDrawer;
scrim.onclick = closeDrawer;
$('setPickFolder').onclick = async () => {
  const r = await api.installPickFolder();
  if (r && r.ok) { $('setInstallPath').textContent = r.base; selectChannel(channel); }
};
$('rateSave').onclick = async () => {
  const v = parseFloat($('rateInput').value) || 0;
  await api.setDownloadRate(v);
  $('updStatus').textContent = v > 0 ? ('Download-Limit: ' + v + ' MB/s gesetzt.') : 'Download-Limit aufgehoben (unbegrenzt).';
};

/* ---- launcher self-update + indicator (item 8) ---- */
async function refreshUpdateIndicator() {
  const v = await api.launcherUpdateAvailable();
  $('gearDot').hidden = !v;
}
async function refreshUpdateBanner() {
  const v = await api.launcherUpdateAvailable();
  if (v) { $('updBanner').hidden = false; $('updBannerVer').textContent = 'v' + v; }
  else { $('updBanner').hidden = true; }
}
$('updInstallBtn').onclick = () => { $('updStatus').textContent = 'Wird aktualisiert — Neustart…'; api.installLauncherUpdate(); };

$('updBtn').onclick = async () => {
  $('updStatus').textContent = 'Suche nach Updates…';
  const r = await api.checkLauncherUpdate();
  if (!r.ok) $('updStatus').textContent = 'Update-Prüfung fehlgeschlagen: kein Release verfügbar.';
};
api.onUpdate('checking', () => { $('updStatus').textContent = 'Suche nach Updates…'; });
api.onUpdate('available', (v) => { $('updStatus').textContent = 'Update ' + v + ' wird geladen…'; $('gearDot').hidden = false; refreshUpdateBanner(); });
api.onUpdate('progress', (p) => { $('updStatus').textContent = 'Update wird geladen… ' + p + '%'; });
api.onUpdate('downloaded', (v) => { $('gearDot').hidden = false; refreshUpdateBanner(); $('updStatus').innerHTML = 'Update ' + v + ' bereit.'; });
api.onUpdate('none', () => { $('updStatus').textContent = 'Launcher ist aktuell. ✔'; $('gearDot').hidden = true; });
api.onUpdate('error', () => { $('updStatus').textContent = 'Kein Update verfügbar / noch kein Release.'; });

/* ============================ FRIENDS & MESSAGING ============================ */
const fDrawer = $('friendsDrawer'), fScrim = $('friendsScrim');
let socialTimer = null, chatTimer = null;
let activeChat = null;
let lastMsgId = 0;

$('topFriendsBtn').onclick = openFriends;
$('friendsClose').onclick = closeFriends;
fScrim.onclick = closeFriends;

function openFriends() { fScrim.hidden = false; fDrawer.classList.add('open'); refreshSocial(); }
function closeFriends() { fDrawer.classList.remove('open'); fScrim.hidden = true; closeChat(); }

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function avatarLetter(name) { return (name || '?').charAt(0).toUpperCase(); }

async function refreshSocial() {
  const o = await api.socialOverview();
  if (!o || !o.ok) return;
  const badgeN = (o.incoming ? o.incoming.length : 0) + (o.unread || 0);
  const badge = $('friendsBadge');
  if (badgeN > 0) { badge.hidden = false; badge.textContent = badgeN > 99 ? '99+' : badgeN; }
  else badge.hidden = true;

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

async function loadChat() {
  if (!activeChat) return;
  const r = await api.socialMessages(activeChat.id, lastMsgId);
  if (!r || !r.ok || !r.messages || !r.messages.length) return;
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
  box.scrollTop = box.scrollHeight;
  refreshSocial();
}

$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeChat) return;
  const text = $('chatInput').value.trim();
  if (!text) return;
  $('chatInput').value = '';
  const r = await api.socialSend(activeChat.id, text);
  if (r && r.ok) { loadChat(); }
});

let _myId = null;
async function myId() {
  if (_myId != null) return _myId;
  const o = await api.socialOverview();
  if (o && o.ok && o.me) _myId = o.me.id;
  return _myId;
}

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
