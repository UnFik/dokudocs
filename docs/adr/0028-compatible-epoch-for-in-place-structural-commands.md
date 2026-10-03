# A structural command in place keeps older updates mergeable

DeleteNode and MoveNode edit the stored Yjs state in place, so its history continues, yet each still starts a new BodyEpoch, and the server rejects an update from the old epoch as `stale_epoch`. A collaborator who types before the room's next check then loses their unsent suggestions to the canonical rebase. We keep the epoch bump (restore and other rebuilds need it) and add a CompatibleEpoch: the server stores the oldest epoch whose history still continues, accepts an update whose epoch lies between it and the current one, and sends `compatEpoch` with `ready` and `resync` so the client can adopt the new epoch, merge the state, and resend what is pending, without a rebase. Restore moves the CompatibleEpoch up to the new epoch, so older updates still go to review.

Considered: letting the client compare state vectors and adopt the new epoch when the history dominates its own. Rejected because the server already knows whether it rebuilt the state, and a client guess that is wrong merges two unrelated histories into duplicated text.

Consequence: one more column and one more frame field, and every writer of `body_epoch` must say whether it rebuilt the state.
