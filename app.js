// ── Configuration ───────────────────────────────────────────────
// Remplacez par l'URL de déploiement de votre Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzq7_P9QTbIkLKZDXIPnDBHO-1bKutMae1pLwFHiX9vjBo5IOiS9DVrba3KTIJ3SKEJdw/exec';

// ── État ─────────────────────────────────────────────────────────
let state = { prenom: '', nom: '', matricule: '', duree: 0 };

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
  state = { prenom: '', nom: '', matricule: '', duree: 0 };
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
  showScreen('screen-duree');
}

// ── Étape 3 : Durée ──────────────────────────────────────────────
function submitDuree(heures) {
  state.duree = heures;
  sendToSheets();
}

// ── Envoi ────────────────────────────────────────────────────────
async function sendToSheets() {
  const now        = new Date();
  const date       = formatDate(now);
  const heureDebut = formatTime(now);
  const heureFin   = formatTime(new Date(now.getTime() + state.duree * 3600000));
  const temps      = state.duree + 'h';
  const prix       = state.duree * 15000;

  showSpinner(true);

  // Si pas d'URL configurée, on simule le succès directement
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
    statut:      'Fin',
  });

  const fullUrl = `${APPS_SCRIPT_URL}?${params.toString()}`;
  console.log('[CHAMP] URL envoyée :', fullUrl);

  try {
    await fetch(fullUrl, {
      method: 'GET',
      mode: 'no-cors',
    });
    console.log('[CHAMP] fetch terminé (réponse opaque = normal avec no-cors)');
    showSuccess(date, heureDebut, heureFin, temps, prix);
  } catch (err) {
    showSpinner(false);
    // En cas d'erreur réseau, on affiche quand même le succès
    // (réponse opaque avec no-cors = on ne peut pas détecter les erreurs serveur)
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
