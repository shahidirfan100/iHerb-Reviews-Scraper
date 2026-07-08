# iHerb Reviews Scraper

Extract detailed iHerb review data from product pages for market research, product quality analysis, and customer sentiment tracking. Collect clean, structured review records including ratings, review text, author context, language, and country signals.

---

## Features

- **API-speed extraction** — Direct API calls via got-scraping with Android app-style headers; completes in seconds, not minutes.
- **Rich review fields** — Capture title, text, rating, helpful votes, verified purchase status, review dates, reviewer badges, profile images, and UGC activity stats.
- **Reviewer context** — Gather reviewer nickname, profile link, country, badge level, and profile-level activity fields (review count, helpful count, image count, answer count).
- **Duplicate-safe output** — Skips duplicate review IDs and invalid records missing core content.
- **Image-aware filtering** — Optionally collect only reviews that include images.
- **Clean dataset output** — Empty and null-like fields are removed from each item for better downstream analysis.
- **Anti-bot resilient** — Android okhttp header profile bypasses PerimeterX protection without browser overhead.

---

## Use Cases

### Product Quality Monitoring
Track customer feedback patterns over time for a specific supplement or wellness product. Detect recurring complaints or strong positive signals quickly.

### Competitor Review Analysis
Collect review data from competitor products to compare sentiment, pain points, and satisfaction trends. Use this for product positioning and messaging.

### Customer Voice Research
Build datasets of real customer language for copywriting, product development, and support training. Identify frequently mentioned benefits and objections.

### Localized Market Insights
Analyze reviews by country and language to understand regional differences in customer perception.

### BI and Reporting Pipelines
Feed review datasets into dashboards, notebooks, or internal tools for scoring, trend detection, and monthly reporting.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `productUrl` | String | No | Example iHerb product URL | Product URL to scrape reviews from. |
| `productId` | String | No | `""` | Optional numeric product ID override. If empty, it is extracted from `productUrl`. |
| `maxReviews` | Integer | No | `20` | Maximum number of reviews to collect. Use `0` for no explicit limit. |
| `pageSize` | Integer | No | `20` | Number of reviews requested per page. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Proxy settings for your run environment. |

---

## Output Data

Each dataset item contains:

| Field | Type | Description |
|---|---|---|
| `reviewId` | String | Unique review identifier. |
| `productId` | String | iHerb product identifier. |
| `productUrl` | String | Product URL used for extraction. |
| `reviewTitle` | String | Review headline/title. |
| `reviewText` | String | Full review text. |
| `rating` | Number | Review rating on a `1-5` scale. |
| `ratingRaw` | Number | Raw rating value from source format. |
| `verifiedPurchase` | Boolean | Whether the review is verified. |
| `hasRewarded` | Boolean | Reward-related review flag when available. |
| `postedDate` | String | ISO review date. |
| `postedDateLocalized` | String | Localized display date. |
| `languageCode` | String | Review language code. |
| `languageName` | String | Review language label. |
| `countryCode` | String | Reviewer country code. |
| `countryName` | String | Reviewer country name. |
| `customerNickname` | String | Reviewer nickname. |
| `customerProfileLink` | String | Reviewer profile link token. |
| `reviewerUsername` | String | Reviewer username. |
| `reviewerDisplayName` | String | Reviewer display name. |
| `reviewerReviewCount` | Number | Reviewer total review count. |
| `reviewerHelpfulCount` | Number | Reviewer helpful vote count. |
| `reviewerImageCount` | Number | Reviewer total image count. |
| `reviewerAnswerCount` | Number | Reviewer Q&A answer count. |
| `reviewerBadgeName` | String | Reviewer contributor badge name. |
| `reviewerBadgeTitle` | String | Reviewer contributor badge title. |
| `reviewerProfileImage` | String | Reviewer profile image URL when available. |
| `helpfulYes` | Number | Helpful upvotes on review. |
| `helpfulNo` | Number | Unhelpful votes on review. |
| `reviewImageCount` | Number | Number of images in this review. |
| `reviewImages` | Array | Review image URLs when available. |
| `hasReviewImages` | Boolean | Whether the review has images. |
| `sortId` | Number | Effective sort mode used in run. |
| `page` | Number | Source page number. |
| `scrapedAt` | String | Extraction timestamp in ISO format. |

Run-level metrics are stored in the default key-value store under `statistics`.

---

## Usage Examples

### Basic Review Extraction

```json
{
  "productUrl": "https://pk.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839",
  "maxReviews": 20
}
```

### Product ID Only

```json
{
  "productId": "61839",
  "maxReviews": 100
}
```

### Messy URL Input (Auto Detection)

```json
{
  "productUrl": "Check this link: https://www.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839?rcode=ABC123&utm_source=test",
  "maxReviews": 50
}
```

---

## Sample Output

```json
{
  "reviewId": "e825817a-b0fa-4f2e-81ee-dbe559cd8743",
  "productId": "61839",
  "productUrl": "https://pk.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839",
  "reviewTitle": "Great",
  "reviewText": "The propolis extract has a rich, resinous taste and feels potent yet gentle in its effect. It supports immunity and overall wellness, offering a natural layer of protection. The quality is pure and authentic, with no unnecessary additives. A traditional remedy that brings strength and balance in a convenient form.",
  "rating": 5,
  "ratingRaw": 50,
  "verifiedPurchase": true,
  "hasRewarded": false,
  "postedDate": "2026-04-15T12:48:40.121Z",
  "postedDateLocalized": "Apr 15, 2026",
  "languageCode": "en-US",
  "languageName": "English",
  "countryCode": "MD",
  "countryName": "Moldova, Republic of",
  "customerNickname": "Ina",
  "customerProfileLink": "5238922849634942675",
  "reviewerUsername": "5238922849634942675",
  "reviewerDisplayName": "Ina",
  "reviewerReviewCount": 205,
  "reviewerHelpfulCount": 15,
  "reviewerImageCount": 0,
  "reviewerAnswerCount": 9,
  "reviewerBadgeName": "Silver",
  "reviewerBadgeTitle": "Silver contributor",
  "reviewerProfileImage": "https://ugc-images.images-iherb.com/ugc/20260107/86ebf71b-45bc-400a-869a-129d26a7434d/l.jpeg",
  "helpfulYes": 0,
  "helpfulNo": 0,
  "reviewImageCount": 0,
  "hasReviewImages": false,
  "sortId": 6,
  "page": 1,
  "scrapedAt": "2026-07-08T05:48:36.832Z"
}
```

---

## Tips for Best Results

### Start small, then scale
- Run with `maxReviews: 20` first to validate output shape.
- Increase limits after confirming your filters and sort settings.

### Keep pagination balanced
- Use `pageSize: 20` for stable runs.
- Increase gradually only when you need larger batches.

### Use simple inputs
- Provide either `productUrl` or `productId`.
- Messy product URLs are normalized automatically.

### Build recurring insights
- Schedule regular runs to monitor sentiment shifts.
- Compare review snapshots month-over-month.

---

## Integrations

Use review data with:

- **Google Sheets** — Quick review dashboards and shared reports.
- **Airtable** — Searchable review database for teams.
- **Looker Studio / BI tools** — Trend charts and scoring models.
- **Webhooks** — Trigger downstream workflows automatically.
- **Make** — No-code automation across apps.
- **Zapier** — Send reviews into CRM, Slack, or email flows.

### Export Formats

- **JSON** — Flexible for apps and pipelines.
- **CSV** — Spreadsheet-friendly tabular export.
- **Excel** — Business-ready reporting format.
- **XML** — Compatibility with legacy systems.

---

## Frequently Asked Questions

### Does this actor collect product listings?
No. This actor is focused on product reviews only.

### How many reviews can I scrape in one run?
Set `maxReviews` up to `10000`, or `0` for no explicit limit.

### Can I use messy product URLs?
Yes. The actor auto-detects the product ID from messy URLs containing extra query parameters or surrounding text.

### Why can some fields be missing for certain reviews?
Not every review includes all optional metadata, so records contain only available values.

### Where are run statistics stored?
Run-level metrics are saved in key-value store record `statistics`.

### Do I need both product ID and product URL?
No. Either one is enough.

### How fast is this actor?
Extraction is near-instant. A typical 20-review run completes in under 2 seconds — a 60x improvement over browser-based approaches.

---

## Support

For issues and feature requests, use Apify Console support channels.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection. You are responsible for compliance with website terms, local regulations, and applicable laws.
