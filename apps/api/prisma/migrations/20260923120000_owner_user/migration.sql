-- Vor der Mandantentrennung lagen alle Reisepläne aller Besucher unter dem
-- gemeinsamen Nutzer guest@local.dev. Die Pläne gehen an den Besitzer
-- (Login mit AUTH_USERNAME, auch vom MCP-Server genutzt), neue Gäste sehen
-- sie nicht mehr.
UPDATE "User" SET "email" = 'owner@local.dev' WHERE "email" = 'guest@local.dev';
