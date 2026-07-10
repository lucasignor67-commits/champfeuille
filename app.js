// ── Configuration ───────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxlln8ZaZ_W4ZdA62KCENvR_KJULAQUe8W0k808_VOfvFAn-ilB5VdGVTBRuYlmtz7ryg/exec';

// ── État ─────────────────────────────────────────────────────────
let state = { prenom: '', nom: '', matricule: '', duree: 0, laIsla: false };

// ── Navigation ───────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (window.lucide) lucide.createIcons();
}

function goTo(id) {
  hideError('error-identite');
  hideError('error-matricule');
  showScreen(id);
}

function startContract() {
  document.getElementById('prenom-input').value = '';
  document.getElementById('nom-input').value = '';
  document.getElementById('matricule-input').value = '';
  state = { prenom: '', nom: '', matricule: '', duree: 0, laIsla: false };
  syncBagheraUI();
  showScreen('screen-identite');
  setTimeout(() => document.getElementById('nom-input').focus(), 100);
}

function restart() {
  showScreen('screen-home');
}

// ── Étape 1 : Identité ────────────────────────────────────────────
function submitIdentite() {
  const prenom = document.getElementById('prenom-input').value.trim();
  const nom    = document.getElementById('nom-input').value.trim();

  if (!prenom || !nom) {
    showError('error-identite', 'Veuillez renseigner le prénom et le nom.');
    return;
  }

  state.prenom = capitalize(prenom);
  state.nom    = capitalize(nom);
  hideError('error-identite');
  showScreen('screen-matricule');
  setTimeout(() => document.getElementById('matricule-input').focus(), 100);
}

// ── Étape 2 : Matricule ──────────────────────────────────────────
function submitMatricule() {
  const raw = document.getElementById('matricule-input').value.trim().toUpperCase();

  if (!raw) {
    showError('error-matricule', 'Veuillez saisir le matricule.');
    return;
  }

  state.matricule = raw;
  hideError('error-matricule');
  updateDureePrices();
  showScreen('screen-duree');
}

// ── Étape 3 : Durée ──────────────────────────────────────────────
function submitDuree(heures) {
  state.duree = heures;
  sendToSheets();
}

// ── Envoi ────────────────────────────────────────────────────────
async function sendToSheets() {
  const prixUnit   = state.laIsla ? 10000 : 20000;
  const now        = new Date();
  const date       = formatDate(now);
  const heureDebut = formatTime(now);
  const heureFin   = formatTime(new Date(now.getTime() + state.duree * 3600000));
  const temps      = state.duree + 'h';
  const prix       = state.duree * prixUnit;

  showSpinner(true);

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'VOTRE_URL_ICI') {
    setTimeout(() => {
      showSpinner(false);
      showSuccess(date, heureDebut, heureFin, temps, prix);
    }, 600);
    return;
  }

  const params = new URLSearchParams({
    prenom:      state.prenom,
    nom:         state.nom,
    matricule:   state.matricule,
    heure_debut: heureDebut,
    heure_fin:   heureFin,
    temps,
    prix,
    statut:      'Fin',
  });

  const fullUrl = `${APPS_SCRIPT_URL}?${params.toString()}`;
  console.log('[CHAMP] URL envoyée :', fullUrl);

  try {
    await fetch(fullUrl, { method: 'GET', mode: 'no-cors' });
    showSuccess(date, heureDebut, heureFin, temps, prix);
  } catch (err) {
    showSpinner(false);
    console.error(err);
    showError('error-matricule', 'Erreur réseau. Vérifiez votre connexion.');
    showScreen('screen-matricule');
  }
}

// ── Succès ───────────────────────────────────────────────────────
function showSuccess(date, heureDebut, heureFin, temps, prix) {
  showSpinner(false);

  const prixFmt = prix.toLocaleString('fr-FR') + ' $';

  const row = (label, val, accent = false) =>
    `<div class="flex items-center justify-between px-3.5 py-2.5">
       <span class="text-xs text-neutral-500 font-medium">${label}</span>
       <span class="text-xs font-semibold ${accent ? 'text-emerald-400' : 'text-neutral-200'}">${val}</span>
     </div>`;

  document.getElementById('success-details').innerHTML =
    row('Client',  `${state.prenom} ${state.nom}`) +
    row('Matricule', state.matricule) +
    row('Date',    date) +
    row('Horaire', `${heureDebut} → ${heureFin}`) +
    row('Durée',   temps) +
    `<div class="flex items-center justify-between px-3.5 py-3 bg-emerald-500/5 border-t border-emerald-500/10">
       <span class="text-xs text-neutral-400 font-semibold">Montant</span>
       <span class="text-sm font-bold text-emerald-400">${prixFmt}</span>
     </div>`;

  showScreen('screen-success');
}

// ── Tarif La Isla Baghera ────────────────────────────────────────
function toggleBaghera() {
  state.laIsla = !state.laIsla;
  syncBagheraUI();
}

function syncBagheraUI() {
  const btn   = document.getElementById('toggle-baghera');
  const thumb = document.getElementById('toggle-thumb');
  if (!btn) return;
  btn.setAttribute('aria-checked', String(state.laIsla));
  if (state.laIsla) {
    btn.style.backgroundColor = '#22c55e';
    btn.style.borderColor     = '#4ade80';
    thumb.style.backgroundColor = '#fff';
    thumb.style.transform       = 'translateX(16px)';
  } else {
    btn.style.backgroundColor = '';
    btn.style.borderColor     = '';
    thumb.style.backgroundColor = '';
    thumb.style.transform       = '';
  }
}

function updateDureePrices() {
  const prixUnit = state.laIsla ? 10000 : 20000;
  document.querySelectorAll('[data-dur-h]').forEach(el => {
    const h = parseInt(el.dataset.durH);
    el.textContent = (h * prixUnit).toLocaleString('fr-FR') + ' $';
  });
  const label = document.getElementById('dur-label-prix');
  if (label) label.textContent = prixUnit.toLocaleString('fr-FR') + ' $ par heure';
}

// ── Helpers ──────────────────────────────────────────────────────
function showError(id, msg) {
  const el   = document.getElementById(id);
  const span = document.getElementById(id + '-text');
  if (span) span.textContent = msg;
  else el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showSpinner(visible) {
  document.getElementById('spinner').classList.toggle('hidden', !visible);
}

function formatDate(d) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return h + 'h' + m;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ── Touches Entrée ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nom-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('prenom-input').focus();
  });
  document.getElementById('prenom-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitIdentite();
  });
  document.getElementById('matricule-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitMatricule();
  });
});
