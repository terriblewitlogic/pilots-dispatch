# Pilots Dispatch

A company-neutral operations dashboard for **Pocket Pilots**. Choose any company from the public directory—or enter its public company ID—to track territory, airport defense, expansion opportunities, flights, rivals, and weather.

Built from the TEX Dispatch companion. This repository is independent of the original hosted TEX site and contains no Sites project identity, game credentials, saved player snapshots, or Texas-only defaults.

## Run locally

Use Node.js **22.18+** and npm:

```sh
git clone https://github.com/terriblewitlogic/pilots-dispatch.git
cd pilots-dispatch
npm ci
npm run dev
```

Open http://localhost:3000, click **Load directory**, search a company name or tag, and choose it. Click **Refresh data** to establish the first territory observation. No API keys or game login are required.

The directory is the subset returned by the game's public world response, not a complete registry. If a company is missing, expand **Company missing? Enter a public ID**. A public company ID is different from a company join code. Unknown IDs may return empty data; the app does not claim that a manually entered ID is verified.

## Features

- **Company selection:** dynamic company name/tag, switching, and remembered selection.
- **Territory map:** observed holdings and airport standings, with verification coverage and original timestamps.
- **Analytics:** separate Company and Pilot operating-performance views for money earned, nautical miles flown, flight hours, departures, completed jobs, balance, and earnings per departure/hour. Record cumulative game totals or import Company Sync / performance JSON exports. Compare latest totals or period changes over 24 hours, 7, 30, or 90 days, inspect trends, and export CSV. The Territory tab retains holdings, gains/losses, retention, and defense coverage.
- **Airport defense:** close leads, observed ownership losses, configurable thresholds, and optional desktop notifications while open.
- **Expansion targets:** worldwide nearby airport discovery; verifies the closest eight candidates per search.
- **Watchlist:** up to 24 airports per company. Add known airports or enter a game code and coordinates anywhere in the world, including when the company has no holdings.
- **Activity history:** baseline and changes between observations, retained for 90 days or 1,000 checks.
- **Bases & projects:** a worldwide base map, selected-company/all-company filters, nearest observed holdings, airport holder versus base company details, watchlist shortcuts, and construction material progress. No gate, supply, operating-status, or Base Jump balance is inferred from the public listings.
- **Fleet:** public active flights, routes, arrival estimates, and optional game flight tracks.
- **Events and pilot rankings:** public event briefings and aircraft-specific rankings, including a requested pilot's returned rank.
- **Rival radar:** nearby activity and holdings; flight endpoints are not represented as live aircraft locations or proof of an attack.
- **Weather:** nearby game-supplied station observations and raw reports, for game planning.
- **Regional boards:** the returned country-level company board, with the selected company highlighted when present.
- **Company-bound JSON backups:** export and restore locally, with schema validation and identity checks.

## Data and refresh behavior

Data lives in IndexedDB under a separate database for each company. Preferences are also company-specific. Switching companies unmounts the operations desk; outstanding requests retain the database for the company that started them. A different company's backup cannot overwrite the current company's records. Original TEX Dispatch backups use a different, unscoped format and are intentionally not accepted.

Refresh is on demand. Optional territory checks run every five minutes only while the page is open and visible. Other views have their own manual refresh controls. Explicit territory/fleet refresh bypasses successful cached responses but respects cached rate limits. Public directory, radar, weather, and nearby searches reuse bounded caches. Partial failures retain older observations with their original timestamps.

The Node server uses a bounded **process-local** cache. It is not a persistent cloud database or a distributed cache. Multiple server instances have separate caches; a larger public deployment should add a shared cache and application-level request limiting. There are no background monitors or cross-device history sync.

## Operating analytics data

Open **Analytics → Company** or **Analytics → Pilot**, then use **Update totals** to enter cumulative values from the game. Use a stable pilot ID for each personal history; add another pilot by entering a different ID and callsign. Blank fields are unavailable, while an entered zero is a real zero. Values stay local to the selected company's browser database and are included in Dispatch backups.

**Import totals** accepts the existing Company Sync JSON snapshot (`version: 1`, `fetchedAt`, `company`, `viewer`, `stats`, `treasury`) and this dashboard's **Export totals JSON** format (`format: "pilots-performance"`, `version: 1`, `observations`). Company Sync supplies company earnings, jobs, and treasury; it does not provide verified company-wide distance, flight hours, or departures. Pilot values are entered from career stats or restored from a performance export. Arbitrary extra fields are discarded before storage, and company IDs must match the active company. This feature makes no authenticated API calls and stores no game credentials.

Public **Refresh data** does not update these private performance records. Money earned is gross earnings, not profit. The game's career `flights` counter counts departures, so it is not presented as completed flights. Pilot career totals are not company contributions and are never summed into company totals. Compare two observations to see period changes; decreased cumulative counters disable comparisons, while cash balances may legitimately decrease. Rates use matching observations for earnings and their denominator. Saving keeps up to 1,000 observations from the last 90 days. The recorded-observations table can remove an incorrect entry; an import or entry at the same subject and timestamp replaces that observation.

## API boundary

All game calls go through same-origin Next.js route handlers to the fixed upstream host `https://pilots.nimblebit.com`. Only read-only endpoints are used. Company IDs and airport/search inputs are validated, requests have timeouts, responses are size-limited, and tile/standings batches are bounded. No arbitrary upstream URL proxy is exposed.

| Local endpoint          | Public game source                           | Company scope                                 |
| ----------------------- | -------------------------------------------- | --------------------------------------------- |
| `GET /api/bases`        | `/api/world?v=2` bases and construction      | Shared public listings; company filter in UI  |
| `GET /api/companies`    | `/api/world?v=2` company metadata            | Shared directory                              |
| `POST /api/dispatch`    | `/api/air/co{id}`, `/api/standings`          | Required `companyId`                          |
| `POST /api/discover`    | Airport shards, regional airspace, standings | Required `companyId`                          |
| `GET /api/fleet`        | `/api/air/co{id}`                            | Required `companyId`                          |
| `GET /api/pilot-search` | `/api/find/{callsign}`                       | Required `companyId`, filters returned pilots |
| `GET /api/airport`      | `/api/here`                                  | Airport code                                  |
| `GET /api/events`       | `/api/world?v=2`                             | Shared event                                  |
| `GET /api/flight-track` | Public flight track                          | Pilot/flight identity                         |
| `GET /api/rankings`     | `/api/top/{aircraft}`                        | Aircraft, optional pilot                      |
| `POST /api/radar`       | Regional `/api/air` cells                    | Area; selected-company filtering in UI        |
| `POST /api/weather`     | Regional `/api/wx` cells                     | Area                                          |
| `GET /api/regional`     | `/api/tables?region=XX`                      | Country                                       |

These are undocumented game endpoints, not a guarantee of full API coverage. Response formats may change. Company boards currently return a limited leader list; an absent company has an unknown rank, not an inferred position beyond the top 25. Regular destination job inventories are not exposed here.

## Validate and deploy

```sh
npm test
npm run typecheck
npm run build
npm start
```

The test suite covers scoring, stale data, rate-limit handling, flight/weather/radar parsing, company-scoped route behavior, IndexedDB isolation, and mismatched backup rejection, multiple base companies at one airport, and construction progress validation. GitHub Actions runs the tests, type check, and production build on pushes and pull requests.

Deploy as a standard **Next.js Node application**, using `npm run build` and `npm start`, or import this repository into a Next.js-compatible host. It requires server-side route handlers: static export / GitHub Pages alone is insufficient. No deployment is automatically performed by this repository. No environment secrets are required for the current read-only integration.

Formatting: `npm run format`; check formatting with `npm run format:check`.

## Project structure

- `app/api/` — bounded, read-only game API adapters.
- `components/company-provider.tsx` — directory picker, selection, immutable company scope.
- `lib/company.ts` — company ID and directory validation.
- `lib/local-db.ts`, `lib/backup.ts` — per-company local persistence and backup validation.
- `lib/dispatch.ts` — company-aware defense assessment and observation history.
- `components/` — maps, airport detail, operations and intelligence views.
- `tests/` — Node tests; `fake-indexeddb` exercises storage without a live game.

## Credits

Independent companion, not affiliated with or endorsed by NimbleBit. Pocket Pilots and game data belong to their respective owners. Map tiles and attribution are from OpenStreetMap; Leaflet 1.9.4 is vendored under its BSD-2-Clause license in `public/vendor/leaflet.LICENSE`. Google Fonts are loaded remotely with system font fallbacks.

Application source is MIT licensed. Third-party libraries and game assets/data retain their own licenses and ownership.
