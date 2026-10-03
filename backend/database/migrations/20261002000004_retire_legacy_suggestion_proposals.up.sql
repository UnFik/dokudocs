UPDATE document_suggestions
SET status = 'rejected',
    decider_id = proposer_id,
    decided_at = COALESCE(decided_at, NOW()),
    conflict_reason = 'Legacy REST suggestions are retired; recreate this change by typing in Suggest mode.'
WHERE status = 'pending'
  AND CASE
        WHEN jsonb_typeof(operations) = 'array' THEN jsonb_array_length(operations) > 0
        ELSE FALSE
      END;
