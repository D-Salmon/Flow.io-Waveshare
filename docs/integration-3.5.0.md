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

Le second lot d'optimisations charge les styles principaux et le squelette HTML en parallèle, dans la limite des deux téléchargements simultanés admis par la carte. Le code de l'historique est téléchargé à l'ouverture de sa rubrique. Le code et les styles réseau sont téléchargés lorsque le sélecteur Wi-Fi est nécessaire dans Configuration ; cela n'ajoute aucune page Réseau à la barre latérale.

Les noms des 16 sorties se lisent désormais en deux requêtes groupées, aussi bien pour l'arborescence que pour les choix d'affectation. L'arborescence est reconstruite une fois par groupe reçu. Les réponses d'un cache remplacé et les chargements de branches dépassés par une nouvelle sélection sont ignorés. Les visites normales de Configuration réutilisent les descriptions et traductions en cache.

Le troisième lot rend l'application d'une traduction sans effet lorsque la langue et son contenu sont déjà affichés. Les vérifications de langue au retour dans l'onglet, lors d'une lecture des informations ou après une sauvegarde ne relancent plus le chargement des 43 modules du tableau de bord et ne reconstruisent plus les champs de Configuration si la langue est inchangée. Les saisies non validées et le focus restent en place. Un vrai changement de langue, une traduction nouvellement chargée et une nouvelle tentative après échec restent pris en compte ; une ancienne réponse ne remplace pas la langue sélectionnée depuis.

L'assistant d'étalonnage est également chargé à son ouverture, avec les mêmes calculs, coefficients et validation explicite. Il lit directement les affectations, les coefficients et les mesures en direct, sans demander les descriptions générales de Configuration qu'il n'utilise pas. Quitter la page avant la fin du téléchargement n'entraîne aucune lecture d'étalonnage ; un échec de téléchargement permet de réessayer en rouvrant la page.

- Tests dans Chrome : réutilisation du cache après rechargement, invalidation à la nouvelle version, rechargement forcé, fraîcheur de la configuration et refus des réponses incomplètes.
- Test de génération : empreinte reproductible, sensible aux modifications d'aide et de traduction même lorsque l'index reste identique.
- Tests du tableau de bord : six requêtes pour 43 modules, limite de huit modules, affichage anticipé des cartes principales, conservation des saisies et des changements validés, échecs isolés et abandon des chargements remplacés.
- Tests existants : champs chauffage/robot/protections/régulation, validation explicite, visibilité des sondes, planification IA, actualisation des états, démarrage de l'interface sous sa politique CSP et sérialisation avec masquage des secrets.
- Tests du second lot : démarrage parallèle, absence de téléchargement anticipé des modules optionnels, ouverture de l'historique et du sélecteur Wi-Fi, navigation pendant leur téléchargement, déduplication et nouvelle tentative après échec ; noms de sorties groupés, limite commune de deux lectures et rejet des anciens caches. Les vues historiques, le cache et les champs modifiables ont également été vérifiés après extraction du module.
- Tests du troisième lot : vérifications de langue répétées et simultanées, conservation des saisies et du focus, changement réel de langue, échec puis reprise de traduction et réponse retardée ; téléchargement différé de l'étalonnage, navigation pendant ce téléchargement, reprise après échec, absence de lecture de documentation, calcul et application à un/deux points, refus de points identiques et absence de sauvegarde lors du seul calcul. Les tests de démarrage, cache, historique et champs du tableau de bord passent également.

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

Le second lot retire 9 064 octets compressés du téléchargement initial du tableau de bord par rapport au premier lot 3.5.0 : le script principal passe de 115 475 à 113 522 octets, les 7 302 octets du sélecteur réseau sont différés et le chargeur augmente de 191 octets. Le module historique séparé représente 3 157 octets compressés, téléchargés seulement à l'ouverture de cette rubrique. Ces tailles ne préjugent pas d'un gain chronométré de rendu sur la carte.

Le troisième lot retire encore 5 054 octets compressés des scripts de démarrage : le script principal passe de 113 522 à 108 455 octets et le chargeur de 3 148 à 3 161 octets. Le module d'étalonnage représente 5 686 octets compressés, transférés seulement à son ouverture. Les petits ajouts aux traductions représentent respectivement 17 et 24 octets compressés en français et en anglais. Une vérification de langue inchangée évite les six requêtes groupées de rechargement qui auraient été déclenchées sur un tableau de bord déjà chargé.

La compilation Waveshare utilise 97 204 octets de RAM statique, identiques à la 3.4.5, et 2 378 679 octets de Flash, soit 2 912 octets supplémentaires. Le tampon de réponse groupée de 16 Kio en PSRAM est temporaire et libéré après l'envoi. Le firmware du troisième lot, `3.5.0+20261008.223630`, a été installé avec son SPIFFS ; les huit fichiers Web contrôlés correspondent aux fichiers compilés, leurs URL versionnées utilisent le cache et MQTT est connecté. Le flash conserve la NVS ; le fichier local d'accès de secours est régénéré après le flash.
