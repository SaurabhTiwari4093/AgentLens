-- Partition management. A daily job calls ensure_span_partitions() to pre-create
-- the next N days of partitions. We create a safety margin (call with 3) so a
-- single missed run doesn't cause a midnight write failure; the DEFAULT partition
-- is the final backstop.

CREATE OR REPLACE FUNCTION ensure_span_partition(target_day DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  part_name TEXT := 'spans_' || to_char(target_day, 'YYYYMMDD');
  start_ts  TIMESTAMPTZ := target_day::timestamptz;
  end_ts    TIMESTAMPTZ := (target_day + 1)::timestamptz;
BEGIN
  IF to_regclass(part_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF spans FOR VALUES FROM (%L) TO (%L)',
      part_name, start_ts, end_ts
    );
  END IF;
END;
$$;

-- Pre-create today through today+days_ahead (inclusive).
CREATE OR REPLACE FUNCTION ensure_span_partitions(days_ahead INTEGER DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  d INTEGER;
BEGIN
  FOR d IN 0..days_ahead LOOP
    PERFORM ensure_span_partition((now()::date + d));
  END LOOP;
END;
$$;
