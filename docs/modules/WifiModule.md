# WifiModule (`moduleId: wifi`)

## Rôle

Gestion de la connectivité WiFi STA:
- machine d'états (`Disabled`, `Idle`, `Connecting`, `Connected`, `ErrorWait`)
- publication de l'état réseau dans `DataStore`
- exposition d'un service WiFi minimal
- annonce de `system/devicename` comme hostname DHCP et nom mDNS ; la valeur par défaut `flowio` devient `FlowIO-XXXXXX` en DHCP, avec un suffixe dérivé de l'adresse MAC

Lorsque le Wi-Fi est activé et configuré, la connexion démarre indépendamment d’Ethernet. Les deux interfaces peuvent rester connectées simultanément ; la disponibilité d’Ethernet ne suspend pas les tentatives de connexion Wi-Fi.

Le répondeur mDNS est commun au Wi-Fi et à Ethernet (`Core/SharedMdns`). Chaque interface conserve une participation tant qu’elle est connectée. Débrancher le câble Ethernet ne doit pas arrêter l’annonce de `flowio.local` sur le Wi-Fi ; le service s’arrête lorsque la dernière interface le libère. Un verrou sérialise les opérations sur le répondeur partagé. Les changements de nom et les échecs de démarrage restent réessayables.

Type: module actif.

## Dépendances

- `loghub`
- `datastore`
- `eventbus`

## Affinité / cadence

- core: 0
- task: `wifi`
- délais d'état: 200ms à 2s selon état

## Services exposés

- `wifi` -> `WifiService`
  - `state`
  - `isConnected`
  - `getIP`

## Services consommés

- `datastore`
- `loghub`

## Config / NVS

Module config: `wifi` (`moduleId = ConfigModuleId::Wifi`, branche locale `1`)
- `enabled` (`wifi_en`)
- `ssid` (`wifi_ssid`)
- `pass` (`wifi_pass`)

## DataStore

Écritures via `WifiRuntime.h`:
- `setWifiReady(...)` -> `DataKeys::WifiReady`
- `setWifiIp(...)` -> `DataKeys::WifiIp`

## EventBus / MQTT

- abonnement `ConfigChanged` pour appliquer `system/devicename` au hostname réseau
- pas de publication EventBus directe
- impact indirect: `MQTTModule` et `TimeModule` surveillent `DataKeys::WifiReady`
