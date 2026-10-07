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

Le tableau de bord ne bloque plus le premier affichage des réglages sur 42 lectures successives : les 11 modules principaux sont lus par groupes de trois, en parallèle du chargement des descriptions par groupes de deux. Les cartes principales s'affichent ensuite ; les 31 modules d'affectation sont chargés dans un second temps, toujours par groupes de trois. Les formulaires d'affectation ne deviennent disponibles qu'une fois toutes leurs données lues. Leur chargement ne reconstruit pas les champs déjà affichés et conserve donc les saisies et les enregistrements réalisés entre-temps. Un échec limité aux affectations conserve les cartes principales et affiche un message dans la zone des affectations. Les lectures remplacées par une nouvelle demande s'arrêtent avant leur groupe suivant. Les tests couvrent ces limites, l'ordre de rendu, la complétude des données et les changements concurrents.

La carte Régulation utilise aussi les champs partagés avec Configuration : Actif/Inactif, délai après démarrage de la filtration, durée minimale d'injection et intervalle de calcul. Le choix est enregistré dans `poollogic/regulation/enabled`, actif par défaut pour préserver le fonctionnement existant. Inactif suspend les dosages automatiques des pompes pH et chlore et désactive l'édition des trois temporisations sur le tableau de bord. Les commandes manuelles, l'électrolyse et l'oxygène actif restent indépendants. Le changement remet à zéro les deux régulateurs et retire uniquement leurs demandes automatiques ; les temporisations restent enregistrées. Le même choix est disponible par MQTT et Home Assistant.

Les temporisations conservent leurs unités de configuration : minutes pour le délai, millisecondes pour les deux durées. Les descriptions expliquent leur rôle et le rapport de 1 000 ms pour une seconde. Les injections calculées plus courtes que la durée minimale sont ignorées. L'intervalle de calcul ne peut pas être inférieur à 100 ms dans les champs web. Des tests exécutent les conditions de pilotage et de changement de configuration du firmware, ainsi que l'enregistrement, les limites, le rafraîchissement et la synchronisation des champs web.

La table de configuration passe de 768 à 832 entrées, toujours en PSRAM, pour accueillir les champs supplémentaires avec une marge. Les tests couvrent les permutations du plan de bus, les deux affectations pH/ORP-pression, les adresses fixes, le pont partagé, les extensions et l'indisponibilité du verrou. Les anciens réglages, l'historique et les entrées directes sont conservés.

Cette évolution du chauffage est vérifiée par 18 tests Python/compilations hôtes et sept tests JavaScript du tableau de bord et des commandes d’équipements. Les 14 ressources web minifiées sont contrôlées. Après l'ajout de Régulation et du contrôle de la sonde d'eau désactivée, les compilations du firmware et du système de fichiers réussissent : RAM statique 97 108 octets, occupation Flash du programme 2 371 659 octets.
