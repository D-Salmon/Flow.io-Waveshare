# Fork Waveshare 3.5.0

La branche `3.5.0` descend de `3.4.5` et conserve ses fonctions, réglages persistants et historiques. Cette version améliore le chargement de l'interface Web.

## Cache de l'interface

Le navigateur peut réutiliser le squelette de page, les traductions et les descriptions des champs après un rechargement. Leurs URL portent la version des fichiers Web. Les descriptions et leurs traductions possèdent désormais une empreinte de contenu commune, calculée lors de leur génération : modifier uniquement un texte d'aide invalide également le cache, y compris après une mise à jour du système de fichiers seul.

La version courante est relue au démarrage de l'interface. Les lectures de configuration et les états en temps réel restent sans cache HTTP. Une demande explicite de rechargement des traductions contourne leur cache.

## Lectures groupées du tableau de bord

Les 43 modules nécessaires au chargement initial sont lus en six requêtes HTTP : deux pour les 12 modules des cartes principales, puis quatre pour les 31 modules des affectations. Les affectations ne deviennent modifiables que lorsque leurs données sont complètes. Leur arrivée conserve les saisies non validées et les changements déjà enregistrés dans les cartes principales.

L'API `GET /api/flowcfg/batch?names=<tableau JSON>` utilise le même contrôle d'accès et le même sérialiseur avec masquage des secrets que la lecture individuelle. Elle accepte au plus huit noms distincts de 63 octets, une requête JSON de 1 024 octets et une réponse de moins de 16 Kio, allouée en PSRAM. Une seule requête de ce type est en cours à la fois pour ce chargement. Un module absent ou une réponse trop volumineuse produit une erreur complète ; aucune configuration partielle n'est rendue modifiable.

Les champs restent enregistrés uniquement après validation par leur coche. Les automatismes de filtration, de traitement et les affectations physiques ne changent pas dans cette version.

## Vérification

- Tests dans Chrome : réutilisation du cache après rechargement, invalidation à la nouvelle version, rechargement forcé, fraîcheur de la configuration et refus des réponses incomplètes.
- Test de génération : empreinte reproductible, sensible aux modifications d'aide et de traduction même lorsque l'index reste identique.
- Tests du tableau de bord : six requêtes pour 43 modules, limite de huit modules, affichage anticipé des cartes principales, conservation des saisies et des changements validés, échecs isolés et abandon des chargements remplacés.
- Tests existants : champs chauffage/robot/protections/régulation, validation explicite, visibilité des sondes, planification IA, actualisation des états, démarrage de l'interface sous sa politique CSP et sérialisation avec masquage des secrets.

Le script `scripts/tests/check_device_config_batch.py` permet de vérifier sans écriture les limites de l'API, le masquage, l'égalité avec les lectures individuelles et les en-têtes de cache. Il compare les temps HTTP de lecture des réglages sur trois passages ; cette mesure n'est pas un temps de rendu complet du navigateur.

## Mesures sur la carte

Après installation le 8 octobre 2026, la comparaison des deux méthodes sur le même firmware, avec les mêmes valeurs, donne les médianes suivantes sur trois passages :

| Lecture des réglages | Individuelle, groupes de trois | Groupée, huit modules maximum |
| --- | ---: | ---: |
| Requêtes pour 43 modules | 43 | 6 |
| Cartes principales, 12 modules | 254 ms | 92 ms |
| Total des 43 modules | 934 ms | 259 ms |
| Corps JSON transférés, hors en-têtes | 7 403 octets | 5 606 octets |

Le temps HTTP de lecture des réglages baisse d'environ 72 %. Ces chiffres excluent le téléchargement des fichiers de l'interface, les descriptions des champs et le rendu du navigateur ; ils ne constituent donc pas une mesure du temps total d'ouverture de la page.

Les contrôles sur la carte valident les entrées invalides, les modules absents, le masquage des mots de passe, l'égalité des 43 modules et les en-têtes de cache des traductions publiques. Les trois routes de documentation conservent leur protection administrateur ; leur cache est testé dans Chrome avec un serveur de développement, sans contourner cette protection sur la carte.

La compilation Waveshare utilise 97 204 octets de RAM statique, identiques à la 3.4.5, et 2 378 503 octets de Flash, soit 2 736 octets supplémentaires. Le tampon de réponse groupée de 16 Kio en PSRAM est temporaire et libéré après l'envoi. Le flash firmware/SPIFFS conserve la NVS ; le fichier local d'accès de secours a été régénéré après ce flash.
