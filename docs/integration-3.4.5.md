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

## Capacité et vérifications

La table de configuration passe de 768 à 832 entrées, toujours en PSRAM, pour accueillir les champs supplémentaires avec une marge. Les tests couvrent les permutations du plan de bus, les deux affectations pH/ORP-pression, les adresses fixes, le pont partagé, les extensions et l'indisponibilité du verrou. Les anciens réglages, l'historique et les entrées directes sont conservés.

65 tests Python/compilations hôtes passent, ainsi que les tests JavaScript des noms de valeurs et des traductions IO. Les 14 ressources web minifiées sont contrôlées. Les compilations du firmware et du système de fichiers réussissent : RAM statique 97 068 octets, occupation Flash du programme 2 370 495 octets.
