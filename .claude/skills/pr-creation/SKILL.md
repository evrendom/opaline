---
name: pr-creation
description: Use when creating a pull request. Runs verification, reviews changes, and creates the PR with correct metadata. Invoke BEFORE pushing code.
allowed-tools: [Read, Edit, Write, Bash, Glob, Grep]
metadata:
  internal: true
---

# PR Creation Checklist

Follow these steps in order when creating a pull request. Do not skip any step.

## 1. Run Verification

```bash
bun run verify
```

This runs type checking, linting, and tests across the monorepo.

**Do NOT proceed if verification fails.** Fix issues first, then re-run.

## 2. Review the Workspace Diff

Run `git diff --stat origin/main...HEAD` to see all changed files, then review the full diff (`git diff origin/main...HEAD`) to understand the scope of changes.

## 3. Commit All Changes

Stage and commit all changes. Follow any user instructions about commit message style.

## 4. Push and Create PR

1. Push to origin with `-u` flag if the branch has no upstream
2. PR title **must** use conventional commit format (enforced by CI):
   `feat:` | `fix:` | `docs:` | `style:` | `refactor:` | `perf:` | `test:` | `build:` | `ci:` | `chore:` | `revert:`
3. Use `gh pr create --base main` with:
   - Title under 80 characters
   - Description covering ALL changes in the workspace diff (not just the latest commit)
   - Keep description concise

```bash
gh pr create --base main --title "title here" --body "$(cat <<'EOF'
## Summary
- bullet points describing changes

## Test plan
- [ ] testing steps

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Common Mistakes to Avoid

- **Skipping verification**: Step 1 is non-negotiable. CI will catch the same failures but slower.
- **Wrong PR title format**: Must be conventional commit format or CI will reject it.
- **Describing only the latest commit**: The PR description should cover the entire branch diff.
