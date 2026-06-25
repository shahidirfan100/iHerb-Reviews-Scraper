## Selected API
- Endpoint: https://pk.iherb.com/ugc/api/review/v2/search
- Method: GET
- Auth: No static auth token required, but anti-bot/session cookies are required in many environments
- Pagination: `page` and `limit` query params
- Fields available: `items[]` with review id, title, text, rating, dates, helpful votes, verified purchase, language, country, user profile summary, images, plus `countryReviews` summary bucket
- Fields currently missing in actor: all review-level fields (previous actor was product listings only)
- Field count: 25+ review-related fields (vs 15-18 listing fields previously)

## Working query shape
`/ugc/api/review/v2/search?pid=<productId>&page=<page>&sortId=<sortId>&cc=<countryCode>&lc=<languageCode>&textToSearch=&limit=<pageSize>&withImagesOnly=<bool>&isShowTranslated=true&withoutDefaultTitle=true&withCountryReview=true`

## Why this endpoint won
- Returns direct JSON review documents
- Supports stable pagination
- Includes richer UGC metadata than product listing APIs
- Works with browser-session request context (Playwright Firefox), which is resilient against Cloudflare and anti-bot checks

## Rejected candidates
- `https://pk.iherb.com/ugc/api/product/<pid>/review/summary/v2?languageCode=en-US`
  - Rejected as primary source: summary only, not individual review rows
- `https://pk.iherb.com/ugc/api/product/<pid>/review/images?limit=12&pageNumber=1`
  - Rejected as primary source: image-focused subset, not complete reviews
- `https://pk.iherb.com/ugc/api/product/<pid>/review/summarization?languageCode=en-US`
  - Rejected as primary source: aggregated text summary only
- `https://catalog.app.iherb.com/category/<slug>/products`
  - Rejected for this task: listing/products API, not review extraction

## API scoring (selected endpoint)
| Factor | Points |
|---|---|
| Returns JSON directly | +30 |
| Has >15 unique fields | +25 |
| No auth required | +20 |
| Has pagination support | +15 |
| Matches or extends current fields | +10 |
| **Total** | **100** |

## Transport notes
- The review search API is called through a Playwright Firefox browser session to satisfy PerimeterX anti-bot checks on Apify.
- Direct HTTP requests are blocked in production; Playwright is used from the start to avoid wasted retry time.
- Product page HTML is only used for session warmup; review data comes from the JSON API endpoint.
