# Tableau de bord 3.5.1 — instruments

Adaptation du bandeau et des jauges de `christophebelmont/Flow.io-Waveshare`
(révision `7f71a7b4bd9c6a5a1007826f77d8adcae216bd7a`, licence MIT).

- Bandeau clair en mode clair, sombre en mode sombre, avec la vague d'origine.
  Le même fond clair est appliqué aux autres cartes.
- Jauges eau, pH, ORP et pression (si mesurée) résolues par les identifiants du manifeste runtime,
  indépendamment de l'ordre des emplacements configurés. Une mesure absente reste
  explicitement indisponible ; l'anneau représente la plage d'affichage configurée,
  pas une qualification de la qualité de l'eau.
- La carte Sondes conserve toutes les mesures configurées, même présentes dans le
  bandeau, et utilise des barres horizontales. La pression garde son unité réelle ;
  une pression mesurée à zéro est une valeur valide. Une carte sans sonde configurée
  est masquée.
- Disposition de référence : filtration et résumé du traitement sur la première
  ligne, puis Mode/Équipements/Alarmes à gauche et Sondes à droite. Le rail compact
  conserve la navigation. Sur mobile, les cartes sont empilées.
- Le sélecteur Auto/Manuel/Hiver réutilise les actions runtime existantes. Les refus
  arrêtent la séquence et sont affichés. Le détail des alarmes reste consultable et
  les protections indisponibles ne sont pas déclarées normales.
- Frise sur 24 heures avec début, fin, durée et repère horaire du navigateur,
  cohérent avec l'horloge d'en-tête existante. Une plage passant minuit est dessinée
  en deux segments. Des bornes identiques représentent une journée complète,
  conformément à la convention existante de progression de filtration.
- Analyse IA et réglages dans des sections natives `details`, fermées au démarrage.
  Les champs conservent leurs brouillons lorsqu'une section est refermée.
- Commandes, validation explicite, droits administrateur/opérateur, affectations,
  retour des refus de commande et chargement des pages de la 3.5.1 conservés.

## Vérification

Générer les descriptions avec `FLOW_CFGDOC_PROFILE=waveshare`, puis lancer
`scripts/generate_config_docs.py` et `scripts/generate_cfgdoc_chunks.py`.
Exécuter `pnpm web:minify` et `pnpm web:check` avant les tests de production.

Tests : `test_dashboard_filtration_window.cjs`, `test_production_dashboard.cjs`,
`test_dashboard_measure_tiles.cjs`, `test_dashboard_heater.cjs`,
`test_dashboard_loading.cjs`, `test_dashboard_live_updates.cjs` dans `scripts/tests`.
Playwright est nécessaire pour les tests navigateur. Le test de production emploie
les ressources `.gz`, la CSP de production et des API simulées ; aucune commande
n'est envoyée à un appareil réel. Les largeurs 1280, 390, 360 et 320 pixels couvrent
les réglages, les jauges et les débordements horizontaux.

## Installation

Cette modification porte uniquement sur les ressources web. Régénérer et installer
l'image SPIFFS selon la procédure habituelle du dépôt pour l'appliquer à une carte
3.5.1. Les fichiers `.gz` sont générés localement et ignorés par Git ; leur manifeste
est versionné. Aucun changement de firmware ou de configuration de piscine requis.
