# Agent traces hold metadata, never conversation content

A Superadmin can follow each Agent request through the decision graph on the Conversations page: which places it passed, how often it went around, how long each step took, how many tokens it used and where it stopped. A trace is made of codes, counts and names only. It never holds what a User wrote, what the Agent answered, a document's text, or a tool's arguments or result.

This is enforced by shape, not by care: a recorded step has no field that can hold text, a reason is kept only if it is a short code, and the tests check that a question and an answer never appear in a stored trace or in the API's responses. A person who needs to understand a request reads its path and numbers; the words stay with the User, whose Conversation is private (ADR-0043).

A trace has its own life. It is kept for the days the Superadmin sets (30 by default) even after the run's draft and result are gone, and it is deleted with the User or workspace it belongs to. The entry gate and the model router that appear in the graph can be switched off from the same page without a deploy; if the switches cannot be read, they stay off so no request waits on them.

Showing content to a Superadmin, even with a reason and an audit entry, was considered and left out. It can be added later as a separate, audited action; it must not be added to traces.
