# Cap collaborative documents at 2,001 nodes

Collaborative commit cost grows with node count, and each instance keeps up to 32 documents (state, decoded Yjs document, body) in the commit cache. Without a cap, one very large document sets both the latency and the memory of every instance.

`documentbody.MaxCollaborativeNodes` is 2,001: the 2,000-node document the G6 gate was written for, plus the root.

Behavior above the cap:

- Initializing a body (`POST /documents/{id}/body/initialize`) or creating a document with `initialBody` above the cap fails with HTTP 413 (`documentbody.ErrTooLarge`). The document stays a legacy Markdown document.
- A collaborative commit that leaves the body above the cap and with more nodes than before is rejected; the WebSocket error code is `document_too_large`. Edits that do not add nodes still commit, so an oversized document can still be edited in place.
- Reads are never limited.
- Deleting nodes through `DeleteNode` is not limited.

Measurements (local PostgreSQL, 12 cores shared with other jobs at load average 13 to 21, so absolute numbers vary between runs):

- One writer, one-character edit, p50/p95: 201 nodes 5/10 ms; 2,001 nodes 22/47 ms; 5,001 nodes 30/49 ms; 10,001 nodes 64/93 ms (a quieter run than the 90/286 ms measured earlier for 10,001 nodes; both are single runs).
- Gate load (10 writers, 2 commits/s each): 2,001 nodes gave p95 of 28 ms, 272 ms, 284 to 464 ms in separate runs; 5,001 nodes gave p95 207 ms to 1.04 s; 10,001 nodes gave p95 479 ms. The 200 ms p95 gate is met at 2,001 nodes only on some runs on this machine, so the gate still needs a rerun on dedicated hardware. Sizes above 2,001 nodes are not supported because no run established them.
- Commit cache memory (`TestCommitCacheMemoryAtTheLargestSupportedDocument`, 32 documents of 2,001 nodes with 80-character paragraphs): about 122 MiB heap per instance (3.8 MiB per document, encoded state 284 KB). At 5,001 nodes the same test held 304 MiB, so memory scales linearly at roughly 1.9 KiB per node per cached document.

Raising the cap needs a load run at the new size on dedicated hardware and a new memory figure.

Profile of a one-character commit at 2,001 nodes (`COMMIT_PROFILE=1`, `-cpuprofile`, 400 commits): the projection walk `projectDoc` took 31% of CPU, mostly `elementBodyAttributes` (JSON validate, decode, and re-encode for every element, including the common `{}`) and a second `GetAttributeValues` copy per element in `nodeID`. Garbage collection took another 30%, driven by those allocations. Validation of the change was 9%, Yjs encoding of the state 8%. The projection now reads the attribute map once per element and skips the JSON round trip when the attributes are `{}`. `BenchmarkProjectV1` (2,001 nodes) went from 130,305 to 112,291 allocations per run and median time from about 37.7 ms to 28.7 ms (8 interleaved runs each, machine load average 10 to 24). Commit loop on the same document, 6 interleaved runs of 400 commits, median of the per-run p50 and p95: before 17.5 ms and 29.0 ms, after 14.4 ms and 21.6 ms. These runs shared the host with other jobs, so treat the gain as roughly 15 to 25 percent, not a precise figure. The full-state encode and write per commit remain.
