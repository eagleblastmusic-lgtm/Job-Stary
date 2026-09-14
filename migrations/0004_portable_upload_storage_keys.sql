-- Persist upload references independently of the host filesystem root.
-- First normalize legacy Windows separators, then strip any absolute prefix
-- before the private uploads directory. Existing portable keys remain intact.
UPDATE uploaded_files
SET storage_key = replace(storage_key, char(92), '/')
WHERE instr(storage_key, char(92)) > 0;

UPDATE uploaded_files
SET storage_key = 'uploads/' || substr(
  storage_key,
  instr(storage_key, '/uploads/') + length('/uploads/')
)
WHERE instr(storage_key, '/uploads/') > 0;
