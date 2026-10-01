# G1 HA resilience: failover evidence, sizing, and runbook

Date: 2026-10-02. Scope: issues #11 (failover drills, RPO/RTO), #12 (sizing, HA topology), #13 (revoke, expiry, logout with pending edits). Everything below was produced in the repository against disposable local PostgreSQL 16 and Redis 7 containers. No managed service, multi-node failover, or production-sized load was available, so those rows are marked **Not verified**.

## Measured here (local, disposable containers)

| Scenario | Test | Result |
| --- | --- | --- |
| Redis fully unreachable, edit sent | `TestRedisOutageKeepsAcknowledgedEditsAndPeersConvergeAfterRecovery` | ACK in 12-31 ms with Redis down; PostgreSQL holds the edit at version 2 |
| Redis returns, peer on another instance missed the publish | same | Peer converged by resync 4.97-4.98 s after Redis returned (resync tick is 5 s); live fan-out resumed with no restart |
| PostgreSQL unreachable mid-commit | `TestPostgresOutageNeverAcksAndTheRetryAppliesOnce` | No ACK, no fan-out to peers; server reports `unavailable`; retry with the same update ID after restore commits once (version 2), a second retry returns the same ACK |
| Redis pub/sub connection killed, subscriber recovers | existing `TestBrokerStreamEndsWhenItsConnectionIsKilledAndANewSubscriptionRecovers` | passes |
| Origin process killed after commit, client reconnects to survivor | existing `TestWebSocketProcessRestartRecoversCommittedUpdateAndAllowsRetry` | passes |

Outages are simulated with a TCP proxy that refuses connections and drops live ones, then listens again on the same port. This models a crash and restart of the service, not a managed-service promotion with DNS change or replica lag.

### Defect found and fixed by the drill

A store outage during commit was reported as `update_rejected`. The client treats that as terminal and switches the editor to `recovery-required`, so one PostgreSQL failover would have pushed every active editor into manual review. The server now reports `unavailable` for connection, timeout, failover (SQLSTATE 08/53/57, 25006) and serialization/deadlock (40001/40P01) errors; the client keeps the update pending and reconnects with backoff. Covered by `update_error_code_test.go` and a provider test.

## RPO and RTO (what can be stated)

- **ACK semantics:** an ACK means committed in PostgreSQL. Redis loss never loses an ACKed edit (RPO 0 for Redis). Fan-out gap is repaired from PostgreSQL within one resync tick, 5 s, plus the subscriber reconnect time.
- **Redis RTO for collaboration correctness:** about 5 s after Redis returns (measured above). While Redis is down, edits still commit and ACK; remote peers lag. Presence entries expire by TTL.
- **PostgreSQL RPO:** equals the replication guarantee of the deployment, not of the application. With asynchronous replicas, a promotion can drop commits that were already ACKed. To keep "no lost ACKed edit" the primary must use `synchronous_commit = on` with a synchronous standby (`synchronous_standby_names`), accepting the extra commit latency and that writes stall if the standby is lost. **Not verified:** requires a real primary/standby pair.
- **PostgreSQL RTO:** application-side recovery after the database is reachable is the client backoff (250 ms doubling to 15 s cap) plus a 5 s resync. The database promotion time itself is the platform's number. **Not verified.**
- **Orchestrator restart:** covered at process level by the existing process-restart test. A rolling restart on a real orchestrator, with connection draining, **Not verified.** `Server.Shutdown` closes peers and rejects new connections, and clients reconnect.

## Sizing model (derived from code and existing measurements)

Inputs taken from the code and from `dokudocs-open-issues.md` G6 item 2 (local, repository level: 10 editors, 2,001 nodes, p95 66-115 ms per commit, about 17.8 commit/s). They are not production numbers.

- **PostgreSQL connections:** a commit holds one pool connection for its transaction. At p95 ~100 ms one connection sustains about 10 commits/s, so a pool of N connections sustains roughly 10 x N commits/s before queuing, minus connections used by REST and room reads. The pool was hard-coded to 10 and is now `DB_MAX_OPEN_CONNS` / `DB_MAX_IDLE_CONNS` / `DB_CONN_MAX_LIFETIME` (defaults unchanged). Total across instances must stay below PostgreSQL `max_connections` minus reserve: `instances x DB_MAX_OPEN_CONNS + migrations/admin <= max_connections - 10`.
- **Room polling:** one head read per active document per instance every 5 s, so about `0.2 x active_documents x instances` reads/s, independent of editors per document.
- **Redis:** one global channel (`dokudocs:collaboration:v1`). Every instance receives every committed update of every document, so per-instance inbound rate equals the cluster commit rate, and cluster-wide Redis egress is `instances x commit rate x update size`. Sharding the channel by document would be needed only if that product becomes the bottleneck.
- **WebSocket memory:** per peer a 64-message queue and a message cap of 16 MiB; the committed-body cache holds 32 documents per instance (ADR 0017), memory for large documents is unmeasured (open-issues G6 item 7).

### Proposed targets (to be confirmed by load test, not measured)

| Item | Proposal |
| --- | --- |
| Editors per document | 10 (the load already exercised), soft cap enforced later |
| Connections per instance | set after the WebSocket load test; start by sizing pool = expected commit/s / 10, rounded up, plus 4 |
| Commit ACK p95 | 250 ms within one region |
| Peer propagation p95 | 500 ms normal, 6 s after a Redis fan-out loss |
| Availability | 99.9% for edit ACK, assuming synchronous standby |

### Topology to deploy

- 2 or more stateless Go instances behind a load balancer that supports WebSocket and drains on shutdown.
- PostgreSQL primary with one synchronous standby and automatic promotion, plus a stable endpoint that follows the primary.
- Redis as a single managed instance with automatic restart; Redis is a best-effort fan-out, so a replica adds little. Persistence is not needed.

## Runbook: failover drill on a managed or staging environment

Run with two app instances, two browser clients on one document, and a script that types continuously and records every ACKed update ID.

1. **Redis**: stop or fail over Redis for 60 s. Expect: edits keep ACKing; remote clients lag; within about 5 s after Redis returns all clients show the same text. Record time to convergence.
2. **PostgreSQL**: force a primary failover during typing. Expect: clients show offline/reconnecting, no ACK during the gap, no `recovery-required`. After promotion every ACKed update ID recorded before the failover is present in the document body; unACKed ones are retried once. Any missing ACKed ID means replication was not synchronous: record RPO as the lost interval.
3. **Orchestrator**: rolling restart both instances. Expect clients to reconnect to the other instance and keep editing.
4. Record: failure start, first error, promotion complete, first ACK after, convergence time, count of ACKed edits lost. Append to this file with the environment description.

## #13 revoke, token expiry, logout with pending edits

Verified by tests (this branch added the frontend ones; the backend ones already existed):

- Revoke during an active edit: server fan-out drops the revoked peer and keeps serving others (`TestFanOutDropsAPeerWhoseAccessWasRevokedAndStillServesTheRest`); durable edit versus revoke ordering is covered by the G0 race tests; the client clears its cached body and pending edits on `forbidden` and stops sending (provider spec).
- Token rejected after being offline: pending edits and snapshot are kept, status is `unauthorized`, no retry loop (provider spec). An expired or missing token never opens a socket and keeps pending edits. The token is read again at each reconnect, so a refreshed session resumes sync.
- Logout with pending edits: pending data is keyed by user ID, so another account on the same device cannot read it (`collaboration-store.spec.ts`).

## Decision needed: logout with pending edits versus ADR 0007

Current behavior (unchanged, recorded by an E2E spec): sign-out only resets the session. Pending Yjs updates and the cached body stay in IndexedDB under the user's ID. They are unreadable to another account (store test) and reappear when the same user signs in again. ADR 0007 says logout should offer sync or export while read access can be verified, then clear that user's local document state after logout is confirmed.

| Option | What changes | Pro | Con |
| --- | --- | --- | --- |
| A. Keep current behavior, amend ADR 0007 | Document that data stays per user on the device | No work, no data loss on accidental logout | Document content remains on shared devices; contradicts the privacy reason in the ADR |
| B. Implement the ADR | Sign-out dialog counts pending edits; online: wait for ACK or export, then clear; offline: block logout or require explicit discard | Matches the ADR, no residue on shared devices | Needs dialog flow, export path, and an offline policy; user can lose offline work by discarding |
| C. Hybrid | Clear cached bodies with nothing pending at logout; keep only unsynced pending edits, flagged, with a "discard local data" action and a retention limit | No residue except unsynced work | Still leaves some content; more states to test |

Recommendation: B for online logout (flush, then clear), and for offline logout block with an explicit "discard unsynced edits" confirmation. It is the only option that keeps the ADR's stated guarantee on shared devices without silently losing work. Owner decides; until then the E2E spec `logout with a pending edit currently leaves it in local storage` documents the present behavior and should be inverted when the decision lands.
