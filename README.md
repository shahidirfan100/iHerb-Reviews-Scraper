## What does iHerb Reviews Scraper do?

iHerb Reviews Scraper collects customer reviews from iHerb product pages and delivers them as structured data for product analysis, sentiment tracking, and market research. Provide a product URL or product ID, set a review limit, and the Actor returns ratings, review text, reviewer profiles, language and country context, and image attachments in a clean dataset.

## Why use iHerb Reviews Scraper?

- **Structured review datasets** - Collect ratings, review text, helpful votes, verified purchase status, reviewer badges, and profile activity fields without manual copy-paste.
- **Reviewer context included** - Each record carries reviewer country, language, badge level, review count, helpful count, image count, and profile image when available.
- **Multi-purpose output** - Export results to JSON, CSV, Excel, or XML for dashboards, BI tools, AI training, or competitive reports.
- **Duplicate-safe collection** - Duplicate review IDs and records missing core content are skipped automatically.
- **Image-aware collection** - Optionally limit results to reviews that include images.

## What data can you extract from iHerb?

| Field | Description |
|-------|-------------|
| `rating` | Star rating on a 1-5 scale |
| `reviewTitle` | Review headline |
| `reviewText` | Full review body |
| `verifiedPurchase` | Whether the reviewer purchased the product |
| `helpfulYes` / `helpfulNo` | Helpful and unhelpful vote counts |
| `languageCode` / `languageName` | Review language context |
| `countryCode` / `countryName` | Reviewer country |
| `customerNickname` | Reviewer public nickname |
| `reviewerBadgeName` / `reviewerBadgeTitle` | Contributor badge level |
| `reviewerReviewCount` / `reviewerHelpfulCount` | Reviewer activity metrics |
| `postedDate` | ISO review date |
| `reviewImages` | Attached image URLs |
| `reviewerProfileImage` | Reviewer profile picture URL |

## How to use iHerb Reviews Scraper

1. Open the Actor on Apify Store.
2. Add an iHerb product URL or numeric product ID.
3. Set the maximum number of reviews to collect.
4. Optionally set sort order (`sortBy`/`sortId`), language, country, image-only, or country-review breakdown options.
5. Run the Actor.
6. Download the dataset or connect it to your workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `productUrl` | String | No | Example iHerb product URL | iHerb product URL. The product ID is extracted automatically from supported URL formats. |
| `productId` | String | No | `""` | Numeric iHerb product ID. Takes priority over URL-based extraction when both are provided. |
| `maxReviews` | Integer | No | `20` | Maximum number of reviews to collect. Use `0` for no limit. |
| `sortBy` | String | No | `mostRecent` | Sort mode: `mostRecent`, `newest`, `oldest`, `helpful`, `highestRating`, or `lowestRating`. |
| `sortId` | Integer | No | `(empty)` | Numeric sort ID override used by the iHerb review API. Takes priority over `sortBy`. Leave empty to use `sortBy`. Known values: 1 = highest rating, 2 = lowest rating, 4 = most helpful, 6 = most recent, 7 = oldest. |
| `languageCode` | String | No | `en-US` | Language filter for reviews (IETF language tag). If left empty, defaults to `en-US`. |
| `countryCode` | String | No | `(empty)` | Country filter for reviews (ISO country code). |
| `withImagesOnly` | Boolean | No | `false` | When `true`, only collect reviews that include images. |
| `withCountryReview` | Boolean | No | `false` | When `true`, include the country-level review breakdown from the API. |
| `proxyConfiguration` | Object | No | Residential proxy enabled | Proxy settings for your run environment. Apify residential proxy is enabled by default for smoother runs. |

## Output Data

| Field | Type | Description |
|-------|------|-------------|
| `reviewId` | String | Unique review identifier |
| `productId` | String | iHerb product identifier |
| `productUrl` | String | Product URL used for extraction |
| `reviewTitle` | String | Review headline |
| `reviewText` | String | Full review text |
| `rating` | Number | Review rating on a 1-5 scale |
| `ratingRaw` | Number | Raw rating value from source format |
| `verifiedPurchase` | Boolean | Whether the review is from a verified purchase |
| `hasRewarded` | Boolean | Reward-related flag when available |
| `postedDate` | String | ISO review date |
| `postedDateLocalized` | String | Localized display date |
| `languageCode` | String | Review language code |
| `languageName` | String | Review language label |
| `countryCode` | String | Reviewer country code |
| `countryName` | String | Reviewer country name |
| `customerNickname` | String | Reviewer nickname |
| `customerProfileLink` | String | Reviewer profile link token |
| `reviewerUsername` | String | Reviewer username |
| `reviewerDisplayName` | String | Reviewer display name |
| `reviewerReviewCount` | Number | Total reviews by this reviewer |
| `reviewerHelpfulCount` | Number | Total helpful votes for this reviewer |
| `reviewerImageCount` | Number | Total images by this reviewer |
| `reviewerAnswerCount` | Number | Total Q&A answers by this reviewer |
| `reviewerBadgeName` | String | Contributor badge name |
| `reviewerBadgeTitle` | String | Contributor badge display title |
| `reviewerProfileImage` | String | Reviewer profile image URL |
| `helpfulYes` | Number | Helpful upvotes on this review |
| `helpfulNo` | Number | Unhelpful votes on this review |
| `reviewImageCount` | Number | Number of images in this review |
| `reviewImages` | Array | Review image URLs |
| `hasReviewImages` | Boolean | Whether the review has images |
| `sortId` | Number | Sort mode used in the run |
| `page` | Number | Source page number |
| `scrapedAt` | String | Extraction timestamp in ISO format |

Run statistics are saved in the default key-value store under `statistics`.

## Usage Examples

### Basic review extraction

Collect the first set of reviews from a product page:

```json
{
  "productUrl": "https://pk.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839",
  "maxReviews": 20
}
```

### Product ID only

Run with just the numeric product ID when you do not have a full URL:

```json
{
  "productId": "61839",
  "maxReviews": 100
}
```

### Filtered by language and country

Collect English reviews from a specific country with the most helpful sort order:

```json
{
  "productUrl": "https://pk.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839",
  "maxReviews": 50,
  "sortBy": "helpful",
  "languageCode": "en-US",
  "countryCode": "US"
}
```

### Image-only reviews

Collect only reviews that include customer images:

```json
{
  "productUrl": "https://pk.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839",
  "maxReviews": 30,
  "withImagesOnly": true
}
```

### Messy URL with auto detection

The Actor extracts the product ID from URLs that contain extra query parameters or surrounding text:

```json
{
  "productUrl": "Check this link: https://www.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839?rcode=ABC123&utm_source=test",
  "maxReviews": 50
}
```

## Sample Output

```json
{
  "reviewId": "e825817a-b0fa-4f2e-81ee-dbe559cd8743",
  "productId": "61839",
  "productUrl": "https://pk.iherb.com/pr/california-gold-nutrition-bee-propolis-2x-concentrated-extract-500-mg-90-veggie-caps/61839",
  "reviewTitle": "Great",
  "reviewText": "The propolis extract has a rich, resinous taste and feels potent yet gentle in its effect.",
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

## Tips for Best Results

- Start with `maxReviews: 20` to validate the output shape before scaling up.
- Reviews are fetched in batches of 20 per API page (the iHerb review API caps the page size), so the Actor pages automatically until `maxReviews` is reached.
- Provide either `productUrl` or `productId`. Both are not required.
- Messy product URLs with extra query parameters or surrounding text are normalized automatically.
- Schedule regular runs to monitor sentiment shifts and compare review snapshots over time.
- Some fields may be empty when the source page does not publish that information. Check multiple results before assuming the Actor failed.

## Integrations

- **Google Sheets** - Send review data to spreadsheets for shared analysis.
- **Airtable** - Build a searchable review database for your team.
- **Looker Studio / BI tools** - Create trend charts and scoring models.
- **Webhooks** - Trigger downstream workflows after each run.
- **Make** - Connect results to no-code automations.
- **Zapier** - Send reviews into CRM, Slack, or email flows.

### Export Formats

- **JSON** - Flexible for apps and pipelines.
- **CSV** - Spreadsheet-friendly tabular export.
- **Excel** - Business-ready reporting format.
- **XML** - Compatibility with legacy systems.
- **API** - Access datasets programmatically from your own systems.

## Frequently Asked Questions

### Does this Actor collect product listings?

No. This Actor collects product reviews only. For product data, use an iHerb product scraper.

### How many reviews can I collect in one run?

Set `maxReviews` up to `10000`, or use `0` for no explicit limit.

### Can I use messy product URLs?

Yes. The Actor auto-detects the product ID from URLs with extra query parameters, tracking codes, or surrounding text.

### Why are some fields missing for certain reviews?

Not every review includes all optional metadata. Records contain only available values. Empty and null fields are removed from the output.

### Can I filter reviews by language or country?

Yes. Use `languageCode` and `countryCode` to narrow results by locale.

### Can I sort reviews by rating or date?

Yes. Use `sortBy` with values such as `mostRecent`, `oldest`, `helpful`, `highestRating`, or `lowestRating`.

### Do I need both product ID and product URL?

No. Either one is enough. When both are provided, `productId` takes priority.

### Where are run statistics stored?

Run-level metrics are saved in the default key-value store under the key `statistics`.

## Related Actors

- [Flipkart Reviews Scraper](https://apify.com/shahidirfan/flipkart-reviews-scraper)
- [Walmart Reviews Scraper](https://apify.com/shahidirfan/walmart-reviews-scraper)
- [Target Reviews Scraper](https://apify.com/shahidirfan/target-reviews-scraper)
- [B&H Reviews Scraper](https://apify.com/shahidirfan/b-h-reviews-scraper)

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate data collection from publicly available iHerb product pages. Users are responsible for using the data responsibly and complying with applicable laws and website terms.
