-- Multi-club host venues (e.g. ladder tournaments across several clubs).
-- club_id remains the primary venue for legacy joins; club_ids lists all when set.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS club_ids uuid[] DEFAULT NULL;

COMMENT ON COLUMN tournaments.club_ids IS 'Optional list of host club UUIDs. When NULL, only club_id applies. First element should match club_id when both are set.';
