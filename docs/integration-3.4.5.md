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

La carte Équipements affiche l'état réel du chauffage. La carte Chauffage conserve sa présentation et permet de choisir Actif/Inactif ; sa consigne devient modifiable par pas de 0,5 °C lorsque la régulation est active. Chaque changement est immédiatement enregistré dans les variables persistantes `poollogic/heater/heater_auto_mode` et `heater_setpoint`, également utilisées par Configuration et Home Assistant. Aucun redémarrage n'est nécessaire.

Passer à Inactif retire la demande guidée précédente du chauffage et désactive les cycles de filtration nécessaires aux prises de température pour la régulation. La filtration conserve ses autres règles, notamment sa plage horaire et la protection contre le gel. Le rafraîchissement du tableau de bord reprend les changements de configuration sans interrompre une saisie en cours ni remplacer un réglage récent par une ancienne lecture.

Les tests du chauffage exécutent la sérialisation du véritable état du relais dans le module, les réponses HTTP et les comparaisons utilisées par les notifications, l'arrêt de la demande guidée lors d'un changement de régulation, ainsi que les commandes web, la validation, les droits d'accès, les échecs d'enregistrement et les lectures concurrentes.

## Capacité et vérifications

La table de configuration passe de 768 à 832 entrées, toujours en PSRAM, pour accueillir les champs supplémentaires avec une marge. Les tests couvrent les permutations du plan de bus, les deux affectations pH/ORP-pression, les adresses fixes, le pont partagé, les extensions et l'indisponibilité du verrou. Les anciens réglages, l'historique et les entrées directes sont conservés.

Cette évolution du chauffage est vérifiée par 18 tests Python/compilations hôtes et sept tests JavaScript du tableau de bord et des commandes d’équipements. Les 14 ressources web minifiées sont contrôlées. Les compilations du firmware et du système de fichiers réussissent : RAM statique 97 068 octets, occupation Flash du programme 2 370 911 octets.
