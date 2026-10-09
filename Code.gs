// ===============================================================
//  CHAMP - Google Apps Script
//  Colonnes :
//    A  DATE       B  PRENOM    C  NOM       D  Matricule
//    E  HEURE DEBUT  F  HEURE FIN  G  Temps  H  PRIX  I  STATUT
// ===============================================================

// Personnes dont les stats sont affichées dans l'écran Suivi semaine
var PERSONNES_SUIVIES = ['MAMIE', 'LOUGACE'];

// ---------------------------------------------------------------
//  CACHE HELPER  (TTL en secondes, max 21600 = 6h)
// ---------------------------------------------------------------
function withCache(key, ttl, fn) {
  var cache = CacheService.getScriptCache();
  var hit   = cache.get(key);
  if (hit) return JSON.parse(hit);
  var result = fn();
  try { cache.put(key, JSON.stringify(result), ttl); } catch(e) {}
  return result;
}

function invalidateReadCaches() {
  CacheService.getScriptCache().removeAll(
    ['get_contrats', 'get_termines', 'get_mamie_stats', 'get_suivi']
  );
}

function doGet(e) {
  try {
    if (!e || !e.parameter) {
      return jsonOk({ success: false, error: 'Utiliser l URL de deploiement /exec' });
    }

    var p = e.parameter;

    // Ping keep-alive (réchauffe le script sans toucher au sheet)
    if (p.action === 'ping') {
      return ContentService.createTextOutput('ok')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // ── Lectures JSONP (avec cache 30 s) ──────────────────────────
    var readAction = p.action;
    var readData   = null;
    var readKey    = '';

    if (readAction === 'get_contrats' || readAction === 'get_termines') {
      readKey  = readAction;
      readData = withCache(readKey, 30, function() {
        return { contrats: readAction === 'get_termines' ? getTerminesData() : getContratsData() };
      });
      var jsonC = JSON.stringify({ success: true, contrats: readData.contrats });
      var cbC   = (p.callback || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (cbC) return ContentService.createTextOutput(cbC + '(' + jsonC + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
      return ContentService.createTextOutput(jsonC).setMimeType(ContentService.MimeType.JSON);
    }

    if (readAction === 'get_suivi') {
      var semPrec   = p.semaine === 'prec';
      var suiviData = withCache(semPrec ? 'get_suivi_prec' : 'get_suivi', 30, function() { return getSuivi(semPrec); });
      suiviData.success = true;
      var jsonS = JSON.stringify(suiviData);
      var cbS   = (p.callback || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (cbS) return ContentService.createTextOutput(cbS + '(' + jsonS + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
      return ContentService.createTextOutput(jsonS).setMimeType(ContentService.MimeType.JSON);
    }

    if (readAction === 'get_mamie_stats') {
      var statsData = withCache('get_mamie_stats', 30, function() { return { stats: getMamieStats() }; });
      var jsonM = JSON.stringify({ success: true, stats: statsData.stats });
      var cbM   = (p.callback || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (cbM) return ContentService.createTextOutput(cbM + '(' + jsonM + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
      return ContentService.createTextOutput(jsonM).setMimeType(ContentService.MimeType.JSON);
    }

    var prenom     = (p.prenom      || '').trim();
    var nom        = (p.nom         || '').trim();
    var matricule  = (p.matricule   || '').trim();
    var heureDebut = (p.heure_debut || '').trim();
    var heureFin   = (p.heure_fin   || '').trim();
    var temps      = (p.temps       || '').trim();
    var prixParam  = (p.prix !== undefined && p.prix !== '') ? (parseInt(p.prix, 10) || 0) : -1;
    var paiement   = (p.paiement || 'Facture').trim();

    if (!prenom || !nom || !matricule || !temps) {
      return jsonOk({ success: false, error: 'Champs obligatoires manquants' });
    }

    // Déduplication : un même rid (identifiant du contrat côté site) n'est écrit qu'une fois
    var rid = (p.rid || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!rid) {
      enregistrer(prenom, nom, matricule, heureDebut, heureFin, temps, prixParam, paiement);
      return jsonOk({ success: true });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var ridCache = CacheService.getScriptCache();
      if (ridCache.get('rid_' + rid)) {
        return jsonOk({ success: true, duplicate: true });
      }
      enregistrer(prenom, nom, matricule, heureDebut, heureFin, temps, prixParam, paiement);
      ridCache.put('rid_' + rid, '1', 21600);
    } finally {
      lock.releaseLock();
    }

    return jsonOk({ success: true });
  } catch (err) {
    Logger.log('doGet erreur : ' + err.message);
    return jsonOk({ success: false, error: err.message });
  }
}

// ---------------------------------------------------------------
//  LECTURE DES CONTRATS EN COURS
// ---------------------------------------------------------------
function getTerminesData() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var contrats = [];
  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    if (!row[1] || row[1] === '') continue;
    var statut = String(row[8]).trim().toUpperCase();
    if (statut !== 'FIN DE CONTRAT' && statut !== 'FIN') continue;
    contrats.push({
      prenom:      String(row[1]),
      nom:         String(row[2]),
      matricule:   String(row[3]),
      heure_debut: String(row[4]),
      heure_fin:   String(row[5]),
      temps:       String(row[6]),
      prix:        row[7],
      paiement:    String(row[9] || 'Facture'),
      date:        String(row[0])
    });
  }
  // Les 10 derniers (fin de tableau = plus récents)
  return contrats.slice(-10).reverse();
}

function getContratsData() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var contrats = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1] || row[1] === '') continue;
    if (String(row[8]).trim().toUpperCase() !== 'EN COURS') continue;
    contrats.push({
      prenom:      String(row[1]),
      nom:         String(row[2]),
      matricule:   String(row[3]),
      heure_debut: String(row[4]),
      heure_fin:   String(row[5]),
      temps:       String(row[6]),
      prix:        row[7],
      paiement:    String(row[9] || 'Facture')
    });
  }
  return contrats;
}

// ---------------------------------------------------------------
//  ECRITURE
// ---------------------------------------------------------------
function enregistrer(prenom, nom, matricule, heureDebut, heureFin, temps, prixFrontend, paiement) {
  // prixFrontend = -1 signifie "non fourni" (fallback calcul), 0 = gratuit intentionnel
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];

  var now      = new Date();
  var date     = Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var heures   = parseInt(temps, 10) || 1;
  var prix     = (prixFrontend >= 0) ? prixFrontend : (heures * 25000);
  var modePaie = paiement || 'Facture';

  // Ajoute l'entête colonne J si absent
  if (!sheet.getRange(1, 10).getValue()) {
    sheet.getRange(1, 10).setValue('PAIEMENT');
  }

  // getLastRow() = O(1) au lieu de scanner toute la colonne B
  var newRow = Math.max(sheet.getLastRow() + 1, 2);

  // Écriture en 1 seul appel (10x moins de round-trips)
  sheet.getRange(newRow, 1, 1, 10).setValues([[
    date, prenom, nom, matricule, heureDebut, heureFin, temps, prix, 'EN COURS', modePaie
  ]]);
  SpreadsheetApp.flush();

  // Invalide les caches de lecture immédiatement
  invalidateReadCaches();
}

// ---------------------------------------------------------------
//  APPELÉ AUTOMATIQUEMENT — scanne toutes les lignes EN COURS
//  dont l'heure de fin est passée et les passe en "Fin de contrat"
// ---------------------------------------------------------------
function mettreAJourStatut(e) {
  // 1. Récupération de la feuille
  var ss, sheet;
  try {
    ss    = SpreadsheetApp.getActiveSpreadsheet();
    sheet = ss.getSheets()[0];
    if (!sheet) throw new Error('Aucune feuille trouvée dans le classeur');
  } catch(err) {
    Logger.log('ERREUR feuille : ' + err.message);
    return;
  }

  // 2. Heure actuelle en minutes
  var now    = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();

  // 3. Lecture des données
  var data;
  try {
    var range = sheet.getDataRange();
    if (!range) throw new Error('Plage de données vide');
    data = range.getValues();
    if (data.length <= 1) {
      Logger.log('Aucune donnée à traiter (tableau vide)');
      return;
    }
  } catch(err) {
    Logger.log('ERREUR lecture données : ' + err.message);
    return;
  }

  // 4. Scan des lignes EN COURS
  for (var i = 1; i < data.length; i++) {
    try {
      if (data[i][8] !== 'EN COURS') continue;

      // HEURE FIN (colonne F, index 5)
      var rawFin = data[i][5];
      if (rawFin === null || rawFin === undefined || rawFin === '') {
        Logger.log('Ligne ' + (i+1) + ' : HEURE FIN vide, ignorée');
        continue;
      }
      var strFin = String(rawFin).toLowerCase().trim();
      var sepFin = strFin.indexOf('h');
      if (sepFin === -1) {
        Logger.log('Ligne ' + (i+1) + ' : format HEURE FIN invalide ("' + rawFin + '"), ignorée');
        continue;
      }
      var hFin = parseInt(strFin.substring(0, sepFin), 10);
      var mFin = parseInt(strFin.substring(sepFin + 1), 10);
      if (isNaN(hFin)) {
        Logger.log('Ligne ' + (i+1) + ' : heures non lisibles ("' + strFin + '"), ignorée');
        continue;
      }
      if (isNaN(mFin)) mFin = 0;
      var finMin = hFin * 60 + mFin;

      // HEURE DEBUT (colonne E, index 4) — pour détecter le passage minuit
      var debutMin = -1;
      var rawDebut = data[i][4];
      if (rawDebut !== null && rawDebut !== undefined && rawDebut !== '') {
        var strDebut = String(rawDebut).toLowerCase().trim();
        var sepDebut = strDebut.indexOf('h');
        if (sepDebut !== -1) {
          var hDebut = parseInt(strDebut.substring(0, sepDebut), 10);
          var mDebut = parseInt(strDebut.substring(sepDebut + 1), 10);
          if (!isNaN(hDebut)) debutMin = hDebut * 60 + (isNaN(mDebut) ? 0 : mDebut);
        }
      }

      // Contrat passant minuit (ex: 20h→02h) : finMin < debutMin
      // Dans ce cas, terminé seulement si on est après minuit (nowMin < debutMin) ET passé finMin
      var crossesMidnight = (debutMin >= 0) && (finMin < debutMin);
      var depasse = crossesMidnight
        ? (nowMin < debutMin) && (nowMin >= finMin)
        : nowMin >= finMin;

      if (!depasse) continue;

      // 5. Mise à jour du statut
      try {
        sheet.getRange(i + 1, 9).setValue('Fin de contrat');
        Logger.log('Ligne ' + (i+1) + ' passée en Fin de contrat (' + rawFin + ')');
      } catch(errWrite) {
        Logger.log('ERREUR écriture ligne ' + (i+1) + ' : ' + errWrite.message +
          ' — vérifier la validation de données colonne I');
      }

    } catch(errRow) {
      Logger.log('ERREUR ligne ' + (i+1) + ' : ' + errRow.message);
    }
  }

  // 6. Flush
  try {
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('ERREUR flush : ' + err.message);
  }

  // Invalide le cache si des statuts ont changé
  CacheService.getScriptCache().removeAll(['get_contrats', 'get_termines']);

  // Le déclencheur toutes les minutes est permanent — ne pas le supprimer
}

// ---------------------------------------------------------------
//  SUIVI SEMAINE PAR PERSONNE
// ---------------------------------------------------------------
var PRIX_HEURE    = 25000; // plein tarif, sert au calcul du manque à gagner
var JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Index du jour (0 = lundi … 6 = dimanche), -1 si la date est illisible
function jourSemaine(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return -1;
    return parseInt(Utilities.formatDate(v, tz, 'u'), 10) - 1;
  }
  var m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return -1;
  return (new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getDay() + 6) % 7;
}

function lireLignesSuivi(sheet, tz) {
  var data   = sheet.getDataRange().getValues();
  var lignes = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1] || row[1] === '') continue;
    lignes.push({
      matricule: String(row[3]).trim().toUpperCase(),
      heures:    parseInt(String(row[6]).replace(/[^0-9]/g, ''), 10) || 0,
      montant:   Number(row[7]) || 0,
      feuille:   String(row[9] || '').trim().toUpperCase() === 'FEUILLE',
      jour:      jourSemaine(row[0], tz)
    });
  }
  return lignes;
}

function nouvelAgregat(matricule) {
  return { matricule: matricule, contrats: 0, heures: 0, montant: 0, facture: 0, feuille: 0 };
}

function cumuler(agg, l) {
  agg.contrats++;
  agg.heures  += l.heures;
  agg.montant += l.montant;
  if (l.feuille) agg.feuille += l.montant; else agg.facture += l.montant;
}

// Vrai si la feuille a la structure d'une feuille de contrats (PRENOM en B1)
function estFeuilleContrats(sheet) {
  var enTete = String(sheet.getRange(1, 2).getValue())
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return enTete.indexOf('PRENOM') !== -1;
}

// semainePrec = true : stats de la semaine dernière (2e feuille) au lieu de la semaine en cours
function getSuivi(semainePrec) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var tz     = ss.getSpreadsheetTimeZone();

  if (semainePrec && (sheets.length < 2 || !estFeuilleContrats(sheets[1]))) {
    return { suivi: [], tiers: [], precedent: null };
  }
  var lignes = lireLignesSuivi(sheets[semainePrec ? 1 : 0], tz);

  var suivis       = PERSONNES_SUIVIES.map(function(m) { return nouvelAgregat(m); });
  var suiviesUpper = PERSONNES_SUIVIES.map(function(m) { return m.toUpperCase(); });

  // Personnes hors liste : un total + le détail par matricule
  var tiersTotal  = nouvelAgregat('Personnes tiers');
  tiersTotal.isTiers = true;
  var tiersParMat = {};

  var paiement = { facture: { contrats: 0, montant: 0 }, feuille: { contrats: 0, montant: 0 } };
  var tarifs   = { plein: 0, reduit: 0, offert: 0, manque: 0 };
  var jours    = JOURS_SEMAINE.map(function(j) { return { jour: j, contrats: 0, montant: 0 }; });

  lignes.forEach(function(l) {
    var idx = suiviesUpper.indexOf(l.matricule);
    if (idx !== -1) {
      cumuler(suivis[idx], l);
    } else {
      var key = l.matricule || '—';
      if (!tiersParMat[key]) tiersParMat[key] = nouvelAgregat(key);
      cumuler(tiersParMat[key], l);
      cumuler(tiersTotal, l);
    }

    var mode = l.feuille ? paiement.feuille : paiement.facture;
    mode.contrats++;
    mode.montant += l.montant;

    var plein = l.heures * PRIX_HEURE;
    if (l.montant === 0)        tarifs.offert++;
    else if (l.montant < plein) tarifs.reduit++;
    else                        tarifs.plein++;
    tarifs.manque += Math.max(0, plein - l.montant);

    if (l.jour >= 0) {
      jours[l.jour].contrats++;
      jours[l.jour].montant += l.montant;
    }
  });
  suivis.push(tiersTotal);

  // Semaine précédente = 2e feuille (l'ancienne, après la rotation du dimanche)
  // aDate = cumul jusqu'au même jour de la semaine, pour comparer à périmètre égal
  var precedent = null;
  if (!semainePrec && sheets.length > 1 && estFeuilleContrats(sheets[1])) {
    var auj = jourSemaine(new Date(), tz);
    precedent = { contrats: 0, heures: 0, montant: 0, aDate: { contrats: 0, heures: 0, montant: 0 } };
    lireLignesSuivi(sheets[1], tz).forEach(function(l) {
      precedent.contrats++;
      precedent.heures  += l.heures;
      precedent.montant += l.montant;
      if (l.jour <= auj) {
        precedent.aDate.contrats++;
        precedent.aDate.heures  += l.heures;
        precedent.aDate.montant += l.montant;
      }
    });
    if (!precedent.contrats) precedent = null;
  }

  return {
    suivi:     suivis,
    tiers:     Object.keys(tiersParMat).map(function(k) { return tiersParMat[k]; }),
    paiement:  paiement,
    tarifs:    tarifs,
    jours:     jours,
    precedent: precedent
  };
}

// ---------------------------------------------------------------
//  STATS MAMIE
// ---------------------------------------------------------------
function getMamieStats() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  var total = 0, todayCount = 0;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1] || row[1] === '') continue;
    if (String(row[3]).trim().toUpperCase() !== 'MAMIE') continue;
    total++;
    try {
      var rowDate = Utilities.formatDate(new Date(row[0]), tz, 'dd/MM/yyyy');
      if (rowDate === today) todayCount++;
    } catch(e) {}
  }
  return { total: total, today: todayCount };
}

// ---------------------------------------------------------------
//  CRÉATION AUTOMATIQUE D'UNE NOUVELLE FEUILLE CHAQUE DIMANCHE
// ---------------------------------------------------------------
function creerNouvelleFeuilleSemaine() {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var oldSheet = ss.getSheets()[0];
  var tz       = Session.getScriptTimeZone();
  var now      = new Date();
  var dateStr  = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  var newName  = 'Semaine ' + dateStr;

  // Évite les doublons
  if (ss.getSheetByName(newName)) {
    Logger.log('Feuille "' + newName + '" existe déjà, annulé.');
    return;
  }

  // Insère la nouvelle feuille en position 0 (elle devient la feuille active)
  var newSheet = ss.insertSheet(newName, 0);

  // Copie la ligne d'en-tête (mise en forme incluse), au minimum 10 colonnes
  var lastCol = Math.max(oldSheet.getLastColumn(), 10);
  oldSheet.getRange(1, 1, 1, lastCol).copyTo(newSheet.getRange(1, 1));
  // S'assurer que l'entête PAIEMENT existe en J
  if (!newSheet.getRange(1, 10).getValue()) {
    newSheet.getRange(1, 10).setValue('PAIEMENT');
  }

  Logger.log('Nouvelle feuille créée : ' + newName);
}

// Exécuter cette fonction UNE SEULE FOIS pour installer le déclencheur dominical
function installerDeclencheurSemaine() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'creerNouvelleFeuilleSemaine') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('creerNouvelleFeuilleSemaine')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(23)
    .create();
  Logger.log('Déclencheur dominical installé (dimanche ~23h)');
}

// ---------------------------------------------------------------
function jsonOk(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
