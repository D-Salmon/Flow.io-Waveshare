# Intégration Flow.io 3.4.3 dans la base expérimentale

La base expérimentale conserve son registre de valeurs, les historiques, les commandes des équipements et les forçages temporisés. Les fonctions de la branche 3.4.3 ont été intégrées après comparaison des deux archives et consultation de son historique Git.

## Fonctions intégrées

- ArduinoJson 7.4.3 et allocation PSRAM, avec repli mémoire adapté aux documents JSON.
- Accès administrateur sans compte par défaut, récupération physique BOOT (5 secondes, fenêtre de 5 minutes liée au client), CSRF et contrôle d'origine, limitation des tentatives, invalidation des sessions. MQTT TLS et validation des signatures des mises à jour distantes.
- Températures eau et air indépendantes : direct GPIO/DS18B20, pont DS2484 I²C 0x18, ou désactivé. Les choix Axx directs correspondent aux affectations logiques de la sonde numérique DS18B20 ; ils ne transforment pas cette sonde en sonde de température analogique.
- Sonde eau sur tuyauterie : mesure gelée hors circulation ; dans le bassin : mesure continue. Chauffage adapté au placement.
- Pression analogique directe ou ADS1115 externe, canaux A0 à A3. Carte pH/ORP à 0x48 ou 0x49 ; l'ADS de pression utilise automatiquement l'adresse complémentaire.
- Surveillance du débit, du disjoncteur de filtration et du disjoncteur de l'électrolyseur, interverrouillages et inhibition des commandes suivant la politique 3.4.3.
- Affectation des relais avec échange lorsque le canal est occupé, relais commun de désinfection et configurations conditionnelles selon le traitement choisi.
- Étalonnages à un ou deux points suivant la mesure.
- Filtration : interpolation 12 °C → 2 h, 25 °C → 12 h 30, 30 °C → 24 h ; à 20 °C ou moins, départ à 22 h ; au-dessus, heure pivot ; période hivernale de 22 h à minuit. Calcul à la minute.
- Ethernet prioritaire dès qu'il dispose d'une adresse IP ; Wi-Fi de secours. Adresses Ethernet, Wi-Fi et AP affichées dans Réseau, Informations et le tableau de bord.
- Rescue avec les fonctions 3.4.3. Correction supplémentaire : réponse `/api/web/meta` diffusée sans tampon fixe de 960 octets, qui provoquait une erreur 500 et masquait l'ouverture de récupération BOOT. Affichage explicite des erreurs de lecture.
- Correctif du démarrage de l’interface complète : émission du signal de fin d’initialisation attendu par le chargeur (`__FLOW_WEB_APP_READY__`), et suppression des scripts inline devenus redondants avec le chargeur sous CSP. Essai navigateur avec les fichiers effectivement servis par la carte : initialisation réussie et page Réseau visible, sans exception JavaScript.

## Corrections validées sur la carte

- Buzzer : le réglage `alarms/enabled = false` arrête les rappels et les séquences d'alarme en cours. Les états et l'historique restent conservés ; les confirmations de commandes restent sonores. Le service d'alarme expose désormais son activation aux consommateurs.
- Les contacts de niveau déclarés non câblés ne déclenchent plus leurs conditions d'alarme, conformément à la politique 3.4.3.
- Réseau : la réponse de configuration Wi-Fi fournit `password_configured`, les réglages Ethernet et les adresses effectives, sans retourner la clé Wi-Fi. Une clé laissée vide reste conservée ; une modification Ethernet seule ne remplace pas les réglages Wi-Fi.
- Rescue : la zone d'état Wi-Fi indique explicitement sa fonction, pour éviter de la confondre avec un second champ de mot de passe.
- Banc utilisateur : contacts de niveau et température d'eau non câblés ; réglages conservés au redémarrage. Connexion Wi-Fi domestique obtenue sur 192.0.2.10 ; AP fermé. Arrêt des bips répétés confirmé par l'utilisateur après le flash.

## Vérifications

Compilation ESP32-S3, tests Python (46, dont les politiques du buzzer, des niveaux non câblés et des modes automatiques), tests natifs de sécurité (12) et de filtration (10), tests de signature OTA, suites JavaScript et navigateur, affectations des sondes et des relais, adresses réseau et récupération Rescue.

Les derniers ajustements reprennent la page Réseau complète de la 3.4.3 : Ethernet avec DHCP ou adresse fixe, Wi-Fi, MQTT, états de connexion et adresses IP. Les sauvegardes Ethernet et Wi-Fi restent distinctes ; les mots de passe enregistrés ne sont pas exposés. Le choix de la sonde de pression définit sa surveillance ; le sélecteur redondant a été retiré. La polarité des disjoncteurs est masquée lorsque leur retour est non câblé, y compris après annulation d'une modification.

Le passage en mode auto active immédiatement « Désinfection auto » pour les pompes, l'électrolyseur ou l'oxygène actif ; le choix sans désinfection reste désactivé. La commande de basculement et la commande de réglage utilisent la même logique. Un étalonnage à un point n'affiche qu'une paire mesure/référence ; deux points affichent deux paires. Le test navigateur charge l'application complète sous sa CSP et vérifie ces affichages ainsi que l'application et l'annulation des réglages réseau.

La carte a été sauvegardée intégralement avant le flash. La sauvegarde est conservée séparément et exclue des archives distribuées, car elle peut contenir des secrets. Les images ont été écrites séparément pour préserver la partition NVS.

Les tests logiciels ne remplacent pas les essais électriques : le démarrage observé ne détectait pas de sondes DS18B20, de cartes ADS1115 ni de Nextion. Les capteurs, alarmes de débit/disjoncteurs, sorties physiques et basculements réseau doivent être validés sur l'installation raccordée.

## Construction

Sous Windows, compiler dans un chemin sans espace avec PlatformIO. Installer les dépendances web verrouillées avec `pnpm install --frozen-lockfile`, puis `pnpm web:minify` et `pnpm web:check` lorsque les fichiers web changent. Construire le firmware avec `platformio run` ; le projet produit également l'image SPIFFS et l'archive de mise à jour locale.

L'archive de mise à jour locale contient `manifest.json`, `firmware.bin` et `spiffs.bin`. Elle n'est pas une image complète de flash et ne contient pas les identifiants de votre installation.

### Correction de l’enregistrement MQTT
L’API MQTT n’expose plus le mot de passe ; elle indique uniquement s’il est enregistré. Un champ vide conserve le secret et la sérialisation ArduinoJson préserve les caractères spéciaux. Les valeurs trop longues sont rejetées. Test de round-trip des identifiants et de conservation du secret : réussi. La connexion réelle au broker reste à vérifier après le flash.


Validation matérielle : firmware 3.4.3+20261004.103013 flashé, hachages vérifiés ; 47 tests Python réussis. Le mot de passe enregistré est reconnu par l’interface. Le broker MQTT refuse encore la connexion (CONNACK 5), sans erreur TLS. Diagnostic côté broker nécessaire ; connexion MQTT non validée.


### Mot de passe MQTT jusqu’à 63 caractères
Le stockage MQTT Waveshare utilise désormais 64 octets (63 caractères ASCII et la terminaison). Le formulaire Réseau et Rescue sont limités à 63 caractères ; les API utilisent la capacité du module et rejettent les dépassements. Le test de sérialisation et d’application du ConfigStore confirme la conservation intégrale d’un mot de passe de 63 caractères. Un secret tronqué avec l’ancien firmware doit être ressaisi après mise à jour.


Validation matérielle de la limite : firmware 3.4.3+20261004.124617 flashé, hachages vérifiés. L’interface servie par la carte expose maxlength=63 pour le mot de passe MQTT. 47 tests Python réussis et test navigateur Réseau réussi. Ressaisie du mot de passe complet requise pour valider la connexion au broker.


Connexion MQTT validée sur la carte le 4 octobre 2026 après ressaisie du mot de passe complet : runtime mqtt.rdy=true, broker mqtt.example.org:8883, compteurs de réception et de parsing sans erreur. La limite précédente de 31 caractères empêchait l’authentification du secret complet.


### Actualisation automatique des états réseau
Les états Ethernet, Wi-Fi et MQTT se mettent à jour toutes les 5 secondes et immédiatement au retour dans l’onglet. Leur clé de traduction suit l’état courant pour éviter le retour intempestif à Vérification. Le test navigateur contrôle les transitions des trois champs et la reprise après masquage de l’onglet.


### Lisibilité et résumé réseau
Suppression des mentions Prioritaire, Secours et Connexion utilisée dans le résumé. Ethernet, Wi-Fi et MQTT affichent un point rouge ou vert ; le point d’accès n’apparaît que s’il possède une IP. Tailles des textes CSS augmentées de 12 %, textes secondaires du thème clair assombris. Tests du résumé réseau et de l’interface Réseau/Étalonnage réussis.


Le champ Seuil sécurité électrolyse utilise un pas de 0,5 °C, défini dans les métadonnées de configuration du module. La valeur reste stockée en Float.


### Activité : suppression sélective
Chaque événement possède une case de sélection. Le bouton Supprimer la sélection demande confirmation et ne supprime que les identifiants choisis ; la sélection est conservée lors des actualisations. Le journal persistant est réécrit avec sauvegardes et récupération après interruption, sans réutiliser les identifiants supprimés. Tests sur fichiers simulés : conservation des autres événements, événements en attente, échec de chaque renommage et reprise après interruption. Aucun événement réel n’a été supprimé pour la vérification.

### Cartes des sondes et alarmes
Les cartes désactivées ou dont la sonde est déclarée non câblée sont masquées. Une sonde configurée dont la mesure est indisponible reste affichée. Les alarmes indépendantes des sondes restent disponibles. Les sondes environnementales suivent l’activation de leur pilote.

### Configuration réseau
Ordre MQTT : activation, broker, port, utilisateur, mot de passe, nom d’appareil et topic de base ; l’identifiant technique de topic reste accessible à la fin. Ordre Wi-Fi : activation, SSID, mot de passe. Le sélecteur Wi-Fi et la page Réseau utilisent les mêmes fonctions de recherche asynchrone et de rendu des réseaux. La saisie manuelle reste possible. Le libellé de branche network devient Réseau en français.

Validation du 4 octobre 2026 : 49 tests Python réussis, tests navigateur Activité, Réseau/Étalonnage, initialisation CSP et sélecteur Wi-Fi réussis ; 14 ressources minifiées validées. Firmware 3.4.3+20261004.140150 et image web finale flashés sur COM6, sommes de contrôle vérifiées. MQTT reconnecté, AP fermé ; interface réelle vérifiée pour ordre MQTT/Wi-Fi, branche Réseau, pas 0,5 °C et cases de sélection Activité.

Ajustement d’affichage : réseau en minuscules, ordre de la branche virtuelle conservé (ethernet, wifi, mqtt, time), champ SSID manuel visible uniquement lorsque Saisie manuelle est choisi. Test du sélecteur réussi, ressources web compilées et flashées.

Dans l’en-tête BRANCHE, état réseau à droite : IP Ethernet, IP Wi-Fi ou état MQTT selon la branche ouverte. Le résumé suit les actualisations réseau ; il est masqué dans les autres branches. Ordre réseau : ethernet, wifi, mqtt, time.

Correction finale : information réseau à droite du cadre Branche chargée. Contraste sombre des bandeaux d’information, de succès et d’erreur amélioré. L’absence de mesure live ne supprime plus le contexte d’étalonnage ni les coefficients chargés ; un message indique de vérifier le raccordement ou de saisir la mesure. Test navigateur avec mesure indisponible et coefficients conservés réussi.

### Priorités 1 issues de main(9)
Intégration ciblée des corrections suivantes, sans changement des affectations de relais, des politiques de sécurité, des sondes ou des identifiants Home Assistant :
- Watchdog web : lecture de l’horloge après le snapshot de santé et comparaison des âges plutôt que des horodatages bruts, y compris lors du débordement de millis(). Un blocage réel reste détecté.
- Registre de commandes porté de 64 à 80 entrées pour supprimer la saturation observée lors de l’initialisation.
- DataStore : rétention des notifications d’état pendant tout le fonctionnement, regroupement par clé et publication progressive avec conservation des demandes refusées. HMI et MQTT traitent ces états dans leurs propres tâches (8 clés par passage). Les commandes, alarmes et transitions gardent leur chemin normal. Les états intermédiaires regroupés ne sont pas garantis : la dernière valeur reste la référence.
- Configurations MQTT : demandes mémorisées dans une boîte concurrente fixe de 96 routes ; resynchronisation lors de la reconnexion et au plus 2 nouvelles demandes par producteur et par passage, avec conservation de la priorité la plus haute et mécanisme de retry existant.
- Interface : limiteur partagé de 2 lectures JSON via fetchJsonResponse, maintenu jusqu’à réception du corps. Le chargement parallèle des noms des sorties utilise ce limiteur. Les écritures passent sans attendre derrière ces lectures.
Validation avant flash : 52 tests Python réussis ; test du limiteur JSON (réception du corps, erreurs, cache, écritures), initialisation sous CSP, Réseau/Étalonnage, Activité et sélecteur Wi-Fi réussis. Les tests de l’ancienne boîte startup ont été migrés vers PendingDataKeys et l’ancienne implémentation inutilisée retirée. Les autres priorités de main(9) ne sont pas intégrées dans ce lot.

Validation sur carte : firmware 3.4.3+20261004.144706 flashé sur COM6 avec vérification des hashes. Interface initialisée, IP Wi-Fi 192.0.2.10, MQTT connecté et compteurs rxdrp/prsf/hndf/ovr à zéro, AP fermé. Aucun message Command registry full dans le journal de démarrage consulté. Uptime croissant jusqu’à 1 min 46 s pendant les vérifications ; état normal et automatismes existants conservés.


## Priorités 2 de main(9) — 4 octobre 2026

- Informations : suppression de la ligne Adresse IP redondante ; Type réseau placé avant l’unique ligne MQTT.
- Compteurs d’impulsions : checkpoint demandé à la tâche IO, acquitté après écriture NVS ; les redémarrages système/web/Rescue et les mises à jour attendent la confirmation. En cas d’erreur ou de dépassement du délai de 2 secondes, l’opération échoue explicitement. Les compteurs non actifs conservent leur sauvegarde existante.
- Home Assistant : identités des entités conservées, topics et commandes construits depuis les affectations PoolLogic validées au démarrage. La pompe et l’électrolyseur partagent un relais dans notre fork : seul le rôle du mode configuré est publié, et les anciennes configurations de découverte des rôles inactifs sont retirées du broker. Les buffers restent disponibles jusqu’à la fin de la découverte ; une modification d’affectation demande un redémarrage pour renouveler cette découverte.
- Le catalogue des suppressions HA est dimensionné à 64 entrées pour couvrir les migrations d’alarmes, de forçages et les rôles inactifs, y compris leur cumul.
- Diagnostics de démarrage : mémoire interne libre, plus grand bloc, PSRAM et utilisation NVS ; diagnostic de libération des buffers de découverte.
- Les limites de 8 équipements et la configuration I²C de notre fork sont conservées : les extensions de priorité 3 ne sont pas incluses.

Validation : 54 tests Python réussis, dont sauvegardes avec échec flash/concurrence/délai dépassé et découverte HA avec affectations remappées et rôles désactivés. Tests JavaScript Informations/réseau, Réseau/Étalonnage, sélecteur Wi-Fi et démarrage sous CSP réussis. Les essais de panne d’écriture et de remise à zéro utilisent des simulations, sans réinitialiser les compteurs de la carte.

Validation sur carte : firmware et fichiers web flashés sur COM6, hashes vérifiés. Version 3.4.3+20261004.172112 ; Wi-Fi 192.0.2.10, MQTT connecté et AP fermé. Aucun doublon de commande, échec d’enregistrement du compteur ou panic dans le journal de démarrage. La découverte HA termine et libère 10 664 octets de buffers (mémoire interne libre observée : 63 516 octets). L’affichage Informations a été vérifié avec l’ordre demandé. La confirmation du bouton de redémarrage a bloqué le navigateur intégré et a été refermée par l’utilisateur. Un redémarrage a été observé ensuite via la remise à zéro du temps de fonctionnement ; Wi-Fi et MQTT sont revenus connectés. Le comptage avec impulsions physiques n’est pas testé sur le banc actuel : les scénarios de checkpoint, concurrence et panne NVS sont validés par les tests host.


## Comptes et affectations — 4 octobre 2026

- Le dernier administrateur ne présente plus de bouton Supprimer. Les protections serveur existantes interdisent également sa suppression et sa rétrogradation. Test navigateur avec un administrateur, un administrateur et un opérateur, puis deux administrateurs.
- Entrées/Sorties affiche le relais physique CH1 à CH8 dans une colonne Relais, séparément du numéro de sortie logique (digital_out #2 ne signifie pas CH2). Le binding est fourni par le snapshot runtime et rafraîchi dans les tables.
- Le nom de la désinfection dans les affectations et le tableau DomainSlots suit le mode configuré : Chlore / Brome, Électrolyse, Oxygène actif ou Désactivé. Le relais libre ne porte plus de numéro CH fixe dans ces affichages.
- Enregistrer et redémarrer sauvegarde les affectations, invalide les caches de configuration et de topologie, puis utilise le redémarrage système avec checkpoint des compteurs pour appliquer les raccordements physiques et retrouver la même commande logique dans HA.
- Validation : 54 tests Python réussis ; tests JS des affectations avec permutation et demande de redémarrage, des noms et relais, du dernier administrateur, des interlocks et de l’initialisation sous CSP réussis. Compilation firmware et SPIFFS réussie.

Validation sur carte : firmware 3.4.3+20261004.180450, Wi-Fi 192.0.2.10 et MQTT connectés, AP fermé, compteurs MQTT de pertes/erreurs à zéro. Flash firmware et interface vérifié par hash. DomainSlots vérifié visuellement : désinfection CH6, pH CH7, éclairage CH3, relais libre CH2. Le mode désinfection actuellement persisté est Désactivé ; il a été conservé. Les ports physiques du snapshot IO servent de référence lorsque les métadonnées de l’actionneur n’exposent pas le binding. Capture : relais-ch6-verifie.png.


## Fichier des accès Rescue

Le fichier local-device/rescue-access.txt est créé ou actualisé uniquement après flash (hook PlatformIO upload), à partir du SSID et du mot de passe AP reçus sur le port série. Une compilation seule ne touche pas ce fichier. Pour un flash direct par esptool, exécuter scripts/capture_rescue_credentials.py --port COM6 --project-dir <projet> --reset après le flash. FLOWIO_LOCAL_DEVICE_DIR permet de conserver le fichier dans le projet utilisateur lorsqu’une copie temporaire sert à construire ou flasher. Le fichier indique la date du flash, les accès AP et les adresses Rescue/interface complète. local-device est ignoré par Git et exclu des archives de livraison.


### Correction du démarrage manuel de l’électrolyse (4 octobre 2026)

Le bouton ON/OFF et le forçage temporisé conservent la filtration effective, la pression et le débit si surveillés comme conditions de circulation. Les mesures de température et d’ORP ne bloquent plus la commande manuelle ON/OFF ; leurs validations restent appliquées à la régulation automatique. Un test hôte exécute le bloc de contrôle de production pour vérifier ces deux chemins et les refus de circulation.

Les équipements du panneau de commande utilisent les traductions françaises existantes et le nom du mode de désinfection sélectionné. Les états ON/OFF sont affichés Marche/Arrêt.


### Visibilité des cartes du tableau de bord

La carte de durée maximale de la pompe chlore (ancien libellé ORP uptime) ne s’affiche que pour Chlore/Brome. Les cartes de seuil pression exigent une sonde configurée et une surveillance de pression activée. Ces règles portent sur l’affichage et conservent les protections et historiques d’alarme. Le nom PSI de la carte Sonde est traduit en Pression ; l’unité de mesure n’est pas modifiée. Les tests hôtes couvrent les quatre modes de désinfection, la désactivation de la surveillance et l’absence de sonde.


### Alarmes et sondes facultatives — 4 octobre 2026

Les alarmes de durée portent les libellés « Durée maximale pompe pH » et « Durée maximale pompe chlore » sur le tableau de bord et dans la gestion des alarmes. La traduction repose sur l’identifiant d’alarme et couvre les anciens libellés enregistrés ; les identifiants et conditions de sécurité sont conservés. Les écrans locaux utilisent également les nouveaux noms.

La surveillance de débit dispose de la carte « Débit de filtration absent ». Elle est ajoutée lorsque la surveillance est configurée, sans remplacer les huit cartes personnalisables ni dupliquer une carte débit déjà présente. Modifier uniquement le débit ne réactive plus les alarmes de pression. Aucun champ supplémentaire de surveillance de pression n’est ajouté.

Affectation des sondes propose l’activation ou la désactivation du compteur d’eau (entrée d’impulsions GPIO5, ou raccordement actuel), du BME680 et du BMP280. Le compteur utilise le raccordement existant et son total n’est jamais modifié par ce formulaire. Les pilotes BME680 et BMP280 utilisent leur option enabled. Les cartes suivent la configuration plutôt que la disponibilité temporaire de la mesure.

Tests : règles de visibilité et sérialisation exécutées à partir du code C++ de production ; formulaire de désactivation/réactivation sans remise à zéro du compteur ; gestion des alarmes avec anciens noms ; affichage de la neuvième carte de débit et rafraîchissement du tableau de bord. Compilation firmware et SPIFFS réussie.


### Démarrage des sondes directes

Les bus OneWire GPIO19/GPIO20 sont maintenant construits sans initialiser les broches. L’initialisation du GPIO et l’association DallasTemperature se font uniquement dans begin(), lorsque le pilote direct utilise effectivement le bus. Les choix DS2484 ne provoquent ainsi aucune prise des broches USB pendant la construction des modules. Le test hôte vérifie l’absence d’accès GPIO à la construction, l’absence de scan avant begin(), et l’initialisation unique de chaque bus.

Le démarrage expose aussi ses étapes et ses échecs sur la console USB, afin de diagnostiquer une indisponibilité avant le lancement de l’interface Web. Les sauvegardes du diagnostic (NVS, données de fonctionnement et ancien coredump) restent dans local-device, exclu des livraisons.

### Relecture du journal au démarrage

Le diagnostic USB localise le blocage dans la relecture de activity.1.log, après 320 lignes. La sauvegarde du fichier contient 345 activités JSON valides suivies d’une fin endommagée. La relecture utilise maintenant des blocs bornés et s’arrête lorsqu’une lecture ne retourne plus de données, même si la taille annoncée par SPIFFS reste supérieure aux données lisibles. Elle conserve les activités valides, les marqueurs de séquence et les fichiers sur disque ; elle signale les lectures courtes et les enregistrements invalides sans formater ni réécrire le journal.

Le test hôte exécute le lecteur de production avec une fin tronquée et une taille incohérente, un enregistrement trop long suivi d’une activité valide, un marqueur de séquence et un dernier JSON sans saut de ligne. Le test de suppression sélective et de récupération reste réussi.

Validation sur carte : firmware 3.4.3+20261004.232819 flashé sur COM6, firmware et SPIFFS vérifiés par hash. Le fichier ancien annonce 98 195 octets mais SPIFFS ne restitue que 94 208 octets ; le lecteur termine maintenant au lieu de boucler. Le fichier courant est lu entièrement (19 277 octets, 67 lignes). Les activités lisibles sont reprises et les nouveaux événements sont sauvegardés : 401 entrées, 4 nouvelles écritures et aucune perte de persistance observées après redémarrage. Une partie du fichier ancien reste illisible sur carte ; la sauvegarde brute avant intervention est conservée dans local-device et aucun fichier de journal n’a été effacé ou réécrit par la correction.

Wi-Fi 192.0.2.10, MQTT TLS connecté, AP fermé, heure NTP synchronisée, compteurs MQTT d’erreurs/pertes à zéro. L’interface authentifiée administrateur est chargée. Les libellés de durée maximale, la carte de débit et les trois sélecteurs de sondes facultatives ont été vérifiés visuellement ; la sonde de pression actuellement désactivée ne présente aucune carte de mesure ou d’alarme. Capture : livraison-3.4.3/interface-retablie-alarmes.png. Le fichier local-device/rescue-access.txt a été actualisé après flash avec les identifiants AP conservés ; l’AP fermé n’a pas émis de nouvelle capture d’identifiants.


### Suppression des activités — 5 octobre 2026

La sélection « Sélectionner tout le filtre » couvre toutes les dates du journal conservé, en chargeant les pages de l’API avant de permettre la sélection. Elle ouvre la vue « Tout le journal » pour rendre visibles les messages sélectionnés. « Sélectionner les visibles » conserve son rôle limité à la plage affichée. Une confirmation dans la page présente le nombre exact de messages, sans dialogue bloquant du navigateur.

La suppression reprend le protocole asynchrone de la version 3.4.3 : la requête authentifiée programme un travail dans la tâche du journal et retourne un identifiant. Cette tâche est l’unique rédacteur des activités et écrit des marqueurs persistants de suppression, après les événements déjà en attente. Elle rend régulièrement la main au système. Elle ne réécrit plus les fichiers depuis la tâche HTTP. La relecture au démarrage applique les mêmes marqueurs ; les numéros de séquence ne sont pas remis à zéro. Les suppressions sont logiques, comme dans la 3.4.3, et suivent la rétention normale des fichiers.

L’interface envoie des lots de 128 identifiants puis attend la confirmation de chaque lot. Une erreur d’écriture ou une confirmation manquante est annoncée, y compris une suppression éventuellement partielle. Les requêtes de suppression ne sont pas relancées automatiquement après une erreur réseau ou un HTTP 503. Les protections administrateur et CSRF restent en place.

Tests hôtes : exécution des méthodes C++ de production pour la demande sans accès disque, la file d’attente, la suppression sélective persistante, la relecture après redémarrage, l’échec partiel d’écriture, la limite de purge préservant les événements plus récents et un lot de 300 événements. Le test du lecteur de journal tronqué reste réussi. Tests navigateur : 300 événements PoolLogic anciens répartis sur plusieurs pages, conservation de 92 événements système, trois lots de suppression, annulation de confirmation, échec de persistance et refus HTTP 503 sans répétition. Les 14 ressources Web minifiées sont validées.

Validation sur carte : firmware 3.4.3+20261005.211417 et interface flashés sur COM6, hash des deux images vérifié. Wi-Fi 192.0.2.10 et MQTT connectés ; 379 activités conservées et sauvegardées avant le test de suppression. La sélection PoolLogic couvre 304 événements, y compris ceux des jours précédents. Le fichier local-device/rescue-access.txt est actualisé après flash avec les identifiants AP conservés (AP fermé). Capture de sélection : livraison-3.4.3/activite-selection-toutes-dates.png.

Suppression réelle validée avec accord explicite : seul le message de démarrage no 445 (5 octobre 21:20:01) est supprimé. Le serveur confirme delete_state=2 et delete_removed=1, le journal passe de 379 à 378 entrées, et la comparaison de toutes les pages montre qu’aucun autre message n’a disparu. Le temps de fonctionnement augmente de 151 193 à 177 474 ms ; aucun redémarrage n’a eu lieu pendant le test. Wi-Fi et MQTT restent connectés, aucune perte de persistance n’est comptabilisée. L’interface affiche « Sélection supprimée. ». Capture : livraison-3.4.3/activite-suppression-verifiee.png. La persistance après redémarrage est couverte par les tests C++ ; aucun redémarrage supplémentaire de la carte n’a été demandé pour ce test.

Les boutons Tous, PoolLogic, Manuel, Sécurité et Système ouvrent désormais directement toutes les dates du journal, sans sélectionner les lignes. La vue complète est également celle proposée à l’ouverture de la page. Les événements sont affichés du plus récent au plus ancien, selon leur date, avec le numéro de séquence pour départager deux événements simultanés ; les événements sans heure connue restent en fin de liste. Le choix d’une plage de trois heures reste disponible ; le clic suivant sur un filtre rétablit le journal complet. Les tests navigateur couvrent chacun des cinq filtres après restriction à une plage, l’ordre décroissant, le rafraîchissement et les suppressions déjà testées.

Validation de cet affichage sur carte : clic sur PoolLogic après choix d’une plage courte, passage automatique à « Tout le journal », 299 événements sur 373 affichés, aucune case cochée automatiquement. L’ordre des dates est décroissant : 5 octobre, 4 octobre, 3 octobre, puis date inconnue. Le contrôle de toutes les heures affichées confirme ce tri. Mise à jour de la seule partition SPIFFS, hash vérifié, Wi-Fi et MQTT connectés après redémarrage. Capture : livraison-3.4.3/activite-filtres-journal-complet.png. Les archives firmware/interface et sources sont réactualisées.

La barre d’activité comporte désormais un seul bouton de sélection, nommé « Sélectionner les événements ». « Sélectionner tout le filtre » et son gestionnaire JavaScript sont supprimés, puisque les filtres ouvrent déjà toutes les dates du journal. Le bouton restant sélectionne ou désélectionne les événements affichés. Le compteur technique « persistés » est retiré : il comptait les écritures depuis le démarrage, marqueurs de suppression compris, et non les événements conservés. L’affichage conserve le nombre d’événements du filtre et le total du journal. La validation navigateur existante reste réussie avec le bouton unique, les filtres et les suppressions asynchrones.

Validation sur carte de la barre simplifiée : seul le bouton « Sélectionner les événements » est présent ; le filtre PoolLogic affiche 302/377 événements sans compteur « persistés ». Le bouton coche les 302 événements puis les décoche lors du second clic. Aucune suppression réalisée pendant cette vérification. Interface SPIFFS flashée et hash vérifié, Wi-Fi et MQTT connectés, fichier local d’accès actualisé après flash. Capture : livraison-3.4.3/activite-bouton-selection.png.

## Publication GitHub

Cette branche publie le fork Flow.io Waveshare 3.4.3 à partir de l’archive expérimentale main(8), dont la version déclarée était 2.0.1, et des fonctions de la branche de référence 3.4.3. Les adresses de l’installation dans ce document sont remplacées par des exemples. Les identifiants, mots de passe AP, sauvegardes NVS, données de fonctionnement et diagnostics restent dans local-device, exclu de Git. Les chemins ArduinoJson des tests sont configurables avec FLOWIO_TEST_LIBDEPS ; sans cette variable, les tests utilisent .pio/libdeps du projet après installation des dépendances PlatformIO.
