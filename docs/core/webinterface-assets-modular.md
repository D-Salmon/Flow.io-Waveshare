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

## cfgdocs segmenté
Les docs de configuration sont segmentées dans `data/wc/` avec des noms courts compatibles SPIFFS:
- `i.j` (index)
- `mXXXXXXXX.j` (module)

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

## Limitation des lectures JSON

Dans `app.js`, les lectures GET utilisant `fetchJsonResponse` (directement ou via `fetchOkJson`) partagent une file FIFO limitée à deux requêtes actives par page navigateur. Le créneau reste occupé jusqu’à consommation du corps JSON, y compris durant les réessais du transport. Les erreurs libèrent le créneau. Les 16 lectures de noms de sorties PoolLogic utilisent cette même file ; cache et rechargement forcé sont conservés. Les requêtes d’écriture ne passent pas par cette file. Cette limite ne couvre pas les assets chargés par le navigateur ni les autres onglets ; elle ne remplace pas la régulation côté serveur.
