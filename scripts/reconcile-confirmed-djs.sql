-- Run with ON_ERROR_STOP. All pairs are committed together under the publication lock.
BEGIN;
SELECT pg_advisory_xact_lock(7349501);
CREATE TEMP TABLE merge_plan (old_slug text PRIMARY KEY, canonical_slug text NOT NULL, evidence text NOT NULL) ON COMMIT DROP;
INSERT INTO merge_plan VALUES
 ('ornella','ornella-luz','Reconciliation ledger: Ornella Luz; RA artist profile and official promoter tag @ornella_luz.'),
 ('2groove','dasstudach','Reconciliation ledger: official GOTEC post De4MIbHCH4x bills 2GROOVE AKA DASSTUDACH.'),
 ('lizzle','lizzlbeth','Reconciliation ledger: RA artist profile links @lizzlbeth; LoveSelectors event 2434007 links the aliases.'),
 ('nerduzt','verduzt','Reconciliation ledger: Verduzt in Dresden Lust & Laune and Sektor Evolution context; canonical @verduzt.'),
 ('sonic-kowalski','sonic-rush-hour','Reconciliation ledger: both nodes created for the same Kowalski Rush Hour billing on 2 October 2026.'),
 ('broccoli','ilbroccolovolante','Reconciliation ledger: venue and artist sources identify Broccoli as Lara Orrico, alias ilbroccolovolante.');
DO $$
DECLARE pair record; source djs%ROWTYPE; target djs%ROWTYPE; old_task reconciliation_tasks%ROWTYPE; target_task reconciliation_tasks%ROWTYPE; saved jsonb;
BEGIN
 FOR pair IN SELECT * FROM merge_plan ORDER BY old_slug LOOP
  SELECT * INTO source FROM djs WHERE slug=pair.old_slug FOR UPDATE;
  SELECT * INTO target FROM djs WHERE slug=pair.canonical_slug FOR UPDATE;
  IF source.id IS NULL OR target.id IS NULL OR source.id=target.id THEN
   RAISE EXCEPTION 'Missing or invalid pair % -> %', pair.old_slug, pair.canonical_slug;
  END IF;
  PERFORM 1 FROM reconciliation_tasks WHERE dj_id IN (source.id,target.id) FOR UPDATE;
  IF EXISTS (SELECT 1 FROM reconciliation_tasks WHERE dj_id IN (source.id,target.id) AND state='processing') THEN
   RAISE EXCEPTION 'Active reconciliation task for %', pair.old_slug;
  END IF;
  IF source.instagram_url IS NOT NULL OR source.soundcloud_url IS NOT NULL THEN
   RAISE EXCEPTION 'Source % has a social profile; review ownership before merging', pair.old_slug;
  END IF;
  IF EXISTS (SELECT 1 FROM dj_aliases WHERE slug IN (pair.old_slug,pair.canonical_slug)) THEN
   RAISE EXCEPTION 'Alias already exists for %', pair.old_slug;
  END IF;
  SELECT jsonb_build_object('dj',to_jsonb(source), 'target_dj',to_jsonb(target), 'tasks',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM reconciliation_tasks t WHERE t.dj_id=source.id),'[]'::jsonb), 'lineups',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM event_djs e WHERE e.dj_id=source.id),'[]'::jsonb), 'target_tasks',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM reconciliation_tasks t WHERE t.dj_id=target.id),'[]'::jsonb)) INTO saved;
  INSERT INTO dj_aliases(slug,dj_id,evidence,snapshot) VALUES(pair.old_slug,target.id,pair.evidence,saved);
  UPDATE dj_aliases SET dj_id=target.id WHERE dj_id=source.id;
  INSERT INTO event_djs(event_id,dj_id,position)
   SELECT event_id,target.id,position FROM event_djs WHERE dj_id=source.id
   ON CONFLICT(event_id,dj_id) DO UPDATE SET position=LEAST(event_djs.position,excluded.position);
  DELETE FROM event_djs WHERE dj_id=source.id;
  SELECT * INTO old_task FROM reconciliation_tasks WHERE dj_id=source.id AND state<>'done';
  SELECT * INTO target_task FROM reconciliation_tasks WHERE dj_id=target.id AND state<>'done';
  IF old_task.id IS NOT NULL AND target_task.id IS NOT NULL THEN
   UPDATE reconciliation_tasks SET checks=(SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM jsonb_array_elements(target_task.checks || old_task.checks) v),
    reason=concat_ws(E'\n',reason,'Merged from ' || pair.old_slug || ': ' || coalesce(old_task.reason,'')),
    priority=GREATEST(priority,old_task.priority), updated_at=now() WHERE id=target_task.id;
   DELETE FROM reconciliation_tasks WHERE id=old_task.id;
  END IF;
  UPDATE reconciliation_tasks SET dj_id=target.id WHERE dj_id=source.id;
  -- The flag in these six reviewed pairs was the duplicate itself. Preserve
  -- unrelated profile checks and archive the original task snapshots above.
  UPDATE reconciliation_tasks SET checks=checks - 'flagged',
   state=CASE WHEN jsonb_array_length(checks - 'flagged')=0 THEN 'done' ELSE 'pending' END,
   completed_token=CASE WHEN jsonb_array_length(checks - 'flagged')=0 THEN gen_random_uuid() ELSE NULL END,
   completed_at=CASE WHEN jsonb_array_length(checks - 'flagged')=0 THEN now() ELSE NULL END,
   outcome=CASE WHEN jsonb_array_length(checks - 'flagged')=0 THEN jsonb_build_object('description','kept','soundcloud','unchanged','basis',pair.evidence,'changed','[]'::jsonb) ELSE NULL END,
   reason='Identity merged: ' || pair.old_slug || ' → ' || pair.canonical_slug || '. Remaining profile checks, if any, need review.',
   last_reason=NULL, attempts=0, updated_at=now()
   WHERE dj_id=target.id AND state<>'done' AND checks ? 'flagged';
  UPDATE djs SET genres=(SELECT COALESCE(jsonb_agg(DISTINCT v),'[]'::jsonb) FROM jsonb_array_elements(target.genres || source.genres) v),
   description=CASE WHEN target.description='' THEN source.description ELSE target.description END,
   instagram_url=COALESCE(target.instagram_url,source.instagram_url),
   soundcloud_url=COALESCE(target.soundcloud_url,source.soundcloud_url),
   website_url=COALESCE(target.website_url,source.website_url),
   sample_post_url=COALESCE(target.sample_post_url,source.sample_post_url)
   WHERE id=target.id;
  DELETE FROM djs WHERE id=source.id;
  RAISE NOTICE 'Merged % into %', pair.old_slug, pair.canonical_slug;
 END LOOP;
END $$;
COMMIT;
