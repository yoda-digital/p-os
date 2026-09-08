-- Migration 005: Managed Execution (SP3)
-- Extends the attempts table with columns needed for Claude CLI session tracking
-- and execution plan persistence.

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS claude_job_id TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS working_directory TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS worktree_path TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS execution_plan JSONB;

-- Index on claude_job_id for session recovery lookups
CREATE INDEX IF NOT EXISTS idx_attempts_claude_job_id ON attempts (claude_job_id) WHERE claude_job_id IS NOT NULL;

-- Index on active execution state for fast "what's running" queries
CREATE INDEX IF NOT EXISTS idx_attempts_active_execution ON attempts (move_id, state) WHERE state IN ('queued', 'starting', 'running');

COMMENT ON COLUMN attempts.claude_job_id IS 'The background job ID returned by claude --bg, used for stop/respawn';
COMMENT ON COLUMN attempts.working_directory IS 'Filesystem path where the Claude session is running';
COMMENT ON COLUMN attempts.worktree_path IS 'Git worktree path if isolation=worktree was used';
COMMENT ON COLUMN attempts.model_used IS 'The Claude model used for this attempt (e.g. claude-sonnet-5)';
COMMENT ON COLUMN attempts.execution_plan IS 'Full ExecutionPlan JSON that the compiler produced';
