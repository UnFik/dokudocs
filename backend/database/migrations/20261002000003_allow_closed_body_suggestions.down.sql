UPDATE document_suggestions
SET status = 'rejected'
WHERE status = 'closed';

ALTER TABLE document_suggestions
    DROP CONSTRAINT document_suggestions_status_valid;

ALTER TABLE document_suggestions
    ADD CONSTRAINT document_suggestions_status_valid
    CHECK (status IN ('pending', 'accepted', 'rejected', 'conflicted'));
