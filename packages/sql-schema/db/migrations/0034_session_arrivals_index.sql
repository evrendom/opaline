CREATE INDEX "session_ownership_arrivals_idx" ON "session_ownership" USING btree ("organization_id","created_at");
