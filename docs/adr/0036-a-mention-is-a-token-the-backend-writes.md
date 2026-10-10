# A mention is a token whose label the backend writes

A comment names a person with `@[Name](user:<id>)`. The id is the fact; the name is how it reads. The backend parses every comment and reply, refuses an id that is not a member of the workspace who can read the document (400), and replaces each label with that member's name as it is now, cleaned of `[ ] ( ) @` and control characters. So a client cannot make a mention say one name and mean another person, and a name that changed since an older comment is not rewritten until that comment is edited. The limit of 2000 characters counts what the comment reads, with each token as `@Name`; a separate cap on the stored text (6000) and on mentions per comment (20) bounds the rest.

The grammar lives twice, in Go (`internal/domain/mention`) and in TypeScript (`src/lib/comment-mentions.ts`), and both are tested against one file, `frontend/src/lib/comment-mentions.fixture.json`. Anything that does not match exactly, such as a cut-off token, an id that is not a UUID or a label with a bracket, stays plain text. Users cannot give themselves a name with `[ ] ( ) @` or a line break (400 on register and profile update; a name from a sign-in provider is cleaned instead), so a label never needs escaping.

In a text box the token would be 45 characters of noise, so the box shows `@Name` and tracks where each mention is by position, carrying it through edits and turning it back into plain text when its name is edited.

Notifications are saved in the same transaction as the comment, one open row per person and message, so editing a comment updates the row in place and tells them again; email and push follow once the comment is saved, honour the person's settings, and wait ten minutes after the last send for the same message.

Rejected: storing only `@Name` (breaks when a name changes or two people share one, and the backend could not tell whom to notify), a separate `comment_mentions` table (a second place to keep in step with the text), and escaping inside labels (every reader would need to unescape).
