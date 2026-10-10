# Fork Waveshare 3.5.0

La branche `3.5.0` descend de `3.4.5` et conserve ses fonctions, réglages persistants et historiques. Cette version améliore le chargement de l'interface Web.

## Cache de l'interface

Le navigateur peut réutiliser le squelette de page, les traductions et les descriptions des champs après un rechargement. Leurs URL portent la version des fichiers Web. Les descriptions et leurs traductions possèdent désormais une empreinte de contenu commune, calculée lors de leur génération : modifier uniquement un texte d'aide invalide également le cache, y compris après une mise à jour du système de fichiers seul.

La version courante est relue au démarrage de l'interface. Les lectures de configuration et les états en temps réel restent sans cache HTTP. Une demande explicite de rechargement des traductions contourne leur cache.

## Lectures groupées du tableau de bord

Le haut du tableau de bord lit les 12 modules des cartes principales en deux requêtes HTTP. À l’approche des cartes d’affectation (marge de 200 pixels), 31 modules supplémentaires sont lus en quatre requêtes. Le total reste de six requêtes pour 43 modules lorsque toutes les cartes sont consultées. Les affectations ne deviennent modifiables que lorsque leurs données sont complètes. Leur arrivée conserve les saisies non validées et les changements déjà enregistrés dans les cartes principales. Quitter le tableau de bord annule l’attente de visibilité ; les navigateurs dépourvus d’IntersectionObserver chargent immédiatement les affectations.

L'API `GET /api/flowcfg/batch?names=<tableau JSON>` utilise le même contrôle d'accès et le même sérialiseur avec masquage des secrets que la lecture individuelle. Elle accepte au plus huit noms distincts de 63 octets, une requête JSON de 1 024 octets et une réponse de moins de 16 Kio, allouée en PSRAM. Une seule requête de ce type est en cours à la fois pour ce chargement. Un module absent ou une réponse trop volumineuse produit une erreur complète ; aucune configuration partielle n'est rendue modifiable.

Les champs restent enregistrés uniquement après validation par leur coche. Les automatismes de filtration, de traitement et les affectations physiques ne changent pas dans cette version.

## Vérification

Le second lot d'optimisations charge les styles principaux et le squelette HTML en parallèle, dans la limite des deux téléchargements simultanés admis par la carte. Le code de l'historique est téléchargé à l'ouverture de sa rubrique. Le code et les styles réseau sont téléchargés lorsque le sélecteur Wi-Fi est nécessaire dans Configuration ; cela n'ajoute aucune page Réseau à la barre latérale.

Les noms des 16 sorties se lisent désormais en deux requêtes groupées, aussi bien pour l'arborescence que pour les choix d'affectation. L'arborescence est reconstruite une fois par groupe reçu. Les réponses d'un cache remplacé et les chargements de branches dépassés par une nouvelle sélection sont ignorés. Les visites normales de Configuration réutilisent les descriptions et traductions en cache.

Le troisième lot rend l'application d'une traduction sans effet lorsque la langue et son contenu sont déjà affichés. Les vérifications de langue au retour dans l'onglet, lors d'une lecture des informations ou après une sauvegarde ne relancent plus le chargement des 43 modules du tableau de bord et ne reconstruisent plus les champs de Configuration si la langue est inchangée. Les saisies non validées et le focus restent en place. Un vrai changement de langue, une traduction nouvellement chargée et une nouvelle tentative après échec restent pris en compte ; une ancienne réponse ne remplace pas la langue sélectionnée depuis.

L'assistant d'étalonnage est également chargé à son ouverture, avec les mêmes calculs, coefficients et validation explicite. Il lit directement les affectations, les coefficients et les mesures en direct, sans demander les descriptions générales de Configuration qu'il n'utilise pas. Quitter la page avant la fin du téléchargement n'entraîne aucune lecture d'étalonnage ; un échec de téléchargement permet de réessayer en rouvrant la page.

Le quatrième lot regroupe les descriptions de PoolLogic dans un fichier généré à la compilation. Les douze lectures de descriptions du tableau de bord sont remplacées par une lecture du groupe, via la route de module existante avec son contrôle administrateur. L’index, les traductions et le cache versionné restent partagés. Les 17 descriptions membres, dont les définitions communes, sont identiques aux fichiers individuels et alimentent le même cache pour Configuration. Une réponse incomplète est rejetée avant toute insertion dans ce cache. Le groupe est servi depuis SPIFFS, sans assemblage JSON supplémentaire sur l’ESP32.

Activité, Comptes et Mises à jour sont désormais téléchargés à leur ouverture. Le bouton de profil charge également le module Comptes si nécessaire. Le filtre et la sélection d’événements, la protection du dernier administrateur et les dialogues de compte restent inchangés. Le catalogue de mise à jour utilise les métadonnées courantes de la carte ; une opération en attente de reconnexion reprend aussi depuis le tableau de bord après rechargement. Une opération déjà terminée ne déclenche aucun téléchargement anticipé. La lecture périodique du statut des mises à jour s’arrête quand sa page est quittée. Un téléchargement de module en échec permet une nouvelle tentative en rouvrant la page.

- Tests dans Chrome : réutilisation du cache après rechargement, invalidation à la nouvelle version, rechargement forcé, fraîcheur de la configuration et refus des réponses incomplètes.
- Test de génération : empreinte reproductible, sensible aux modifications d'aide et de traduction même lorsque l'index reste identique.
- Tests du tableau de bord : six requêtes pour 43 modules, limite de huit modules, affichage anticipé des cartes principales, conservation des saisies et des changements validés, échecs isolés et abandon des chargements remplacés.
- Tests existants : champs chauffage/robot/protections/régulation, validation explicite, visibilité des sondes, planification IA, actualisation des états, démarrage de l'interface sous sa politique CSP et sérialisation avec masquage des secrets.
- Tests du second lot : démarrage parallèle, absence de téléchargement anticipé des modules optionnels, ouverture de l'historique et du sélecteur Wi-Fi, navigation pendant leur téléchargement, déduplication et nouvelle tentative après échec ; noms de sorties groupés, limite commune de deux lectures et rejet des anciens caches. Les vues historiques, le cache et les champs modifiables ont également été vérifiés après extraction du module.
- Tests du troisième lot : vérifications de langue répétées et simultanées, conservation des saisies et du focus, changement réel de langue, échec puis reprise de traduction et réponse retardée ; téléchargement différé de l'étalonnage, navigation pendant ce téléchargement, reprise après échec, absence de lecture de documentation, calcul et application à un/deux points, refus de points identiques et absence de sauvegarde lors du seul calcul. Les tests de démarrage, cache, historique et champs du tableau de bord passent également.
- Tests du quatrième lot : égalité des descriptions et contraintes individuelles/groupées, français/anglais, lecture unique partagée avec Configuration, cache HTTP, invalidation de version et échec sans cache partiel ; visibilité des affectations, absence de lecture avant défilement, conservation des saisies et annulation à la navigation ; téléchargement différé des trois pages, comptes/profil, protection du dernier administrateur, vérification de manifeste, arrêt du polling, reprise hors page avec reçu d’opération et nouvelle tentative après échec. Les trois pages sont également vérifiées avec les fichiers minifiés destinés à la carte.

Le script `scripts/tests/check_device_config_batch.py` permet de vérifier sans écriture les limites de l'API, le masquage, l'égalité avec les lectures individuelles et les en-têtes de cache. Il compare les temps HTTP de lecture des réglages sur trois passages ; cette mesure n'est pas un temps de rendu complet du navigateur.

## Mesures sur la carte

Le cinquième lot raccourcit les noms JavaScript internes, sans renommer les
propriétés ni les interfaces publiques et sans activer les transformations de
compression de Terser. Les sources restent lisibles. Le script principal passe
de 93 749 à 80 118 octets compressés et le chargeur de 3 192 à 2 680 octets,
soit 14 143 octets de moins au démarrage (14,6 %). Les modules différés sont
également réduits. Ce gain de transfert ne constitue pas une mesure du temps
total de rendu. Les fichiers produits sont vérifiés dans Chrome : démarrage
sous CSP, navigation et reprises après échec, comptes/mises à jour, validation
explicite d'une consigne et commande d'éclairage.

Dans `io/drivers/expander00`, le champ d'activation indique désormais
« Sorties relais CH1 à CH8 activées ». Son aide précise que sans cette activation,
les huit relais sont indisponibles et qu'un redémarrage est nécessaire après
validation. Les autres pilotes d'extension précisent également l'indisponibilité
des entrées/sorties dépendantes et l'application au redémarrage.

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

Le quatrième lot retire 14 675 octets compressés supplémentaires des scripts de démarrage (environ 13 %) : le script principal passe de 108 455 à 93 749 octets, le chargeur de 3 161 à 3 192 octets. Les modules différés représentent 4 046 octets pour Activité, 1 994 pour Comptes et 11 793 pour Mises à jour. Le groupe de descriptions PoolLogic représente environ 6 Ko compressés. Ces tailles et les requêtes évitées ne constituent pas un chronométrage du rendu complet du navigateur.

La compilation Waveshare du quatrième lot utilise 97 204 octets de RAM statique, identiques à la 3.4.5, et 2 378 923 octets de Flash, soit 3 156 octets supplémentaires depuis la 3.4.5 et 244 depuis le lot précédent. Le tampon de réponse groupée de 16 Kio en PSRAM est temporaire et libéré après l'envoi. Le firmware `3.5.0+20261008.230642` a été installé avec son SPIFFS ; les 14 fichiers Web contrôlés correspondent aux fichiers compilés, leurs URL versionnées utilisent le cache (l’entrée HTML conserve son absence de cache) et MQTT est connecté. La lecture des 43 modules, leur masquage et les limites de l’API ont été revérifiés sur la carte. Les images du paquet de mise à jour correspondent à celles flashées. Le flash conserve la NVS ; le fichier local d'accès de secours a été régénéré après le flash.

Le cinquième lot a été installé par un flash du SPIFFS seul : le programme et sa
RAM statique restent identiques au quatrième lot. Les 19 ressources minifiées
passent les contrôles de syntaxe et d'empreinte. Sur la carte, les 14 ressources
de l'interface principale correspondent aux fichiers produits ; l'empreinte Web
`20261008.230642-d5b77b2b` invalide le cache précédent. Les contrôles confirment
MQTT connecté, une durée de fonctionnement croissante, le pilote des relais
activé et les huit sorties disponibles sans erreur. La filtration est en marche
et l'éclairage est commandable. Le fichier d'accès AP a été actualisé après ce
flash. Le paquet de mise à jour associe ce SPIFFS au firmware précédent inchangé.

## Suppression des événements d'activité

La suppression conserve le traitement en tâche de fond et le format des marques
de suppression de la 3.4.3. Huit marques au maximum partagent désormais une
ouverture/écriture/fermeture du fichier, suivie d'une seule compaction du journal
en RAM. Pour 300 événements, le test de production compte 38 ouvertures en ajout
au lieu de 300. Chaque lot est fermé avant de retirer ses événements de la RAM ;
une écriture courte ne confirme que les lignes entièrement écrites. Les pauses
entre lots, la rotation des fichiers, l'ordre des événements en attente et la
limite HTTP de 128 identifiants restent conservés. L'avancement confirmé est
publié après chaque petit lot.

L'interface interroge l'état dès l'acceptation, puis attend 200 ms entre les
lectures encore nécessaires. Un lot n'est retiré de l'affichage qu'après son
état de fin confirmé. Le journal est ensuite relu par pages de 64 événements,
limite déjà prise en charge par l'API : jusqu'à 12 lectures au lieu de 24 pour
768 événements. Les écritures refusées ne sont pas automatiquement réessayées.
Les nombres d'ouvertures et de requêtes ne constituent pas une mesure du temps
de suppression sur la carte.

Les tests exécutent les méthodes C++ de production : aucune écriture en section
critique ni dans la demande HTTP, fermeture avant retrait en RAM, écriture
partielle et relecture, échec de la file d'attente, rotation, journal circulaire
plein, doublons, événements reçus pendant l'opération et lot de 300 événements.
Les tests Chrome, avec les fichiers livrés minifiés, vérifient la confirmation,
la sélection sur toutes les dates, les pages de 64, les erreurs sans répétition
et la conservation des autres événements.

La compilation de ce lot (`3.5.0+20261008.234327`) réussit : RAM statique
97 204 octets, inchangée, et programme Flash 2 379 227 octets (+304). Le cadre de
pile propre à `processDelete_` est de 848 octets dans le code Xtensa compilé ;
le tampon de huit marques occupe 512 octets. La pile configurée de la tâche
reste de 4 Kio. Ces cadres locaux ne constituent pas une mesure du maximum de
pile de toute la chaîne d'appels sur la carte.

Après installation du programme et du SPIFFS, les 14 ressources Web contrôlées
correspondent aux fichiers produits (`20261008.234327-67d793d0`). Le journal est
disponible, sans perte d'écriture signalée ; MQTT est connecté et les huit sorties
relais sont disponibles sans erreur. Le fichier d'accès AP a été régénéré après
le flash. Les essais de suppression restent ceux des tests C++ et Chrome ; le
journal de l'utilisateur n'a pas servi de jeu de données à supprimer pour
mesurer une durée réelle.

La carte Électrolyse du tableau de bord propose maintenant « Consigne ORP (mV) »
après les réglages SWG, uniquement lorsque le mode confirmé est « Suivi consigne
ORP ». Le champ utilise directement `poollogic/chlorine/dis_setpoint`, également
employé par Configuration et Home Assistant, sans nouvelle variable persistante.
La saisie et la perte de focus n'enregistrent rien : seul le bouton de validation
applique la valeur. Le mode continu masque le champ sans effacer sa consigne.
Le test du tableau de bord avec les fichiers minifiés vérifie ces transitions et
le module destinataire de chaque enregistrement. Seule l'image SPIFFS doit être
mise à jour pour ce changement ; le programme et les réglages restent identiques.

La consigne ORP utilise un pas de 1 mV dans les deux éditeurs, défini dans sa
documentation commune. Le test Chrome vérifie les flèches 700 → 701 → 700 et
l'absence d'enregistrement avant validation.

Les refus de commandes du tableau de bord, de l'éclairage et des fenêtres de
gestion disposent de messages français et anglais : sécurité, équipement
désactivé, pilote indisponible, durée maximale, erreur de sortie ou connexion.
Lors d'un refus par dépendance, le firmware fournit le nom de l'équipement requis
observé arrêté ou indisponible, d'après son masque d'affectation réel. Les erreurs
et les règles de commande restent identiques ; les diagnostics sont des champs
JSON supplémentaires. Si la cause ne peut pas être confirmée ou si le tampon est
trop petit, le refus de sécurité est conservé avec une explication générale,
sans attribuer une cause non vérifiée. Les tests couvrent une dépendance déplacée
vers pd8, les états inconnus, les noms contenant des guillemets, les petits
tampons et la conservation de l'état réel après une commande refusée.

Dans Protections, « Seuil maintien hors gel » précède « Sonde température d'eau ».
Le seuil de démarrage hiver est masqué hors mode hiver. Le maintien hors gel
reste visible, car il protège une filtration déjà en marche indépendamment de
ce mode ; les descriptions précisent que les deux seuils utilisent l'air ambiant.

Le cadre Traitement de l'eau suit la hauteur de ses réglages : la zone de
message est masquée lorsqu'elle est vide et apparaît en cas d'erreur de
validation. Le contrôle du tableau de bord avec les assets livrés est réussi.

La désinfection manuelle par électrolyse utilise la même décision de sécurité
pour son pilotage et ses diagnostics : filtration, pression et débit selon les
surveillances activées, et alarmes actives. Les mesures absentes et les seuils
dépassés sont distingués. La température et l'ORP ne bloquent pas cette marche
manuelle. PoolDevice refuse une demande interdite avant de changer sa cible ou
son forçage ; le mode automatique de désinfection n'est donc pas désactivé par
un refus. Les commandes directes et temporisées reçoivent ces causes structurées.
Le tableau de bord les traduit et conserve le message jusqu'à la prochaine
tentative. Tests natifs du pilotage, de la transaction et des diagnostics, et
test navigateur de la tuile Désinfection avec les assets livrés.


## Droits du tableau de bord

Les opérateurs lisent les descriptions et traductions des champs et peuvent
modifier les réglages de fonctionnement du bassin, avec validation explicite
par ✓. Les cartes d'affectation des sondes et des relais sont entièrement
masquées pour eux, sans chargement différé de leurs paramètres.

Le minimum de rôle autorisé est enregistré dans les métadonnées de chaque
variable. Le nouvel endpoint `/api/pool/settings` valide tous les droits du
patch avant toute modification, persistance ou notification. Les affectations,
les pilotes IO, le réseau et les comptes conservent leurs droits administrateur.
L'endpoint général `/api/flowcfg/apply` reste réservé aux administrateurs.
Aucune clé NVS ni valeur de configuration n'est déplacée.

Si les descriptions ne peuvent pas être chargées, le tableau de bord affiche
une erreur et ne présente pas de champs techniques modifiables. La lecture peut
être retentée sans conserver définitivement cet échec. Les tests couvrent les
opérateurs sur PC et téléphone, l'enregistrement explicite des consignes, le
masquage des affectations et le refus atomique d'un patch mixte non autorisé.

## QR code Wi-Fi après flash

La capture des identifiants crée également `local-device/rescue-wifi.png`, à
côté de `rescue-access.txt`. Le QR contient les identifiants WPA du point d'accès
de cette carte au format Wi-Fi reconnu par les téléphones. Sa génération est
locale ; les identifiants ne sont envoyés à aucun générateur en ligne.
Le point d'accès doit être ouvert pour que la connexion soit possible.

Les hooks `upload` et `uploadfs` préparent les dépendances Python puis créent les
deux fichiers après le flash. Une compilation seule ne les génère pas.
`FLOWIO_LOCAL_DEVICE_DIR` permet de choisir un autre dossier, par exemple
`local_rescue`. Les images et fichiers contenant les identifiants restent
locaux ; ils sont exclus du dépôt et des archives de publication.
Le test QR décode le PNG et vérifie les identifiants avec caractères spéciaux,
ainsi que l'absence de hook sur les cibles de compilation.
