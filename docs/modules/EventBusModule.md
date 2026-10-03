# EventBusModule (`moduleId: eventbus`)

## Rôle

Hôte du bus d'événements interne `EventBus`.
- enregistre le service `eventbus`
- publie `SystemStarted` au démarrage
- exécute `dispatch(...)` en boucle

Type: module actif.

## Dépendances

- `loghub`

## Affinité / cadence

- core: `1`
- task name: `EventBus`
- stack: `2816`
- priority: `1`
- loop: `dispatch(16)` puis `delay(5 ms)`

## Services exposés

- `eventbus` -> `EventBusService`

## Capacités / limites

- longueur queue: `Limits::EventQueueLen` (`40`)
- payload max par événement: `48` octets
- abonnés max: `Limits::EventSubscribersMax` (`56` dans l'environnement Waveshare)
- ring interne de traces de rejets d'abonnement: `8`

## EventBus

Publication:
- `EventId::SystemStarted` dans `init()`

Abonnements:
- aucun (module hôte du bus)

## Logs EventBus (signification)

### Statistiques post (toutes les 5s)

`post stats 5s: drops=.. max_burst=.. ok_total=.. drop_total=.. isr=.. too_large=.. no_queue=..`
- niveau log: `DEBUG` par défaut, `WARN` seulement si la fenêtre de 5 secondes contient des pertes ; les cumuls restent affichés sans réactiver seuls une alerte
- `drops`: drops dans la fenêtre 5s
- `max_burst`: plus grande rafale de drops dans la fenêtre
- `ok_total/drop_total`: cumuls boot
- `isr`: drops depuis `postFromISR`
- `too_large`: payload > 48 octets
- `no_queue`: queue indisponible

### Statistiques abonnements (toutes les 5s)

`sub stats 5s: used=../56 queue=../40 data=.. cfg=.. sched=.. alarm=.. other=.. rej_total=.. cap=.. null_cb=..`
- niveau log: `DEBUG` par défaut, `WARN` si rejet d'abonnement (`rej_total/cap/null_cb > 0`) ou queue pleine
- `used`: nombre d'abonnements actifs
- `queue`: occupation instantanée queue
- `data/cfg/sched/alarm/other`: répartition par type d'événement
- `rej_total`: rejets cumulés d'abonnement
- `cap`: rejets pour capacité atteinte
- `null_cb`: rejets callback nulle

### Détails rejet d'abonnement

`sub reject seq=.. event=.. reason=capacity|null_cb cb=0x.. user=0x.. age_ms=..`
- trace détaillée des tentatives `subscribe(...)` rejetées
- imprimée depuis le ring interne (taille 8)

### Warnings perf

- `dispatch slow: ...` : batch `dispatch` trop long
- `slow handler: ...` : callback abonné trop long

## DataStore / MQTT

Aucun accès direct.
Le module sert de transport interne pour tous les flux `DataChanged`, `ConfigChanged`, alarmes, scheduler, etc.

## Notifications d’état différées

MQTT et HMI mémorisent les clés `DataChanged` dans une boîte à notifications fixe, puis traitent au plus huit clés par passage dans leur propre tâche. Les mises à jour répétées d’une même clé sont regroupées : le consommateur lit le dernier état du DataStore. Une mise à jour concurrente pendant le traitement reste en attente. Les commandes, alarmes et événements de transition ne passent pas par ce regroupement. Aucun traitement de sortie ni parcours de routes MQTT ne se déroule dans le callback `DataChanged` de ces deux modules.

Le DataStore conserve également les clés modifiées pendant toute la durée de fonctionnement. Après le dispatch, la tâche EventBus tente au plus quatre publications par passage. Une file pleine conserve la clé pour réessayer ; aucune notification retenue n’est comptée comme perdue. Les événements ordinaires continuent de signaler leurs pertes éventuelles. Le budget et le parcours circulaire bornent la charge ; les consommateurs lisent le dernier état, sans garantie de recevoir chaque valeur intermédiaire.
