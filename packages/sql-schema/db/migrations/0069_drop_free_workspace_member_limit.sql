-- Every plan, Free included, now has unlimited members.
DROP TRIGGER IF EXISTS member_free_workspace_limit ON member;--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_free_workspace_member_limit();
