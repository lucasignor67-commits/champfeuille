// ===============================================================
//  CHAMP - Google Apps Script
//  Colonnes :
//    A  DATE       B  PRENOM    C  NOM       D  Matricule
//    E  HEURE DEBUT  F  HEURE FIN  G  Temps  H  PRIX  I  STATUT
// ===============================================================

// Personnes dont les stats sont affichées dans l'écran Suivi semaine
var PERSONNES_SUIVIES = ['MAMIE', 'PASCAL', 'LOUGACE'];

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
      var suiviData = withCache('get_suivi', 30, function() { return { suivi: getSuivi() }; });
      var jsonS = JSON.stringify({ success: true, suivi: suiviData.suivi });
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

    enregistrer(prenom, nom, matricule, heureDebut, heureFin, temps, prixParam, paiement);

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
function getSuivi() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();

  var suivis = PERSONNES_SUIVIES.map(function(matricule) {
    var contrats = 0, heures = 0, montant = 0;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[1] || row[1] === '') continue;
      if (String(row[3]).trim().toUpperCase() !== matricule.toUpperCase()) continue;
      contrats++;
      heures  += parseInt(String(row[6]).replace(/[^0-9]/g, ''), 10) || 0;
      montant += Number(row[7]) || 0;
    }
    return { matricule: matricule, contrats: contrats, heures: heures, montant: montant };
  });

  // Agrège tous les contrats des personnes hors liste
  var tiersContrats = 0, tiersHeures = 0, tiersMontant = 0;
  var suiviesUpper  = PERSONNES_SUIVIES.map(function(m) { return m.toUpperCase(); });
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1] || row[1] === '') continue;
    if (suiviesUpper.indexOf(String(row[3]).trim().toUpperCase()) !== -1) continue;
    tiersContrats++;
    tiersHeures  += parseInt(String(row[6]).replace(/[^0-9]/g, ''), 10) || 0;
    tiersMontant += Number(row[7]) || 0;
  }
  suivis.push({ matricule: 'Personnes tiers', contrats: tiersContrats, heures: tiersHeures, montant: tiersMontant, isTiers: true });

  return suivis;
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
