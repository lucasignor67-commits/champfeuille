// ── Configuration ───────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwXP8rpXPkqfqbggXzArSzEAEJot21nyEAaL7Zr4jwnep_RL2kSvH5Yui-gLw9M3hbI6Q/exec';

// ── État ─────────────────────────────────────────────────────────
let state = { prenom: '', nom: '', matricule: '', duree: 0, tarif: 'normal', paiement: 'Facture' };

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
  state = { prenom: '', nom: '', matricule: '', duree: 0, tarif: 'normal', paiement: 'Facture' };
  syncTarifUI();
  syncPaiementUI();
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
  const prixUnit   = getPrixUnit();
  const now        = new Date();
  const date       = formatDate(now);
  const heureDebut = formatTime(now);
  const heureFin   = formatTime(new Date(now.getTime() + state.duree * 3600000));
  const temps      = state.duree + 'h';
  const prix       = state.duree * prixUnit;

  showSpinner(true, 'Enregistrement…');

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
    paiement:    state.paiement,
    statut:      'Fin',
  });

  const fullUrl = `${APPS_SCRIPT_URL}?${params.toString()}`;
  const MAX_RETRIES = 3;
  const TIMEOUT_MS  = 10000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (!navigator.onLine) {
      showSpinner(true, 'Pas de réseau, attente…');
      await new Promise(r => setTimeout(r, 2000));
      if (!navigator.onLine) {
        showSpinner(false);
        showError('error-matricule', 'Pas de connexion Internet. Vérifiez votre réseau puis réessayez.');
        showScreen('screen-matricule');
        return;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetch(fullUrl, { method: 'GET', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timer);
      if (typeof invalidateFrontendCache === 'function') invalidateFrontendCache();
      showSuccess(date, heureDebut, heureFin, temps, prix);
      return;
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[CHAMP] Tentative ${attempt}/${MAX_RETRIES} échouée :`, err.message);
      if (attempt < MAX_RETRIES) {
        const delay = 2000 * attempt;
        showSpinner(true, `Nouvelle tentative ${attempt + 1}/${MAX_RETRIES}…`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        showSpinner(false);
        showError('error-matricule', `Connexion impossible (${MAX_RETRIES} tentatives). Vérifiez votre réseau.`);
        showScreen('screen-matricule');
      }
    }
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
    row('Paiement', state.paiement) +
    `<div class="flex items-center justify-between px-3.5 py-3 bg-emerald-500/5 border-t border-emerald-500/10">
       <span class="text-xs text-neutral-400 font-semibold">Montant</span>
       <span class="text-sm font-bold text-emerald-400">${prixFmt}</span>
     </div>`;

  showScreen('screen-success');
}

// ── Paiement ─────────────────────────────────────────────────────
function togglePaiement() {
  state.paiement = (state.paiement === 'Feuille') ? 'Facture' : 'Feuille';
  syncPaiementUI();
}

function syncPaiementUI() {
  const btn   = document.getElementById('toggle-paiement');
  const thumb = document.getElementById('paiement-thumb');
  const label = document.getElementById('paiement-label');
  if (!btn) return;
  const isFeuille = state.paiement === 'Feuille';
  btn.setAttribute('aria-checked', String(isFeuille));
  if (isFeuille) {
    btn.style.backgroundColor = '#22c55e';
    btn.style.borderColor     = '#4ade80';
    thumb.style.backgroundColor = '#fff';
    thumb.style.transform       = 'translateX(16px)';
    if (label) label.textContent = 'Paiement en feuille';
  } else {
    btn.style.backgroundColor = '';
    btn.style.borderColor     = '';
    thumb.style.backgroundColor = '';
    thumb.style.transform       = '';
    if (label) label.textContent = 'Par défaut : Facture';
  }
}

// ── Tarifs ───────────────────────────────────────────────────────
function getPrixUnit() {
  if (['isla', 'gouv', 'patron'].includes(state.tarif)) return 0;
  if (state.tarif === 'employe') return Math.round(25000 * 0.85); // 21 250
  return 25000;
}

function setTarif(tarif) {
  state.tarif = (state.tarif === tarif) ? 'normal' : tarif;
  syncTarifUI();
}

function syncTarifUI() {
  ['isla', 'gouv', 'patron', 'employe'].forEach(t => {
    const btn = document.getElementById('tarif-' + t);
    if (!btn) return;
    const active = state.tarif === t;
    btn.style.borderColor     = active ? 'rgba(52,211,153,0.6)' : '';
    btn.style.backgroundColor = active ? 'rgba(52,211,153,0.05)' : '';
  });
}

function updateDureePrices() {
  const prixUnit = getPrixUnit();
  document.querySelectorAll('[data-dur-h]').forEach(el => {
    const h = parseInt(el.dataset.durH);
    el.textContent = prixUnit === 0 ? 'GRATUIT' : (h * prixUnit).toLocaleString('fr-FR') + ' $';
  });
  const label = document.getElementById('dur-label-prix');
  if (label) {
    if (prixUnit === 0) label.textContent = 'Accès gratuit';
    else if (state.tarif === 'employe') label.textContent = prixUnit.toLocaleString('fr-FR') + ' $ / heure (−15 %)';
    else label.textContent = prixUnit.toLocaleString('fr-FR') + ' $ par heure';
  }
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

function showSpinner(visible, text) {
  document.getElementById('spinner').classList.toggle('hidden', !visible);
  const el = document.getElementById('spinner-text');
  if (el && text) el.textContent = text;
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
