# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Site web mobile-first pour enregistrer des contrats de terrain (champ de tir / airsoft) et les synchroniser automatiquement dans Google Sheets via Apps Script.

## Architecture

### Frontend (navigateur)
- `index.html` — 5 écrans en SPA sans framework : accueil → identité → matricule → durée → succès
- `style.css` — thème dark, variables CSS (`--bg`, `--surface`, `--green`, etc.), responsive
- `app.js` — état global `state`, navigation via `showScreen(id)`, envoi GET vers Apps Script

### Backend (Google Apps Script)
- `Code.gs` — déployé comme Web App (`/exec`), reçoit les paramètres via `doGet(e)`

### Flux de données
1. Le site envoie un GET : `?prenom=&nom=&matricule=&heure_debut=&heure_fin=&temps=&statut=`
2. `Code.gs` trouve la première ligne vide (basé sur colonne B) et écrit les 9 colonnes
3. Un déclencheur Apps Script toutes les 5 min appelle `mettreAJourStatut` qui scanne les lignes `EN COURS` et passe en `Fin de contrat` celles dont l'heure de fin est dépassée

### Structure du Google Sheet (première feuille)
| Col | Contenu | Écrit par |
|-----|---------|-----------|
| A | DATE (DD/MM/YYYY) | Script |
| B | PRENOM | Script |
| C | NOM | Script |
| D | Matricule (ex: M-02, CP-23) | Script |
| E | HEURE DEBUT (ex: 10h30) | Script |
| F | HEURE FIN (ex: 11h30) | Script |
| G | Temps (ex: 1h, 2h) | Script |
| H | PRIX (15000 × heures) | Script |
| I | STATUT | Script + manuel |

La colonne I a une **validation de données** : valeurs autorisées = `EN COURS`, `Fin`, `Fin de contrat`.

## Points critiques

- `APPS_SCRIPT_URL` dans `app.js` ligne 3 doit être une URL `/exec` (pas `/edit`)
- Après chaque modification de `Code.gs`, redéployer avec **nouvelle version** sinon l'URL `/exec` pointe sur l'ancien code
- Le fetch utilise `mode: 'no-cors'` → réponse opaque, impossible de détecter les erreurs serveur côté JS
- La recherche de ligne vide scanne toute la colonne B sans `break` pour éviter les trous
- `mettreAJourStatut` parse le format `"NNhMM"` (insensible à la casse) — tout autre format est ignoré avec un log
- Le déclencheur 5 min est créé manuellement dans Apps Script, pas par le code

## Google Sheet lié
https://docs.google.com/spreadsheets/d/1r7r-gP6DHKR28y30KJLH_QpYwUHIu7dDpbD5R-rdrY0/edit
