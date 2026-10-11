# Switching the embedding model keeps the old model active until re-embedding finishes

Vectors from two embedding models are not comparable, so after a Superadmin picks a new model the chatbot keeps searching with the old one (the Active embedding model). While a background worker re-embeds every document, new and edited documents are embedded with both models; when the last document is done, search switches to the new model and the old embeddings are deleted. Dimensions stay fixed at 1536 and a model that returns another length is refused at the connection test.

Rejected: switching at once (the chatbot loses all context until the worker finishes), a manual "re-embed all" button (leaves the chatbot in a mixed state), and merging results from both models (ranks from two vector spaces do not mix). The cost is double embedding work for the length of the transition.
