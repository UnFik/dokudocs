# Workspace invites are mailed single-use links bound to the invited email

Inviting someone to a workspace creates a pending row in `workspace_invites` and mails a link; it never adds a member directly, even when the address already has an account. The link carries a 32 byte random token and only its SHA-256 is stored. It works once and expires after 7 days. Accepting needs a signed-in User whose Verified email (read from the database, not the token claim) equals the invited address, compared in lowercase. A different User, or an unverified one, is refused and the invite stays usable.

Only an owner can invite an admin; an admin can invite members. `owner` is never an invite role, and `guest` is not offered until what a guest may see is defined. A workspace holds at most 50 pending invites, one per address: inviting the same address again replaces the link (not more than once a minute).

Unknown, used, withdrawn and expired links all answer 404 the same way, and the invite endpoint answers the same whether or not the address has an account, so neither reveals who has one. The preview endpoint takes the token in a POST body so it never reaches an access log.

Rejected: adding an existing account at once (skips consent and tells the inviter who has an account), a link not bound to an email (a forwarded or leaked link would let anyone in), storing the raw token (a database read would hand out workspaces), and an invite that is accepted by any signed-in User holding the link.
