UPDATE document_suggestions
SET status = 'pending',
    decider_id = NULL,
    decided_at = NULL,
    conflict_reason = ''
WHERE status = 'rejected'
  AND conflict_reason = 'Legacy REST suggestions are retired; recreate this change by typing in Suggest mode.'
  AND CASE
        WHEN jsonb_typeof(operations) = 'array' THEN jsonb_array_length(operations) > 0
        ELSE FALSE
      END;
