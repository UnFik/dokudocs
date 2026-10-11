# AI chat runs outlive client connections

An AI chat run continues on the server when its client disconnects or closes the panel. Dokudocs retains its draft and status separately from the completed conversation answer, so the User can reconnect to the same run without repeating generation or tool actions. This requires a run lifecycle independent of the observing HTTP request; a client disconnect is not a cancellation request.

For the initial implementation, a server restart marks unfinished runs as interrupted and retains their persisted draft and action records. Do not automatically resume generation or replay tools: a write may have completed before the interruption, so replay could repeat its effects. This favors explicit recovery over automatic execution across server restarts.
