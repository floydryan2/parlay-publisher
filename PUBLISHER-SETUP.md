# Automatic publisher (set up once, about 10 minutes)

This replaces pressing **Publish rankings** by hand. A scheduled job on GitHub opens your site in a headless
browser as the owner and runs the exact same publish your phone runs, so the research and scores match.

- **Full run** (once a day): pulls every line, researches every player and defense, publishes.
- **Odds run** (4 times a day): pulls fresh lines, keeps the published research, publishes.

Users never research anything: they just load what is published. Everything below is done from your phone or a computer.

## 1. Update the site first
Deploy the v135 `The-Parlay-Plug.zip` to Cloudflare Pages like you always do (it adds the bot mode the job needs).
Check **Settings → app version** shows v135.

## 2. Make a GitHub repo
1. Sign in at github.com (free account is fine) and tap **New repository**.
2. Name it `parlay-publisher`. Choose **Public** (public repos get unlimited free Actions minutes; there are no keys in
   the code, the secrets live in GitHub's secret storage). A private repo works too but the free 2,000 minutes a month
   may run out.
3. Upload everything inside `parlay-publisher.zip`, keeping the folder structure, especially `.github/workflows/publish.yml`.
   On GitHub: **Add file → Upload files**, drag in the unzipped contents (a computer makes this easier because the hidden
   `.github` folder must come along).

## 3. Add two secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `SITE_URL` = your site address, e.g. `https://theparlayplug.pages.dev` (no slash at the end)
- `ADMIN_CODE` = the same admin code you set in Cloudflare (the `ADMIN_CODE` variable)

## 4. Turn it on and test
1. Repo → **Actions** tab → if asked, tap **I understand my workflows, enable them**.
2. Open **Publish rankings** → **Run workflow** → mode **odds** first (it is quick), then **Run workflow**.
   If no slate exists yet, choose **full** instead.
3. Watch the log. Success ends with `Result: done. Published ...`.
4. Open the app on any account and tap Run scan: the banner shows the new publish time.

## Schedule
Edit `.github/workflows/publish.yml`. Times are UTC (11:00 UTC is 7am ET during daylight time, 6am ET otherwise).
The full run is the `0 11 * * *` line, the odds runs are `0 15,19,23,3 * * *`. GitHub can start a run 5 to 20 minutes late.

## Costs to know about
- Each run spends your Odds API credits (the full run and every odds run both pull every game's props). Four odds runs a day
  plus one full run is the default. If credits run low, delete times from the odds line.
- The full run uses AI/search tokens the same way the Publish button does. Research is cached on the server, so a second
  full run the same day is cheap.

## Good to know
- Public repos pause scheduled runs after 60 days with no repo activity. If rankings stop updating, open Actions and press
  **Enable workflow**.
- A failed run shows red in Actions and emails you. The most common cause is a wrong `ADMIN_CODE` or `SITE_URL` secret.
- You can still press **Publish rankings** in the app any time. A manual publish and the job never conflict:
  the newest one wins.
