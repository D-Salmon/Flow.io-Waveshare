# Ressources web Waveshare (chargement modulaire)

## Objectif
Réduire le pic mémoire/IO au chargement de l'interface locale Waveshare sur ESP32-S3 en évitant les chargements massifs au démarrage.

## Découpage appliqué
- `data/webinterface/index.html`
  - bootstrap minimal.
- `data/webinterface/app-core.js`
  - bootstrap runtime
  - fetch avec retry `503 Busy` (prise en compte de `Retry-After`)
  - chargement idempotent JS/CSS (`loadScriptOnce`, `loadCssOnce`)
- `data/webinterface/app-core.css`
  - styles globaux (shell + dashboard + system + config + calibration).

Le runtime charge un unique CSS global au boot.

Les modules `history.js`, `calibration.js`, `activity.js`, `users.js` et `updates.js`
sont chargés à l’ouverture de leur page via `FlowWebCore.loadPageModule`. Le profil
utilisateur réutilise `users.js`. Une mise à jour en attente de reconnexion peut
charger `updates.js` au démarrage pour reprendre son suivi, même sur une autre page.
`network.js` et `network.css` sont chargés lorsque le sélecteur Wi-Fi de
Configuration est utilisé. Chaque module fournit une fabrique `create(dependencies)` ;
les instances sont réutilisées. Les lectures dépendantes d’une page ne commencent
pas si celle-ci a été quittée pendant le téléchargement.

## cfgdocs segmenté
Les docs de configuration sont segmentées dans `data/wc/` avec des noms courts compatibles SPIFFS:
- `i.j` (index)
- `mXXXXXXXX.j` (module)

L’index expose également `bundles.poollogic` : le groupe précompilé regroupe les
descriptions individuelles de PoolLogic et les descriptions communes, sans modifier
leur contenu. Il est lu par la même route `/api/cfgdoc/module` avec le nom de module
publié dans l’index. Le client vérifie tous les membres avant de remplir le cache des
modules individuels. Le groupe participe à l’empreinte de contenu de `wc/v.j`.

Génération:
- `scripts/generate_cfgdoc_chunks.py`

API backend:
- `GET /api/cfgdoc/index`
- `GET /api/cfgdoc/module?name=<module>`

Fallback:
- si les chunks ne sont pas disponibles, le frontend retombe sur `cfgdocs.fr.json` / `cfgmods.fr.json`.

## Compression
Le pipeline compresse désormais aussi:
- `app-core.js(.gz)`
- `app-core.css(.gz)`
- `pages/*.css(.gz)`
- `wc/*.j(.gz)`

Scripts:
- `scripts/gzip_web_assets.sh`
- `scripts/prepare_spiffs_data.py`

## Régénération
1. `scripts/generate_cfgdoc_chunks.py`
2. `scripts/gzip_web_assets.sh`
3. build/upload SPIFFS habituel
