-- Run against the production schema as an administrator. All probe writes roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE evryvibe;
DO $$
DECLARE probe_id uuid;
BEGIN
 INSERT INTO public.djs(slug,name,description,genres)
 VALUES ('permission-probe-' || gen_random_uuid(), 'Permission probe', '', '[]'::jsonb)
 RETURNING id INTO probe_id;
 UPDATE public.djs SET description='Permission check' WHERE id=probe_id;
 BEGIN
  INSERT INTO public.djs(slug,name,description,genres)
  VALUES ('kaliiraa', 'Permission probe', '', '[]'::jsonb);
  RAISE EXCEPTION 'Takedown protection did not reject recreation';
 EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'Normal insert/update succeeded; takedown recreation rejected';
 END;
END $$;
ROLLBACK;
