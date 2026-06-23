// IFASY Launcher — renderer logic
const $ = (id) => document.getElementById(id);
const api = window.ifasy;

let currentChannel = 'live';

/* ---------- window controls ---------- */
$('minBtn').onclick = () => api.minimize();
$('closeBtn').onclick = () => api.close();

/* ---------- login ---------- */
const loginBtn = $('loginBtn');
const lblabel = loginBtn.querySelector('.btn-label');
const spinner = loginBtn.querySelector('.spinner');
const ERR = {
  invalid_credentials: 'Benutzername oder Passwort falsch.',
  banned: 'Dieses Konto ist gesperrt.',
  network_error: 'Keine Verbindung zum Server.',
  bad_response: 'Unerwartete Server-Antwort.',
  server_error: 'Serverfehler. Bitte später erneut.',
};
function loginStatus(msg, kind) { const e = $('loginStatus'); e.textContent = msg || ''; e.className = 'status' + (kind ? ' ' + kind : ''); }

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('identifier').value.trim();
  const pw = $('password').value;
  if (!id || !pw) return loginStatus('Bitte beide Felder ausfüllen.', 'err');
  loginBtn.disabled = true; spinner.hidden = false; lblabel.textContent = 'PRÜFE…'; loginStatus('');
  const res = await api.login(id, pw);
  loginBtn.disabled = false; spinner.hidden = true; lblabel.textContent = 'EINLOGGEN';
  if (res && res.data && res.data.ok) {
    loginStatus('Angemeldet ✔', 'ok');
    setTimeout(() => enterShell(res.data.user || {}), 300);
  } else {
    loginStatus(ERR[(res && res.data && res.data.error)] || 'Login fehlgeschlagen.', 'err');
  }
});

/* ---------- enter main shell ---------- */
function enterShell(user) {
  $('loginOverlay').hidden = true;
  $('shell').hidden = false;
  $('userName').textContent = user.username || user.email || 'Spieler';
  $('userRole').textContent = user.role || 'user';
  $('avatar').textContent = (user.username || user.email || '?').charAt(0).toUpperCase();
  // dev users default to PTB tab being relevant; everyone sees both
  selectChannel('live');
}

$('logoutBtn').onclick = () => { $('shell').hidden = true; $('loginOverlay').hidden = false; $('password').value = ''; loginStatus(''); };

/* ---------- channels ---------- */
document.querySelectorAll('.channel').forEach((btn) => {
  btn.addEventListener('click', () => selectChannel(btn.dataset.channel));
});

async function selectChannel(channel) {
  currentChannel = channel;
  document.querySelectorAll('.channel').forEach((b) => b.classList.toggle('active', b.dataset.channel === channel));
  const isPtb = channel === 'ptb';
  $('heroBadge').textContent = isPtb ? 'PTB · DEV' : 'LIVE';
  $('heroBadge').classList.toggle('ptb', isPtb);
  $('heroBg').classList.toggle('ptb', isPtb);
  $('heroNews').textContent = isPtb
    ? 'Public Test Build — neueste Dev-Version zum Testen. Kann instabil sein.'
    : 'Überlebe die Horde. Solo oder im Koop bis zu 4 Spieler.';
  const playBtn = $('playBtn');
  playBtn.classList.toggle('ptb', isPtb);
  playBtn.disabled = true; playBtn.textContent = 'PRÜFE…';
  $('abState').textContent = 'Version wird geladen…';

  const v = await api.gameVersion(channel);
  if (v && v.available) {
    $('abState').textContent = 'Version ' + v.version + (v.size ? '  ·  ' + (v.size / 1048576).toFixed(0) + ' MB' : '');
    playBtn.disabled = false; playBtn.textContent = 'HERUNTERLADEN';
    playBtn.onclick = () => api.downloadGame(channel);
  } else {
    $('abState').textContent = isPtb ? 'Noch kein PTB-Build veröffentlicht.' : 'Noch kein Build veröffentlicht.';
    playBtn.disabled = true; playBtn.textContent = 'BALD';
  }
}

/* ---------- settings / self-update ---------- */
const settings = $('settings');
$('gearBtn').onclick = async () => { settings.hidden = false; $('launcherVer').textContent = 'v' + (await api.launcherVersion()); };
$('setClose').onclick = () => { settings.hidden = true; };
$('updBtn').onclick = async () => {
  $('updStatus').textContent = 'Suche nach Updates…';
  const r = await api.checkLauncherUpdate();
  if (!r.ok) $('updStatus').textContent = 'Update-Prüfung fehlgeschlagen (noch kein Release?).';
};
api.onUpdate('available', (v) => { $('updStatus').textContent = 'Update ' + v + ' wird geladen…'; });
api.onUpdate('downloaded', (v) => {
  $('updStatus').innerHTML = 'Update ' + v + ' bereit. <b>Neustart…</b>';
  setTimeout(() => api.installLauncherUpdate(), 1200);
});
api.onUpdate('none', () => { $('updStatus').textContent = 'Launcher ist aktuell. ✔'; });
api.onUpdate('error', () => { $('updStatus').textContent = 'Kein Update verfügbar / noch kein Release.'; });
