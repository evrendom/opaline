CREATE OR REPLACE FUNCTION enforce_free_workspace_agent_run_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	usage_count integer;
	usage_month date := date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
BEGIN
	IF current_setting('opaline.self_hosted', true) = 'on' THEN
		RETURN NEW;
	END IF;
	PERFORM pg_advisory_xact_lock(731826, hashtext(NEW.organization_id));
	IF EXISTS (
		SELECT 1
		FROM session_ownership
		WHERE organization_id = NEW.organization_id
			AND session_id = NEW.session_id
	) THEN
		RETURN NEW;
	END IF;
	IF EXISTS (
		SELECT 1
		FROM billing_subscription
		WHERE organization_id = NEW.organization_id
			AND status IN ('active', 'trialing', 'past_due')
	) THEN
		RETURN NEW;
	END IF;
	INSERT INTO organization_monthly_usage (
		organization_id, month_start, agent_runs, updated_at
	) VALUES (
		NEW.organization_id, usage_month, 1, NOW()
	)
	ON CONFLICT (organization_id, month_start) DO UPDATE
	SET agent_runs = organization_monthly_usage.agent_runs + 1,
		updated_at = NOW()
	WHERE organization_monthly_usage.agent_runs < 50000
	RETURNING agent_runs INTO usage_count;
	IF usage_count IS NULL THEN
		RAISE EXCEPTION 'Free workspaces support up to 50000 agent runs per month'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
