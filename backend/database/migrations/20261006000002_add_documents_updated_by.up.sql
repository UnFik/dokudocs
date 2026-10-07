-- The person whose edit was stored last, shown under the title.
ALTER TABLE documents ADD COLUMN updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
