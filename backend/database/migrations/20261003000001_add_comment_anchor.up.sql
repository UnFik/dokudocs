-- A comment in the live editor is anchored by Yjs relative positions, which
-- follow the text as it moves. The older block and position columns stay for
-- threads made before that.
ALTER TABLE comment_threads
    ADD COLUMN anchor JSONB;
