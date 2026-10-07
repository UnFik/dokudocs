-- The AST rows are not rebuilt: this migration only goes forward.
DO $$ BEGIN RAISE EXCEPTION 'drop_ast_collaboration cannot be reversed'; END $$;
