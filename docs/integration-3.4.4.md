# Fork Waveshare 3.4.4

Cette branche poursuit le fork 3.4.3 avec deux évolutions issues de l'amont.

## Démarrage et Home Assistant

Une erreur d'allocation ou d'enregistrement d'une entité Discovery est journalisée et ne bloque plus le démarrage. Les contrôles de configuration du matériel restent obligatoires. Une erreur de préparation des relais ne publie pas d'entités associées à une affectation incorrecte ; les autres entités continuent leur enregistrement.

## Valeurs calculées

Les 16 définitions `io/value/v00` à `v15` disposent d'un interrupteur d'activation et d'un nom personnalisable, repris dans l'arborescence et Home Assistant. Les nouvelles définitions sont désactivées par défaut. Les définitions déjà configurées sont activées une seule fois lors de la migration, sans modifier une désactivation explicitement enregistrée.

Le nom peut changer sans modifier l'identifiant Home Assistant. Une définition désactivée ou non publiée retire son ancienne annonce Discovery. La capacité du catalogue HA est augmentée pour ces 16 valeurs, en conservant la capacité des annonces existantes.

## Vérifications

- 61 tests Python/compilations hôtes réussis, dont migration des valeurs et simulation d'échecs Discovery.
- Tests JavaScript des noms de valeurs et des traductions des entrées/sorties réussis ; ressources web minifiées et contrôlées.
- Compilation ESP32-S3 réussie : RAM statique 96 684 octets ; firmware 2 368 859 octets.
- Les comportements physiques et la découverte dans une instance Home Assistant restent à vérifier sur l'installation.

Cette version conserve les réglages NVS et l'historique. Le fichier local d'accès AP est généré uniquement lors d'un flash.
