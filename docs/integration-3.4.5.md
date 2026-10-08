# Fork Waveshare 3.4.5

La branche `3.4.5` descend de `3.4.4` et conserve ses améliorations Discovery et valeurs calculées, ainsi que les fonctionnalités du fork 3.4.3.

## Adresses I²C

Les deux ADS1115, le SHT40, le BMP280, le BME680, l'INA226 et les quatre instances d'extension IO disposent d'une adresse principale et d'une adresse secondaire facultative. Les champs sont affichés en hexadécimal dans Configuration / io / drivers. `0x00` désactive l'adresse secondaire ; c'est la valeur par défaut pour préserver le comportement des installations existantes.

Le choix de la carte pH/ORP dans Affectation des sondes conserve l'adresse principale 0x48 ou 0x49. Le convertisseur de pression reçoit l'autre adresse. Ces deux adresses ne sont pas interchangeables comme secours lorsque les deux convertisseurs sont utilisés : une carte absente reste indisponible, sans récupérer les mesures de l'autre carte.

## Résolution du bus

Le plan du bus est résolu avant l'initialisation des pilotes IO, sous le verrou du bus partagé. Chaque adresse est sondée au plus une fois pendant cette résolution.

- Les adresses principales des fournisseurs activés restent réservées même sans réponse.
- Deux fournisseurs réclamant la même adresse principale sont refusés ; une adresse secondaire ne masque pas cette configuration ambiguë.
- Une adresse secondaire n'est utilisée que si la principale ne répond pas, si aucune adresse principale ou fixe ne la réserve et si aucun autre candidat ne réclame ce même secours.
- Le résultat ne dépend pas de l'ordre des fournisseurs. Les adresses actives restent en mémoire ; les adresses enregistrées en NVS ne sont pas remplacées.
- L'horloge PCF85063 (0x51) et les voyants PCF8574A (0x3C) sont réservés par le profil Waveshare, même si le composant ne répond pas.
- Le DS2484 est déclaré une seule fois pour les deux sondes de température lorsqu'au moins une sonde active utilise ce pont. Les raccordements directs GPIO restent disponibles.
- Un pilote sans adresse retenue n'est pas initialisé. L'interface conserve une mesure indisponible, sans lecture sur un autre composant.

Le journal de démarrage indique pour chaque fournisseur activé les adresses principale, secondaire, active et la cause d'un refus : conflit, adresse réservée, configuration invalide ou absence de réponse. Les changements d'adresses sont appliqués au redémarrage.

La résolution détecte les conflits de configuration. Un acquittement I²C seul ne peut pas identifier deux composants physiques câblés sur la même adresse : leur câblage doit également être corrigé.

## Chauffage sur le tableau de bord

La carte Équipements affiche l'état réel du chauffage. La carte Chauffage conserve sa présentation et permet de choisir Actif/Inactif ; sa consigne devient modifiable par pas de 0,5 °C lorsque la régulation est active. Chaque changement validé par la coche est enregistré dans les variables persistantes `poollogic/heater/heater_auto_mode` et `heater_setpoint`, également utilisées par Configuration et Home Assistant. Aucun redémarrage n'est nécessaire.

Les réglages du chauffage reprennent les lignes de l'électrolyse : libellé et description à gauche, liste de choix ou champ numérique à droite, puis coche de validation. Les composants et styles communs à Configuration sont réutilisés, en modes clair et sombre. Seul le clic sur la coche enregistre le changement. Une saisie non validée est conservée pendant les rafraîchissements, même lorsque le champ n'a plus le focus. Les cartes Chauffage, Robot, Protections et Régulation suivent cette même règle. Les trois résumés de l'électrolyse sont retirés, car ils reprenaient les valeurs des champs modifiables.

Les cartes Robot et Protections utilisent les mêmes champs modifiables. Actif/Inactif du robot écrit la variable persistante existante `poollogic/modes/robot_auto_mode`, sans ajouter de mode parallèle ; le délai et la durée du cycle restent dans `poollogic/robot` et deviennent modifiables lorsqu'il est actif. Les demandes manuelles et les sécurités du robot conservent leurs règles.

Protections place le délai avant contrôle du débit, puis celui avant contrôle de pression, les deux seuils de pression, le seuil d'entrée hiver et l'emplacement Tuyauterie/Bassin ; le maintien hors gel est en dernier. Le débit est masqué quand sa surveillance est désactivée ou son entrée non affectée. Les trois réglages de pression sont masqués quand la surveillance est désactivée ou la sonde non affectée. Une sonde configurée mais sans mesure reste visible. Les durées respectent les bornes des variables UInt8 ; les températures utilisent un pas de 0,5 °C et les pressions 0,01 bar.

Les modifications passent par l'API persistante commune à Configuration et MQTT. Le rafraîchissement reprend les réglages Robot, Chauffage et Protections ainsi que les affectations de sondes ; il conserve les saisies en cours et ne réinjecte pas une lecture antérieure à un enregistrement. L'emplacement de température reste synchronisé avec Affectation des sondes, sans remplacer une modification non enregistrée du formulaire.

Passer à Inactif retire la demande guidée précédente du chauffage et désactive les cycles de filtration nécessaires aux prises de température pour la régulation. La filtration conserve ses autres règles, notamment sa plage horaire et la protection contre le gel. Le rafraîchissement du tableau de bord reprend les changements de configuration sans interrompre une saisie en cours ni remplacer un réglage récent par une ancienne lecture.

Une sonde d'eau déclarée désactivée/non câblée interdit les cycles de mesure demandés par le chauffage : la circulation ne pourrait fournir aucune température. Cela n'empêche pas la filtration programmée ou forcée. Une sonde de tuyauterie affectée mais momentanément indisponible conserve ses cycles de validation de cinq minutes et leur délai de nouvelle tentative. Une sonde de bassin est lue directement, sans cycle de mesure par circulation.

Les tests du chauffage exécutent la sérialisation du véritable état du relais dans le module, les réponses HTTP et les comparaisons utilisées par les notifications, l'arrêt de la demande guidée lors d'un changement de régulation, ainsi que les commandes web, la validation, les droits d'accès, les échecs d'enregistrement et les lectures concurrentes.

## Capacité et vérifications

Le sous-titre de la carte Régulation suit le traitement choisi : dosages pH et chlore/brome uniquement en mode Chlore / Brome, dosage pH seul avec électrolyse, oxygène actif ou aucun traitement. L'oxygène actif suit son protocole de doses programmées, indépendant de ces temporisations de régulation. Les aides communes aux champs décrivent les pompes de dosage sans annoncer une pompe chlore dans les autres modes.

Le tableau de bord ne bloque plus le premier affichage des réglages sur 42 lectures successives : les 11 modules principaux sont lus par groupes de trois, en parallèle du chargement des descriptions par groupes de deux. Les cartes principales s'affichent ensuite ; les 31 modules d'affectation sont chargés dans un second temps, toujours par groupes de trois. Les formulaires d'affectation ne deviennent disponibles qu'une fois toutes leurs données lues. Leur chargement ne reconstruit pas les champs déjà affichés et conserve donc les saisies et les enregistrements réalisés entre-temps. Un échec limité aux affectations conserve les cartes principales et affiche un message dans la zone des affectations. Les lectures remplacées par une nouvelle demande s'arrêtent avant leur groupe suivant. Les tests couvrent ces limites, l'ordre de rendu, la complétude des données et les changements concurrents.

La carte Régulation utilise aussi les champs partagés avec Configuration : Actif/Inactif, délai après démarrage de la filtration, durée minimale d'injection et intervalle de calcul. Le choix est enregistré dans `poollogic/regulation/enabled`, actif par défaut pour préserver le fonctionnement existant. Inactif suspend les dosages automatiques des pompes pH et chlore et désactive l'édition des trois temporisations sur le tableau de bord. Les commandes manuelles, l'électrolyse et l'oxygène actif restent indépendants. Le changement remet à zéro les deux régulateurs et retire uniquement leurs demandes automatiques ; les temporisations restent enregistrées. Le même choix est disponible par MQTT et Home Assistant.

Les temporisations conservent leurs unités de configuration : minutes pour le délai, millisecondes pour les deux durées. Les descriptions expliquent leur rôle et le rapport de 1 000 ms pour une seconde. Les injections calculées plus courtes que la durée minimale sont ignorées. L'intervalle de calcul ne peut pas être inférieur à 100 ms dans les champs web. Des tests exécutent les conditions de pilotage et de changement de configuration du firmware, ainsi que l'enregistrement, les limites, le rafraîchissement et la synchronisation des champs web.

La table de configuration passe de 768 à 832 entrées, toujours en PSRAM, pour accueillir les champs supplémentaires avec une marge. Les tests couvrent les permutations du plan de bus, les deux affectations pH/ORP-pression, les adresses fixes, le pont partagé, les extensions et l'indisponibilité du verrou. Les anciens réglages, l'historique et les entrées directes sont conservés.

Cette évolution du chauffage est vérifiée par 18 tests Python/compilations hôtes et sept tests JavaScript du tableau de bord et des commandes d’équipements. Les 14 ressources web minifiées sont contrôlées. Après l'ajout de Régulation et du contrôle de la sonde d'eau désactivée, les compilations du firmware et du système de fichiers réussissent : RAM statique 97 108 octets, occupation Flash du programme 2 371 659 octets.

## Analyse quotidienne et météo

Configuration → ai → openai propose « Analyse automatique » et « Heure de l’analyse quotidienne » (08:00 par défaut). La programmation est désactivée par défaut. La saisie de l'heure devient disponible lorsque le choix est actif ; le bouton Appliquer enregistre les changements. Le firmware utilise l'heure locale de la carte et fonctionne même lorsque le navigateur est fermé. Il attend une heure valide, une localisation, une configuration OpenAI complète et un réseau disponible. S'il retrouve ces prérequis après l'heure prévue, il lance l'analyse encore due pour cette journée.

La tentative quotidienne est réservée en NVS avant sa mise en file. Un redémarrage, un changement d'heure ou une erreur de requête ne déclenche pas de seconde tentative automatique le même jour. Une erreur de sauvegarde suspend la programmation. Une analyse manuelle reste possible ; une réponse datant de moins d'une heure conserve la règle de réutilisation existante. L'heure de la dernière analyse réussie est conservée après redémarrage ; le texte de la réponse reste en mémoire.

Le tableau de bord affiche la dernière et la prochaine analyse, ou la raison d'une programmation en attente. Il actualise l'état par une route légère toutes les minutes et chaque seconde pendant une requête, puis espace les lectures si elle dure longtemps. Ces lectures ne déclenchent aucun appel OpenAI et ne recalculent pas systématiquement le prompt. Elles s'arrêtent lorsque le tableau de bord est masqué.

La récupération Open-Meteo est indépendante de l'activation IA et de la présence d'une clé OpenAI. L'ouverture du tableau de bord demande la météo pour la localisation configurée. Le cache de trente minutes reste utilisé, et le texte météo est actualisé dès la fin de la collecte. L'enregistrement des coordonnées, à lui seul, ne provoque aucune analyse OpenAI.

Les tests exécutent le calcul calendaire de production (avant/après l'heure, changement de journée, redémarrage, recul de l'horloge et journées de 23/25 heures), les prérequis et la réservation durable, ainsi que le chargement météo IA désactivée. Les tests web vérifient la validation explicite, l'heure conditionnelle, les dates de la carte, l'arrêt des lectures hors tableau de bord et l'absence d'appels OpenAI pendant les actualisations. Firmware et système de fichiers compilent : RAM statique 97 204 octets, programme 2 375 651 octets.

Après le flash sur le banc, Open-Meteo répond HTTP 200 et ses données apparaissent automatiquement dans le tableau de bord avec l'IA désactivée et sans clé OpenAI. L'appel OpenAI réel n'est pas exécuté lors de cette vérification, faute de clé et de modèle configurés. Les réglages et l'historique existants sont conservés ; le fichier local des accès Rescue est régénéré après le flash.

## Volume partagé et configuration des sondes

Le volume du bassin est déplacé de `poollogic/o2` vers `poollogic/pool`. Il conserve sa valeur enregistrée via la clé NVS historique `pl_o2vol`. Le protocole oxygène actif et le contexte IA utilisent le même volume. L’entité Home Assistant conserve son identifiant de découverte `pl_o2_vol`, avec un nom générique et les nouveaux topics de configuration et de commande. Le tableau de bord charge la branche commune pour son récapitulatif O2.

Les listes d’entrées proposent « Désactivé / non câblé » pour la valeur `65535`, y compris après le filtrage des canaux disponibles pour Waveshare. Les retours disjoncteurs utilisent les mêmes listes numériques ; leurs choix de polarité sont masqués sans entrée affectée. Les champs sont ordonnés par fonction. La validation globale conserve correctement les valeurs booléennes des listes, notamment le choix d’emplacement de température existant.

La surveillance de pression découle de l’affectation de la sonde : son ancien drapeau reste publié pour compatibilité mais est masqué comme réglage indépendant. Une entrée de débit désactivée coupe sa surveillance ; avec une entrée affectée, le choix de surveillance permet toujours de la suspendre. Les tests exécutent le rapprochement firmware de ces états, le rendu à partir des métadonnées générées, la validation explicite, les polarités conditionnelles et le maintien du volume dans la branche commune.

Firmware et fichiers web ont été compilés et flashés avec conservation de NVS et de l’historique. La carte retrouve 192.168.31.6 et sa connexion MQTT TLS. Le contrôle web confirme le volume enregistré de 50 m³, les choix non câblés, l’absence du réglage de pression en doublon et l’apparition conditionnelle de la polarité sans enregistrement des affectations. Le fichier local des accès AP est régénéré après ce flash. RAM statique : 97 204 octets ; programme : 2 375 803 octets.

## Repérage des relais

Les huit relais intégrés sont présentés comme CH1 à CH8 dans les listes de ports physiques et dans la topologie Entrées/sorties. Les ports 300 à 307, les indices matériels et les constantes internes restent identiques. Un slot logique `dXX` peut commander un autre relais après réaffectation : `d05` ne signifie donc pas nécessairement CH6.

Le nom par défaut du relais libre devient « Relais libre », sans numéro de canal figé. Les noms personnalisés déjà enregistrés restent éditables dans Configuration → io → output ; une mise à jour du firmware ne les écrase pas.

L’arborescence Configuration utilise le même dictionnaire de noms IO que la page Entrées/sorties : les noms standards des équipements sont traduits selon la langue de l’interface et « Chlorine Pump » est présenté comme « Désinfection » en français. Les noms personnalisés sans traduction sont conservés. Les branches `io/output` et `io/drivers` sont affichées comme « Sorties » et « Pilotes » en français ; les chemins de configuration restent inchangés.
