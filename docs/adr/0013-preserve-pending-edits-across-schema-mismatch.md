# Do not merge pending edits across incompatible body schemas

The server accepts collaborative updates only when the client's `BodySchemaVersion` matches the stored body schema. On mismatch, the client keeps pending edits locally and requires a compatible application or explicit recovery; it never sends them for automatic merge. This favors avoiding silent body corruption over transparent use of an old cached editor after a schema change.
