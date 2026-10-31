# Free cloud dashboard: external scheduler + Actions + Pages

[简体中文](CLOUD_DEPLOY.zh-CN.md) | **English (default)** · [README](../README.md)

## Structure

- `main`: source, layout, configuration templates, and tests.
- `runtime-data`: separate quota input branch, with `quotas.json` at its root; it does not trigger source CI.
- Pages artifacts: `screen.png`, `status.json`, and the status page, without committing generated output to source.
- Raw dashboard JSON is used during generation and is not published.

The old `gh-pages` branch remains for migration rollback; the new pipeline does not commit to it. Separate branches are still part of the same repository, with the same visibility.

## External trigger

Create a cron-job.org job:

- Name: DayPane half-hour render
- URL: `https://api.github.com/repos/shenliucn-prog/daypane/actions/workflows/render.yml/dispatches`
- Method: POST
- Body: `{"ref":"main"}`
- Schedule: minute 25 and 55 of every hour, leaving time for generation before Kindle refresh at :00 and :30. The configured job uses America/Los_Angeles; these minute positions also match UTC.
- Headers: `Accept: application/vnd.github+json`, `Content-Type: application/json`, and `Authorization: Bearer <dedicated-token>`.

Use a fine-grained GitHub token restricted to `daypane`, with Actions write permission and required Metadata read access. Set an expiry and renew it before that date. Store the credential only in the scheduler's authentication header, never in the URL or Git. Do not give the scheduler an existing account-wide token.

An accepted dispatch is not proof of a successful image deployment. The scheduler returns quickly; inspect Actions for generation and deployment results.

GitHub's :17 and :47 schedule is a backup. `cancel-in-progress: true` is **required**, not a style choice: a run stuck in the Pages deploy queue (observed 2026-10-05, five days of dead renders) is cancelled by the next trigger instead of blocking every later render. With `false`, one stuck run holds the queue head and every later run only goes pending-then-cancelled — the pipeline stalls with no reported failure. External scheduling cannot guarantee immediate runner availability.

## Pages

In Settings → Pages, select GitHub Actions as the source. The workflow uses upload-pages-artifact and deploy-pages.

- Image: `https://shenliucn-prog.github.io/daypane/screen.png`
- Status page: `https://shenliucn-prog.github.io/daypane/`
- Machine status: `https://shenliucn-prog.github.io/daypane/status.json`

Each run reads the previous image and checksum. If all public providers fail, fonts are unavailable, or rendering fails, it retains the last good image and publishes failure status where possible. An earlier failure, such as dependency installation, produces no deployment and leaves existing Pages content intact. The status page computes age from generation time and marks images older than 45 minutes as stale.

`status.json` retains the latest 256 generation results, timestamps, run IDs, and trigger types. Exact dispatch, queue, and deployment times come from GitHub run/job metadata. Do not treat dispatch acceptance as deployment completion.

## English and Chinese output

Each run collects data once and renders both languages. `screen.png` and the root preview remain Chinese for existing devices. `screen-en.png` is the English image, with preview and independent status history under `en/`. Failures retain each locale's previous good image where available; an initial failure without a previous image prevents deployment.

The repository's default documentation is English. Runtime language is selected separately in the plugin's **Language / 语言** menu. English news comes from HN, while Chinese news sources remain unchanged. Custom display labels may need English values; they are not automatically translated.

## Local reporter

The reporter is part of the dashboard service, not a second background process: whenever the service renders a screen it uploads a throttled snapshot, so uploads happen only while the board (and WorkBuddy) is actually in use. If you previously registered `DayPaneQuotaReporter.vbs` in your startup folder, delete it — the service's own startup entry is enough. The manual `report_quota.bat` remains for one-off pushes.

Update the reporter and change `GITHUB_BRANCH=main` to `GITHUB_BRANCH=runtime-data` in your private configuration. The default remote path is now `quotas.json`. Secrets are re-read from `tools/report_secrets.bat` on every attempt, so editing it does not require restarting the service.

Local files live under `SHAWN_DATA_DIR`, defaulting to `~/.local/share/shawn-kanban/`. Successful-upload state is separate from collection state; a failed upload remains eligible for retry, backing off from 10 up to 30 minutes. Background runs never touch git credentials, so an expired token produces a log line instead of a prompt; only `report_quota.bat --force` is allowed to fall back to `git push`.

The WorkBuddy block is fed by the last uploaded snapshot. Its three rows are Context (used/context window — it drops when WorkBuddy auto-compacts and resets on a new session, so it is a watermark, not a balance), Spent (cumulative `credit_json`, monotonic) and 7d activity. None of them is an authoritative account quota. Do not include sensitive task text in runtime input: `runtime-data` is public, like this repository.

## 48-hour validation

Starting when the external job is enabled, check request acceptance, Actions execution, Pages deployment, and whether image age exceeds 45 minutes. Successful backup cron runs alone do not validate the external scheduler. Kindle sleep/resume requires separate device testing.
