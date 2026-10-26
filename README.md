# MGH Energy Control

The daily energy round, AC control log and energy performance dashboard for Manhattan Grand Hotel, ready to deploy on Vercel.

| Page | Address | Who uses it |
|---|---|---|
| Home | `/` | Everyone |
| Daily energy round | `/energy-round` | Engineering (meter 08:00, rounds 12:00 and 19:00), Security (12:30, 19:30), Duty Manager (23:30) |
| AC control log | `/ac-control` | AC technician (09:00 round, lobby log until sunset), Chief Engineer (18:30 review) |
| Performance | `/performance` | Management: electricity used and check results by week, month and year |

## Deploy (about 10 minutes)

1. **Put the folder on GitHub.** Create a new private repository and upload everything in this folder. (Or run `vercel` from this folder with the Vercel CLI and skip step 2.)
2. **Import it into Vercel.** Vercel dashboard → Add New → Project → choose the repository. Framework preset: **Other**. Leave the build settings empty; `vercel.json` already tells Vercel to serve the `public` folder.
3. **Add the database.** In the project: Storage → Create → **Neon (Postgres)** → connect it to the project. This sets `DATABASE_URL` automatically. The tables are created on first use (`schema.sql` is the same thing if you want to run it by hand).
4. **Set the PINs.** Settings → Environment Variables:
   - `APP_PIN`: the staff PIN (for example a 6-digit number). Staff can record and sign checks.
   - `ADMIN_PIN`: your own PIN. It can also reopen signed checks and correct meter readings.
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect.
6. **Share the link** with staff. Each phone asks for the PIN once and remembers it. "Change PIN" is at the top of every page.

Without `APP_PIN` and `ADMIN_PIN` the app is open to anyone who has the link, so set both before sharing.

## Adding to an existing Vercel project

- **Next.js (Pages Router):** copy `public/*` into your `public/` folder and `api/*` into `pages/api/`. The handlers use the same `(req, res)` signature. Add the dependency `@neondatabase/serverless`. Open the pages at `/energy-round.html`, `/ac-control.html` and `/performance.html`, or add rewrites for the short addresses.
- **Next.js (App Router) or any other framework:** deploy this folder as its own Vercel project on a subdomain, for example `energy.yourdomain.com`. That is the simplest route.

## How the data is stored

One Postgres table, `docs`, holds JSON documents by path:

| Path | Contents |
|---|---|
| `config/meters` | Meter list: number, name, multiplier |
| `meters/<date>` | Start-of-day meter readings, who read them and when |
| `rounds/<date>/checks/<check>` | Each energy round check (R1 Eng, R1 Sec, R2 Eng, R2 Sec, DM): every area, reason, true/false verdict, time |
| `days/<date>` | Daily energy round summary used by the Performance page |
| `ac/<date>` | AC log: technician, lobby log, every room and area, Chief Engineer sign-off |
| `acdays/<date>` | Daily AC summary used by the Performance page |

`schema.sql` has example queries for exporting the data to Excel or Power BI. The Performance page also downloads a CSV for any week, month or year.

## Files

```
api/_lib.js              database connection, schema, PIN check
api/doc.js               read / write / merge one document
api/docs.js              read many documents at once (live updates every 8 seconds)
api/query.js             date-range queries for reports
api/whoami.js            checks the PIN
public/mgh-data.js       browser data layer used by all pages
public/energy-round.html daily energy round
public/ac-control.html   AC control log
public/performance.html  weekly / monthly / yearly performance
public/index.html        home page
```

Data recorded in the Claude versions of the forms stays there; the Vercel version starts with an empty database.
