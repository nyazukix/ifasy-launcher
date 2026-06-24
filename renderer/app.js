// IFASY Launcher — renderer logic
const $ = (id) => document.getElementById(id);
const api = window.ifasy;
let channel = 'live';
// per-channel state: { available, latest, installedVersion, onDisk }
let chState = { live: {}, ptb: {} };
let downloading = false;        // true while a game download/update is streaming
let downloadingChannel = null;  // which channel is downloading

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

  // Don't disturb an in-progress download when the user just clicks around.
  if (downloading && ch === downloadingChannel) { renderActionState(ch); return; }

  const play = $('playBtn');
  play.hidden = false;
  play.className = 'btn btn--play' + (ptb ? ' ptb' : '');
  play.disabled = true; play.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> PRÜFE…';
  $('cancelDlBtn').hidden = true;
  $('progress').hidden = true; $('dlMeta').hidden = true;
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

// Single source of truth for the action area. Exactly one of these states is shown:
//   unpublished | install | downloading | play | update
function renderActionState(ch) {
  if (ch !== channel) return;
  const s = chState[ch];
  const play = $('playBtn');
  const uninstall = $('uninstallBtn');
  const cancel = $('cancelDlBtn');

  // ── DOWNLOADING: progress + Abbrechen ONLY (no play, no uninstall) ──
  if (downloading) {
    play.hidden = true; play.disabled = true; play.onclick = null;
    uninstall.hidden = true;
    cancel.hidden = false;
    $('progress').hidden = false; $('dlMeta').hidden = false;
    return;
  }

  // not downloading: play visible, cancel hidden, progress hidden
  cancel.hidden = true;
  $('progress').hidden = true; $('dlMeta').hidden = true;
  play.hidden = false; play.disabled = false;
  play.className = 'btn btn--play' + (ch === 'ptb' ? ' ptb' : '');

  if (!s.available) {
    // ── NOT PUBLISHED ──
    $('abState').textContent = 'Spiel wurde noch nicht veröffentlicht';
    play.disabled = true; play.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> BALD';
    play.onclick = null;
    uninstall.hidden = true;
    return;
  }

  if (!s.installed) {
    // ── PUBLISHED + NOT INSTALLED: Installieren ──
    $('abState').textContent = 'Version ' + s.latest + (s.size ? '  ·  ' + fmtBytes(s.size) : '');
    play.innerHTML = '<i class="fa-solid fa-download"></i> INSTALLIEREN';
    play.onclick = () => openInstallModal(ch);
    uninstall.hidden = true; // only when actually installed
    return;
  }

  // ── INSTALLED: Deinstallieren is visible ──
  uninstall.hidden = false;
  uninstall.onclick = () => doUninstall(ch);

  if (s.latest && s.installedVersion && String(s.installedVersion) !== String(s.latest)) {
    // INSTALLED + UPDATE: Updaten + Deinstallieren
    $('abState').textContent = 'Update verfügbar · ' + s.installedVersion + ' → ' + s.latest;
    play.classList.add('play--update');
    play.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i> UPDATEN';
    play.onclick = () => startGameDownload(ch, s.latest);
  } else {
    // INSTALLED + UP TO DATE: Spielen + Deinstallieren
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
function enterDownloading(ch) {
  downloading = true; downloadingChannel = ch;
  $('barFill').style.width = '0%';
  $('dlMeta').textContent = '';
  renderActionState(ch);
}
function exitDownloading() {
  downloading = false; downloadingChannel = null;
  $('barFill').style.width = '0%';
  $('dlMeta').textContent = '';
}

api.onDownload('progress', (p) => {
  if (!p || !downloading || p.channel !== downloadingChannel) return;
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
  exitDownloading();
  $('abState').textContent = 'Installation abgeschlossen.';
  selectChannel(p.channel); // re-reads status -> Spielen + Deinstallieren
});
api.onDownload('cancelled', (p) => {
  exitDownloading();
  $('abState').textContent = 'Download abgebrochen.';
  selectChannel((p && p.channel) || channel); // partial deleted server-side -> back to Installieren
});
api.onDownload('error', (p) => {
  exitDownloading();
  $('abState').textContent = 'Download fehlgeschlagen.';
  selectChannel((p && p.channel) || channel);
});

$('cancelDlBtn').onclick = () => { $('abState').textContent = 'Wird abgebrochen…'; api.installCancel(); };

async function startGameDownload(ch, version) {
  if (downloading) return; // guard against double-start
  enterDownloading(ch);
  $('abState').textContent = 'Download wird vorbereitet…';
  const r = await api.installStart(ch, version);
  // success path resolves via the 'done' event; only handle synchronous failures here
  if (!r || !r.ok) {
    exitDownloading();
    if (r && r.error === 'download_in_progress') return; // another download already running
    $('abState').textContent = r && r.error === 'download_unavailable'
      ? 'Spiel wurde noch nicht veröffentlicht'
      : 'Download fehlgeschlagen.';
    selectChannel(ch);
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
  $('rateHint').textContent = v > 0 ? ('Gespeichert: max ' + v + ' MB/s.') : 'Gespeichert: unbegrenzt.';
};

/* ---- launcher self-update + indicator (item 8) ---- */
async function refreshUpdateIndicator() {
  const v = await api.launcherUpdateAvailable();
  $('gearDot').hidden = !v;
}
async function refreshUpdateBanner() {
  const st = await api.launcherUpdateState();
  if (st && st.version) {
    $('updBanner').hidden = false;
    $('updBannerVer').textContent = 'v' + st.version;
    // restart action only meaningful once the update has finished downloading
    $('updInstallBtn').disabled = !st.downloaded;
    $('updInstallBtn').innerHTML = st.downloaded
      ? '<i class="fa-solid fa-rotate-right"></i> Aktualisieren &amp; neu starten'
      : '<i class="fa-solid fa-circle-notch fa-spin"></i> Wird geladen…';
  } else {
    $('updBanner').hidden = true;
  }
}
$('updInstallBtn').onclick = () => { $('updStatus').textContent = 'Wird aktualisiert — Neustart…'; api.installLauncherUpdate(); };

/* ---- robust update flow (C1): never dead-end on "wird geladen…" ---- */
let updStatusEl = null;
let updWatchdog = null;          // timeout that rescues a stuck download
let updChecking = false;
function setUpd(msg, kind) {
  updStatusEl = updStatusEl || $('updStatus');
  updStatusEl.textContent = msg || '';
  updStatusEl.className = 'drawer__msg' + (kind ? ' ' + kind : '');
}
function clearUpdWatchdog() { if (updWatchdog) { clearTimeout(updWatchdog); updWatchdog = null; } }
function armUpdWatchdog() {
  clearUpdWatchdog();
  // if no resolving event arrives in 45s, resolve to a clear state from main's truth
  updWatchdog = setTimeout(async () => {
    const st = await api.launcherUpdateState();
    if (st && st.downloaded) { showUpdateReady(st.version); }
    else if (st && st.version) { setUpd('Update ' + st.version + ' wird im Hintergrund geladen. Du kannst weiterspielen.', ''); }
    else { setUpd('Zeitüberschreitung bei der Update-Prüfung. Bitte erneut versuchen.', 'err'); }
    updChecking = false;
  }, 45000);
}
function showUpdateReady(v) {
  clearUpdWatchdog();
  updChecking = false;
  $('gearDot').hidden = false;
  refreshUpdateBanner();
  setUpd('Update ' + (v ? v + ' ' : '') + 'bereit zum Installieren.', 'ok');
}

$('updBtn').onclick = async () => {
  // manual button always re-triggers a fresh check and resolves to a clear state,
  // even if a previous check left the UI mid-"wird geladen…".
  clearUpdWatchdog();
  updChecking = true;
  setUpd('Suche nach Updates…', '');
  armUpdWatchdog();
  const r = await api.checkLauncherUpdate();
  if (!r || !r.ok) { clearUpdWatchdog(); updChecking = false; setUpd('Update-Prüfung fehlgeschlagen: ' + ((r && r.error) || 'kein Release verfügbar') + '.', 'err'); return; }
  // resolve immediately from the returned truth (events may also fire)
  if (r.downloaded) { showUpdateReady(r.version); }
  else if (r.hasUpdate) { setUpd('Update ' + r.version + ' wird geladen…', ''); /* watchdog still armed */ }
  else { clearUpdWatchdog(); updChecking = false; $('gearDot').hidden = true; setUpd('Launcher ist aktuell. ✔', 'ok'); }
};

api.onUpdate('checking', () => { setUpd('Suche nach Updates…', ''); });
api.onUpdate('available', (v) => { $('gearDot').hidden = false; refreshUpdateBanner(); setUpd('Update ' + v + ' wird geladen…', ''); armUpdWatchdog(); });
api.onUpdate('progress', (p) => { armUpdWatchdog(); setUpd('Update wird geladen… ' + p + '%', ''); });
api.onUpdate('downloaded', (v) => { showUpdateReady(v); });
api.onUpdate('none', () => { clearUpdWatchdog(); updChecking = false; $('gearDot').hidden = true; setUpd('Launcher ist aktuell. ✔', 'ok'); });
api.onUpdate('error', (msg) => { clearUpdWatchdog(); updChecking = false; setUpd('Update fehlgeschlagen / kein Release verfügbar.', 'err'); });

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
