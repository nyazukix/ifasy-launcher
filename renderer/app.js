// IFASY Launcher — renderer logic
const $ = (id) => document.getElementById(id);
const api = window.ifasy;
let channel = 'live';

/* ---- window controls ---- */
$('minBtn').onclick = () => api.minimize();
$('closeBtn').onclick = () => api.close();

/* ---- login ---- */
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

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('identifier').value.trim();
  const pw = $('password').value;
  if (!id || !pw) return setMsg('Bitte beide Felder ausfüllen.', 'err');
  loginBtn.disabled = true; spinner.hidden = false; lbLabel.textContent = 'PRÜFE…'; setMsg('');
  const res = await api.login(id, pw);
  loginBtn.disabled = false; spinner.hidden = true; lbLabel.textContent = 'EINLOGGEN';
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
  document.body.className = 'state-app';      // <-- robust layer switch
  selectChannel('live');
}

$('logoutBtn').onclick = () => {
  document.body.className = 'state-login';
  $('password').value = ''; setMsg('');
  $('identifier').focus();
};

/* ---- channels ---- */
document.querySelectorAll('.game').forEach((b) => b.addEventListener('click', () => selectChannel(b.dataset.channel)));

async function selectChannel(ch) {
  channel = ch;
  const ptb = ch === 'ptb';
  document.querySelectorAll('.game').forEach((b) => b.classList.toggle('game--active', b.dataset.channel === ch));
  $('heroChip').textContent = ptb ? 'PTB · DEV' : 'LIVE';
  $('heroChip').classList.toggle('ptb', ptb);
  $('heroArt').classList.toggle('ptb', ptb);
  $('heroDesc').textContent = ptb
    ? 'Public Test Build — neueste Dev-Version zum Testen. Kann instabil sein.'
    : 'Überlebe die Horde — solo oder im Koop bis zu 4 Spieler.';
  $('setChannel').textContent = ptb ? 'PTB' : 'LIVE';

  const play = $('playBtn');
  play.classList.toggle('ptb', ptb);
  play.disabled = true; play.textContent = 'PRÜFE…';
  $('abState').textContent = 'Version wird geladen…';

  const v = await api.gameVersion(ch);
  if (v && v.available) {
    $('abState').textContent = 'Version ' + v.version + (v.size ? '  ·  ' + (v.size / 1048576).toFixed(0) + ' MB' : '');
    play.disabled = false; play.textContent = 'HERUNTERLADEN';
    play.onclick = () => api.downloadGame(ch);
  } else {
    $('abState').textContent = ptb ? 'Noch kein PTB-Build veröffentlicht.' : 'Noch kein Build veröffentlicht.';
    play.disabled = true; play.textContent = 'BALD';
  }
}

/* ---- settings drawer + self-update ---- */
const drawer = $('settings'), scrim = $('scrim');
async function openDrawer() {
  $('launcherVer').textContent = 'v' + (await api.launcherVersion());
  scrim.hidden = false; drawer.classList.add('open');
}
function closeDrawer() { drawer.classList.remove('open'); scrim.hidden = true; }
$('gearBtn').onclick = openDrawer;
$('setClose').onclick = closeDrawer;
scrim.onclick = closeDrawer;

$('updBtn').onclick = async () => {
  $('updStatus').textContent = 'Suche nach Updates…';
  const r = await api.checkLauncherUpdate();
  if (!r.ok) $('updStatus').textContent = 'Noch kein Release zum Updaten vorhanden.';
};
api.onUpdate('available', (v) => { $('updStatus').textContent = 'Update ' + v + ' wird geladen…'; });
api.onUpdate('downloaded', (v) => { $('updStatus').innerHTML = 'Update ' + v + ' bereit — <b>Neustart…</b>'; setTimeout(() => api.installLauncherUpdate(), 1200); });
api.onUpdate('none', () => { $('updStatus').textContent = 'Launcher ist aktuell. ✔'; });
api.onUpdate('error', () => { $('updStatus').textContent = 'Kein Update verfügbar / noch kein Release.'; });
