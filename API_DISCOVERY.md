## Selected API
- Endpoint: https://pk.iherb.com/ugc/api/review/v2/search
- Method: GET
- Auth: No static auth token required; anti-bot resilience via Impit browser impersonation
- Pagination: `page` and optional `pageToken` query params (nextPageToken returned in response)
- Fields available: `items[]` with review id, title, text, rating, dates, helpful votes, verified purchase, language, country, user profile summary (badge, image, ugc stats), images
- Fields currently missing in actor: all review-level fields (previous actor was product listings only)
- Field count: 33+ review-related fields

## Working query shape
`/ugc/api/review/v2/search?pid=<productId>&page=<page>&sortId=<sortId>&lc=<languageCode>&textToSearch=&limit=<pageSize>&withImagesOnly=<bool>&isShowTranslated=<bool>&withoutDefaultTitle=true&withCountryReview=<bool>`

`lc` is the supported review-language filter. The endpoint exposes country counts through `countryReviews`, but testing showed that its `cc` parameter does not select reviewer rows: returned items remain from the default country. The actor therefore does not expose `cc` as a reviewer-country filter. `isShowTranslated` is disabled by default so source-language review text is preserved; it is enabled only by an explicit input or URL query.

## Winning access method
- **HTTP client**: Impit `0.14.5`
- **Primary profile**: `chrome136`
- **Recovery profiles**: `chrome142`, `firefox135`, and `okhttp4`
- **TLS errors**: ignored for proxy compatibility
- **Proxy**: Optional locally; Apify Proxy can rotate on anti-bot responses
- **Browser warmup**: not required; the endpoint returns direct JSON

## Why this endpoint won
- Returns direct JSON review documents
- Supports stable pagination
- Includes richer UGC metadata than product listing APIs
- Works with direct HTTP (no Playwright browser required)
- Tested Impit profiles `chrome125+`, Firefox, and okhttp profiles returned JSON review items
- Generic `chrome`/older Chrome profiles can receive PerimeterX blocks; recovery rotates only through tested profiles
- `ios18` produced a native TLS transport error and is not used

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

## Impit profile test matrix

| Profile | Result against review endpoint | Used |
|---|---|---|
| `chrome136` | 200 with JSON items | ✅ primary |
| `chrome142` | 200 with JSON items | ✅ recovery |
| `firefox135` | 200 with JSON items | ✅ recovery |
| `okhttp4` | 200 with JSON items | ✅ recovery |
| `chrome125`, `chrome131`, `chrome151` | 200 with JSON items | validated |
| `chrome`, `chrome124` | 403 anti-bot response | not used |
| `ios18` | Native `ConnectError`/TLS decode failure | not used |

## Transport notes
- Direct HTTP uses one reusable Impit client per session; no Playwright browser is required
- On HTTP 403 or another transient response, the actor rotates the proxy when configured and advances to the next tested Impit profile
- Retries are finite and cover anti-bot 403, 429, 5xx, timeout, connection, malformed-response, and transient-empty-response cases
- Response includes `nextPageToken` for pagination (sequential, same as page number)
- Country reviews summary is available through `withCountryReview=true`
- The actor uses the supplied iHerb storefront hostname for the request and verifies returned `languageCode` values before saving language-filtered records
- Reviewer `countryCode` remains part of each output record; country-level counts are available through `withCountryReview=true`, but country-row filtering is not supported by this endpoint
