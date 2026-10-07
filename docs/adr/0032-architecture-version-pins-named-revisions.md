# An Architecture version pins linked documents by writing named revisions in them

Tagging an Architecture version writes a named revision in every linked document the tagger can read, even one they cannot edit, and the version points at those revisions. Automatic revisions may be combined before they are finalized, so pinning one could lose it; marking existing revisions as "pinned" would add a second retention rule to revisions. Named revisions already never change or merge, so the pin stays valid with no new rule.

## Consequences

- A document's history can gain a revision authored by someone without edit access to it. Its body is untouched; the revision title names the Architecture version, which explains where it came from.
- Documents the tagger cannot read are recorded as not pinned rather than snapshotted, so tagging never reads content past the tagger's access.
- Restoring a version restores the canvas only; each linked document keeps its own history.
