-- MIGRATION: analyst note now records the ORCHESTRATOR's verdict
--
-- Layer 7 used to be handed the legacy -10..+10 quick score, so the saved
-- research note recorded fundamental_score / fundamental_bias. It is now
-- handed the orchestrator's UsdFundamentalAssessment, whose verdict is a
-- condition label (Strong | Moderate | Neutral | Weak) plus a confidence
-- level and the named decision rule that produced it.
--
-- Run in Supabase -> SQL Editor after docs/migration_ai_analyst.sql.

alter table analyst_assessments
  add column if not exists overall_condition text,
  add column if not exists overall_confidence text,
  add column if not exists decision_rule text,
  add column if not exists sources_used text[];

comment on column analyst_assessments.overall_condition is
  'Overall USD Fundamental Condition from orchestrator.ts. This, not fundamental_score, is the authoritative verdict.';
comment on column analyst_assessments.decision_rule is
  'Which of the four named orchestration rules fired, in plain words.';

-- The legacy columns are kept so existing rows stay readable, but they are
-- no longer written and must be nullable.
alter table analyst_assessments alter column fundamental_score drop not null;
alter table analyst_assessments alter column fundamental_bias drop not null;
