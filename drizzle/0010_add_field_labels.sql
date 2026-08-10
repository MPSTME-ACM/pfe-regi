ALTER TABLE "settings" ALTER COLUMN "field_options" SET DEFAULT '{"colleges":["NMIMS MPSTME","Other"],"courses":["BTI","BTech","MBA Tech","Other"],"departments":["Computer Engineering","EXTC","Cybersecurity","AI","CSDS 311","Data Science","Mechanical","IT","Civil","CSBS","Mechatronics","CSEDS","Other"],"years":["First Year","Second Year","Third Year","Fourth Year","Fifth Year","Sixth Year"]}'::jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "field_labels" jsonb DEFAULT '{"name":{"label":"Your Name","placeholder":"Parth Gupta"},"email":{"label":"Your Email","placeholder":"mail@parthg.me"},"contact":{"label":"Contact Number","placeholder":"9406084060"},"college":{"label":"College","placeholder":"Select your option"},"course":{"label":"Course","placeholder":"B.Tech","selectPrompt":"Select your option"},"department":{"label":"Department","placeholder":"Computer Science","selectPrompt":"Select your option"},"year":{"label":"Current Academic Year","placeholder":"Select your option"},"referral":{"label":"Referral","placeholder":"Optional"}}'::jsonb NOT NULL;--> statement-breakpoint
-- The two ALTERs above only change DEFAULTS, which apply to rows inserted from
-- now on. `settings` is a singleton that already exists, so its `years` list is
-- untouched by them and "Sixth Year" would never appear on the live form.
-- Guarded by a containment check so re-running is a no-op.
UPDATE "settings"
SET "field_options" = jsonb_set(
      "field_options",
      '{years}',
      ("field_options" -> 'years') || '["Sixth Year"]'::jsonb
    )
WHERE "id" = 1
  AND NOT ("field_options" -> 'years' @> '["Sixth Year"]'::jsonb);