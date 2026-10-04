# Mémoire RS485 et pilotes

Les buffers du transport et les 16 emplacements de l’ordonnanceur sont alloués une fois en PSRAM. Aucun buffer de trame n’est alloué par transaction. Les valeurs exactes sont journalisées au démarrage avec `sizeof(Storage)`.

Les pilotes sont contenus dans les slots PSRAM de `PoolDeviceModule`, avec des capacités bornées : six paliers, six points de débit, huit modes et 2048 octets de configuration JSON par équipement. Les chaînes de découverte Home Assistant sont également conservées dans ces slots, pour garder une durée de vie stable.

La télémétrie PAC conserve 14 registres et cinq horodatages de blocs dans l'état du pilote ; la table de décodage est constante. Elle utilise les mêmes buffers de transaction, sans allocation par lecture. Le module indépendant de pompes variables a été supprimé.
