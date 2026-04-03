-- ═══════════════════════════════════════════════════════════════════════════════
-- Add sanctioning_body to events and races, populate from series mapping,
-- merge split event rows for same-weekend multi-series SRO events.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Add nullable column
ALTER TABLE public.events ADD COLUMN sanctioning_body TEXT;
ALTER TABLE public.races ADD COLUMN sanctioning_body TEXT;

-- Step 2: Populate from series mapping
UPDATE public.events SET sanctioning_body = CASE
  WHEN series IN ('SRO', 'GR_CUP', 'GTWC') THEN 'SRO'
  WHEN series IN ('IMSA', 'Whelen Mazda MX-5 Cup presented by Michelin') THEN 'IMSA'
  WHEN series = 'WRL' THEN 'WRL'
  ELSE 'SRO'
END;

UPDATE public.races SET sanctioning_body = CASE
  WHEN series IN ('SRO', 'GR_CUP', 'GTWC',
    'Lamborghini Super Trofeo', 'Mustang Challenge North America',
    'Porsche Carrera Cup North America') THEN 'SRO'
  WHEN series IN ('IMSA', 'Whelen Mazda MX-5 Cup presented by Michelin') THEN 'IMSA'
  WHEN series = 'WRL' THEN 'WRL'
  ELSE 'SRO'
END;

-- Step 3: Make non-nullable with default
ALTER TABLE public.events ALTER COLUMN sanctioning_body SET NOT NULL;
ALTER TABLE public.events ALTER COLUMN sanctioning_body SET DEFAULT 'SRO';
ALTER TABLE public.races ALTER COLUMN sanctioning_body SET NOT NULL;
ALTER TABLE public.races ALTER COLUMN sanctioning_body SET DEFAULT 'SRO';

-- Step 4: Indexes for filter queries
CREATE INDEX events_sanctioning_body_idx ON public.events(sanctioning_body);
CREATE INDEX races_sanctioning_body_idx ON public.races(sanctioning_body);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 5: Merge split event rows — re-parent races and qualifying_sessions,
-- then delete the duplicate event.
-- ═══════════════════════════════════════════════════════════════════════════════

-- SPLIT #1 — Sonoma 2026: three empty event shells (0 races each)
DELETE FROM events WHERE id IN (
  'cmni66g3z01gcow0piw5kn9k1',
  'cmni66eoz000mow0pw3o0c4c9',
  'cmn9y7sso001unw0pph3ahgmd'
);

-- SPLIT #2 — St. Petersburg 2026
-- Primary: cmmhtffhb0003tnjg5go2bdz8 (Whelen MX-5, 2 races)
-- Duplicate: cmmifowp10u4vtnu0bhgsspem (IMSA, 0 races)
UPDATE races SET event_id = 'cmmhtffhb0003tnjg5go2bdz8' WHERE event_id = 'cmmifowp10u4vtnu0bhgsspem';
UPDATE qualifying_sessions SET event_id = 'cmmhtffhb0003tnjg5go2bdz8' WHERE event_id = 'cmmifowp10u4vtnu0bhgsspem';
DELETE FROM events WHERE id = 'cmmifowp10u4vtnu0bhgsspem';

-- SPLIT #3 — Indianapolis 2025
-- Primary: cmmhxnxgo05dsqt0pdpjzxw25 (SRO, 2 races)
-- Duplicate: cmmhxnukv04vrqt0p3amo6u9v (GR_CUP, 2 races)
UPDATE races SET event_id = 'cmmhxnxgo05dsqt0pdpjzxw25' WHERE event_id = 'cmmhxnukv04vrqt0p3amo6u9v';
UPDATE qualifying_sessions SET event_id = 'cmmhxnxgo05dsqt0pdpjzxw25' WHERE event_id = 'cmmhxnukv04vrqt0p3amo6u9v';
DELETE FROM events WHERE id = 'cmmhxnukv04vrqt0p3amo6u9v';

-- SPLIT #4 — Barber Sep 2025
-- Primary: cmmhxnu2f049lqt0p8x4i7nkh (SRO, 3 races)
-- Duplicate: cmmhxntkr03srqt0piom0am80 (GR_CUP, 2 races)
UPDATE races SET event_id = 'cmmhxnu2f049lqt0p8x4i7nkh' WHERE event_id = 'cmmhxntkr03srqt0piom0am80';
UPDATE qualifying_sessions SET event_id = 'cmmhxnu2f049lqt0p8x4i7nkh' WHERE event_id = 'cmmhxntkr03srqt0piom0am80';
DELETE FROM events WHERE id = 'cmmhxntkr03srqt0piom0am80';

-- SPLIT #5 — Road America 2025
-- Primary: cmmhxo1ll09vtqt0p2gztb0m8 (GR_CUP, 2 races)
-- Duplicate: cmmhxo7t10cveqt0p2b6wa7l5 (SRO, 1 race)
UPDATE races SET event_id = 'cmmhxo1ll09vtqt0p2gztb0m8' WHERE event_id = 'cmmhxo7t10cveqt0p2b6wa7l5';
UPDATE qualifying_sessions SET event_id = 'cmmhxo1ll09vtqt0p2gztb0m8' WHERE event_id = 'cmmhxo7t10cveqt0p2b6wa7l5';
DELETE FROM events WHERE id = 'cmmhxo7t10cveqt0p2b6wa7l5';

-- SPLIT #6 — VIR 2025
-- Primary: cmmhxo17g09jiqt0pz7y0lb58 (GR_CUP, 2 races)
-- Duplicate: cmmhxo5ix0c57qt0pgr0wkk1x (SRO, 2 races)
UPDATE races SET event_id = 'cmmhxo17g09jiqt0pz7y0lb58' WHERE event_id = 'cmmhxo5ix0c57qt0pgr0wkk1x';
UPDATE qualifying_sessions SET event_id = 'cmmhxo17g09jiqt0pz7y0lb58' WHERE event_id = 'cmmhxo5ix0c57qt0pgr0wkk1x';
DELETE FROM events WHERE id = 'cmmhxo5ix0c57qt0pgr0wkk1x';

-- SPLIT #7 — Sebring May 2025
-- Primary: cmmhxns5i02e1qt0poi8dj9sk (SRO, 2 races)
-- Duplicate: cmmhxnq9600e0qt0po89j7kzg (GR_CUP, 2 races)
UPDATE races SET event_id = 'cmmhxns5i02e1qt0poi8dj9sk' WHERE event_id = 'cmmhxnq9600e0qt0po89j7kzg';
UPDATE qualifying_sessions SET event_id = 'cmmhxns5i02e1qt0poi8dj9sk' WHERE event_id = 'cmmhxnq9600e0qt0po89j7kzg';
DELETE FROM events WHERE id = 'cmmhxnq9600e0qt0po89j7kzg';

-- SPLIT #8 — COTA Apr 2025
-- Primary: cmmhxnp4q0000qt0pac88habk (GR_CUP, 2 races)
-- Duplicate: cmmhxnrak00zuqt0p63bcavwj (SRO, 1 race)
UPDATE races SET event_id = 'cmmhxnp4q0000qt0pac88habk' WHERE event_id = 'cmmhxnrak00zuqt0p63bcavwj';
UPDATE qualifying_sessions SET event_id = 'cmmhxnp4q0000qt0pac88habk' WHERE event_id = 'cmmhxnrak00zuqt0p63bcavwj';
DELETE FROM events WHERE id = 'cmmhxnrak00zuqt0p63bcavwj';

-- SPLIT #9 — Barber Feb 2025 (WRL-WRL duplicate)
-- Primary: cmmbhhcck000ctnikxfkes2up (WRL, 1 race)
-- Duplicate: cmmhtffx90004tnjgw8g3z786 (WRL, 1 race)
UPDATE races SET event_id = 'cmmbhhcck000ctnikxfkes2up' WHERE event_id = 'cmmhtffx90004tnjgw8g3z786';
UPDATE qualifying_sessions SET event_id = 'cmmbhhcck000ctnikxfkes2up' WHERE event_id = 'cmmhtffx90004tnjgw8g3z786';
DELETE FROM events WHERE id = 'cmmhtffx90004tnjgw8g3z786';

-- Step 6: RLS policy for new column (consistent with existing public read policy)
-- No separate policy needed — the existing events_select_published policy uses
-- status = 'PUBLISHED' which already covers all columns including sanctioning_body.
