## Selected API
- Endpoint: https://pk.iherb.com/ugc/api/review/v2/search
- Method: GET
- Auth: No static auth token required; anti-bot bypass via Android app-style headers
- Pagination: `page` and optional `pageToken` query params (nextPageToken returned in response)
- Fields available: `items[]` with review id, title, text, rating, dates, helpful votes, verified purchase, language, country, user profile summary (badge, image, ugc stats), images
- Fields currently missing in actor: all review-level fields (previous actor was product listings only)
- Field count: 33+ review-related fields

## Working query shape
`/ugc/api/review/v2/search?pid=<productId>&page=<page>&sortId=<sortId>&cc=<countryCode>&lc=<languageCode>&textToSearch=&limit=<pageSize>&withImagesOnly=<bool>&isShowTranslated=true&withoutDefaultTitle=true&withCountryReview=true`

## Winning access method
- **User-Agent**: `okhttp/4.12.0` (Android app-style)
- **Accept**: `application/json`
- **HTTP/2**: disabled (`http2: false`)
- **Header generation**: disabled (`useHeaderGenerator: false`)
- **Proxy**: Optional (works without proxy on local machine)
- **No browser warmup needed**: direct HTTP via got-scraping

## Why this endpoint won
- Returns direct JSON review documents
- Supports stable pagination
- Includes richer UGC metadata than product listing APIs
- Works with direct HTTP (no Playwright browser required)
- Android okhttp header profile bypasses PerimeterX anti-bot protection

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

## Header profile test matrix

| Profile | Status | Works? |
|---|---|---|
| iOS Safari | 403 (PerimeterX block) | ❌ |
| Desktop Chrome | 403 (PerimeterX block) | ❌ |
| Desktop Firefox | 403 (PerimeterX block) | ❌ |
| Android okhttp/4.12.0 | 200 (JSON with items) | ✅ |

## Transport notes
- Direct HTTP via `got-scraping` with `http2: false`, `useHeaderGenerator: false`
- Android `okhttp/4.12.0` user-agent bypasses PerimiterX protection on `pk.iherb.com`
- No browser warmup or Playwright session required
- Response includes `nextPageToken` for pagination (sequential, same as page number)
- Country reviews summary available via `withCountryReview=true` parameter
