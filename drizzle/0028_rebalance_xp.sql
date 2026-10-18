-- v1.1: steeper level curve. Every player keeps their level and the share of the way to the next one;
-- the XP is restated on the new curve (1000 * (level - 1) ^ 2.2 instead of 800 * (level - 1) ^ 1.7).
UPDATE "users" SET "xp" = round(
  1000 * power(greatest("level" - 1, 0), 2.2)
  + least(1, greatest(0, ("xp" - 800 * power(greatest("level" - 1, 0), 1.7)) / nullif(800 * power("level", 1.7) - 800 * power(greatest("level" - 1, 0), 1.7), 0)))
    * (1000 * power("level", 2.2) - 1000 * power(greatest("level" - 1, 0), 2.2))
)::int
WHERE "xp" > 0;
