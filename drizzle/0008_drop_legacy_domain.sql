-- `domain` was the 2025 single-track column. Every row that had one is already
-- copied into pferegistration_2025 by migration 0007. Split from 0007 so that
-- migration has no simultaneous add+drop on this table — drizzle-kit would ask
-- "created or renamed?" interactively, which cannot be answered in CI.
ALTER TABLE "pferegistration" DROP COLUMN "domain";
--> statement-breakpoint
-- Seed the seven 2026 tracks. ON CONFLICT so re-running is harmless.
INSERT INTO "tracks" ("slug", "name", "segment", "dates", "capacity", "sort_order") VALUES
	('c',            'C Programming',  'beginner', '["2026-09-17","2026-09-18"]', 120, 1),
	('python',       'Python',         'beginner', '["2026-09-17","2026-09-18"]', 120, 2),
	('web',          'Web Development','beginner', '["2026-09-17","2026-09-18"]', 120, 3),
	('dsa',          'DSA',            'advanced', '["2026-09-21","2026-09-22"]', 120, 4),
	('ai',           'AI',             'advanced', '["2026-09-21","2026-09-22"]', 120, 5),
	('cybersecurity','Cybersecurity',  'advanced', '["2026-09-21","2026-09-22"]', 120, 6),
	('capstone',     'Capstone Day',   'capstone', '["2026-09-23"]',              250, 7)
ON CONFLICT ("slug") DO NOTHING;