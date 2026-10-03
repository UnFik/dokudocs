-- When a comment or reply was last edited by its author; null if it never was.
-- updated_at also moves on a reply or a resolve, so it cannot say this.
ALTER TABLE comment_threads ADD COLUMN edited_at TIMESTAMPTZ;
ALTER TABLE comment_replies ADD COLUMN edited_at TIMESTAMPTZ;
