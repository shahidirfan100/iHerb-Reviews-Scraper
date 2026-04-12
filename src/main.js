import { Actor } from 'apify';
import log from '@apify/log';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firefox } from 'playwright';

await Actor.init();

const API_HOST = 'https://pk.iherb.com';
const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 45000;
const RETRYABLE_STATUSES = new Set([403, 408, 409, 425, 429, 500, 502, 503, 504]);
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const DEFAULT_SORT_ID = 6;
const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_COUNTRY_CODE = '';
const DEFAULT_WITH_IMAGES_ONLY = false;
const MAX_PAGES_PER_SESSION = 4;
const MAX_TOTAL_SESSION_ROTATIONS = 100;
const MAX_SESSION_ROTATIONS_PER_PAGE = 8;
const SESSION_WARMUP_WAIT_MS = 2000;
const MIN_PAGE_DELAY_MS = 350;
const MAX_PAGE_DELAY_MS = 1200;

const SORT_ID_MAP = {
    mostRecent: 6,
    newest: 6,
    recent: 6,
    oldest: 7,
    helpful: 4,
    highestRating: 1,
    lowestRating: 2,
};

async function loadInput() {
    const runtimeInput = (await Actor.getInput()) ?? {};
    if (Object.keys(runtimeInput).length > 0) return runtimeInput;

    try {
        const localInputPath = resolve(process.cwd(), 'INPUT.json');
        const localInputRaw = await readFile(localInputPath, 'utf8');
        const localInput = JSON.parse(localInputRaw);
        if (localInput && typeof localInput === 'object') return localInput;
    } catch {
        // Ignore local input fallback errors and continue with empty object.
    }

    return runtimeInput;
}

const input = await loadInput();
const {
    productUrl = '',
    productId = '',
    maxReviews = 20,
    pageSize = 20,
    sortBy = '',
    sortId = DEFAULT_SORT_ID,
    languageCode = DEFAULT_LANGUAGE_CODE,
    countryCode = DEFAULT_COUNTRY_CODE,
    withImagesOnly = DEFAULT_WITH_IMAGES_ONLY,
    withCountryReview = false,
    proxyConfiguration: proxyConfig = { useApifyProxy: false },
} = input;

function toText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function toNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return Boolean(value);
}

function stripEmptyFields(record) {
    return Object.fromEntries(
        Object.entries(record).filter(([, value]) => {
            if (value === null || value === undefined) return false;
            if (typeof value === 'string' && value.trim() === '') return false;
            if (Array.isArray(value) && value.length === 0) return false;
            if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
            return true;
        }),
    );
}

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function shouldCreateProxyConfiguration(config) {
    if (!config || typeof config !== 'object') return false;
    if (toBoolean(config.useApifyProxy)) return true;
    if (Array.isArray(config.apifyProxyGroups) && config.apifyProxyGroups.length > 0) return true;
    if (Array.isArray(config.proxyUrls) && config.proxyUrls.length > 0) return true;
    return false;
}

async function createOptionalProxyConfiguration(config) {
    if (!shouldCreateProxyConfiguration(config)) return null;
    return Actor.createProxyConfiguration(config);
}

function resolveSortId(sortIdInput, sortByInput) {
    const numericSortId = toNumber(sortIdInput, null);
    if (numericSortId !== null && Number.isInteger(numericSortId) && numericSortId >= 1) {
        return numericSortId;
    }

    const normalizedSortKey = toText(sortByInput);
    if (normalizedSortKey && SORT_ID_MAP[normalizedSortKey] !== undefined) {
        return SORT_ID_MAP[normalizedSortKey];
    }

    return DEFAULT_SORT_ID;
}

function extractFirstUrlCandidate(textValue) {
    const text = toText(textValue);
    if (!text) return '';

    const match = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (!match?.[0]) return '';

    return match[0].replace(/[),.;]+$/g, '');
}

function extractNumbersFromText(textValue) {
    const text = toText(textValue);
    if (!text) return [];

    const decoded = decodeURIComponent(text);
    const allMatches = [...decoded.matchAll(/\b(\d{4,12})\b/g)].map((match) => match[1]);
    return allMatches;
}

function resolveProductIdFromInput(idInput, urlInput) {
    const fromId = toText(idInput).replace(/\D/g, '');
    if (fromId.length >= 4) return fromId;

    const rawUrlText = toText(urlInput);
    const embeddedUrl = extractFirstUrlCandidate(rawUrlText);
    const sourceText = embeddedUrl || rawUrlText;
    if (!sourceText) return '';

    const decoded = decodeURIComponent(sourceText);

    const queryPidMatch = decoded.match(/[?&](?:pid|productId)=(\d{4,12})/i);
    if (queryPidMatch?.[1]) return queryPidMatch[1];

    const productPathMatch = decoded.match(/\/pr\/[^/?#]+\/(\d{4,12})(?:[/?#]|$)/i);
    if (productPathMatch?.[1]) return productPathMatch[1];

    const genericPathMatch = decoded.match(/\/(\d{4,12})(?:[/?#]|$)/);
    if (genericPathMatch?.[1]) return genericPathMatch[1];

    const numbers = extractNumbersFromText(decoded);
    if (numbers.length > 0) return numbers[numbers.length - 1];

    return '';
}

function normalizeProductUrl(urlInput, resolvedId, idInput) {
    const explicitId = toText(idInput).replace(/\D/g, '');
    if (explicitId.length >= 4 && resolvedId) {
        return `https://www.iherb.com/pr/iherb-product/${resolvedId}`;
    }

    const rawUrlText = toText(urlInput);
    const embeddedUrl = extractFirstUrlCandidate(rawUrlText);
    const candidate = embeddedUrl || rawUrlText;

    if (candidate && /^https?:\/\//i.test(candidate)) {
        try {
            const parsed = new URL(candidate);
            if (/iherb\.com$/i.test(parsed.hostname)) {
                parsed.hash = '';
                return parsed.toString();
            }
        } catch {
            // Use fallback normalization when URL parsing fails.
        }
    }

    if (resolvedId) return `https://www.iherb.com/pr/iherb-product/${resolvedId}`;
    return 'https://www.iherb.com/';
}

function buildWarmupProductUrl(urlInput, resolvedId, idInput) {
    const normalized = normalizeProductUrl(urlInput, resolvedId, idInput);
    if (!normalized) return `https://www.iherb.com/pr/iherb-product/${resolvedId}`;

    try {
        const parsed = new URL(normalized);
        if (/iherb\.com$/i.test(parsed.hostname)) {
            parsed.hostname = 'www.iherb.com';
            return parsed.toString();
        }
    } catch {
        // Fallback to normalized URL when parsing fails.
    }

    return normalized;
}

function buildReviewsEndpoint({ pid, page, size, selectedSortId, selectedLanguageCode, selectedCountryCode, imagesOnly, includeCountryReview }) {
    const params = new URLSearchParams({
        pid,
        page: String(page),
        sortId: String(selectedSortId),
        cc: selectedCountryCode,
        lc: selectedLanguageCode,
        textToSearch: '',
        limit: String(size),
        withImagesOnly: String(imagesOnly),
        isShowTranslated: 'true',
        withoutDefaultTitle: 'true',
        withCountryReview: String(includeCountryReview),
    });

    return `${API_HOST}/ugc/api/review/v2/search?${params.toString()}`;
}

async function sleep(ms) {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function sleepRandom(minMs, maxMs) {
    const randomDelay = Math.floor(minMs + (Math.random() * (maxMs - minMs + 1)));
    await sleep(randomDelay);
}

async function fetchJsonWithRetry({ apiRequestContext, endpoint, referer, label }) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await apiRequestContext.get(endpoint, {
                headers: {
                    accept: 'application/json, text/plain, */*',
                    origin: 'https://pk.iherb.com',
                    referer,
                    'x-requested-with': 'XMLHttpRequest',
                },
                timeout: API_TIMEOUT_MS,
                failOnStatusCode: false,
            });

            const status = response.status();
            const bodyText = await response.text().catch(() => '');

            if (response.ok()) {
                let json;
                try {
                    json = JSON.parse(bodyText);
                } catch {
                    throw new Error(`${label} returned non-JSON response.`);
                }
                return json;
            }

            const error = new Error(`${label} failed with status ${status}. ${bodyText.slice(0, 200)}`);
            if (!RETRYABLE_STATUSES.has(status) || attempt === MAX_RETRIES) throw error;
            lastError = error;
        } catch (error) {
            lastError = error;
            if (attempt === MAX_RETRIES) break;
        }

        const waitMs = 1000 * (2 ** (attempt - 1));
        log.warning(`Retrying ${label} in ${waitMs} ms (attempt ${attempt + 1}/${MAX_RETRIES})`, {
            error: lastError?.message,
        });
        await sleep(waitMs);
    }

    throw lastError ?? new Error(`Failed to fetch ${label}.`);
}

function extractImageUrls(images) {
    if (!Array.isArray(images)) return [];

    const urls = images
        .map((image) =>
            toText(image?.fullPath) ||
            toText(image?.url) ||
            toText(image?.sourceUrl) ||
            toText(image?.imageUrl),
        )
        .filter(Boolean);

    return [...new Set(urls)];
}

function mapReview(review, context) {
    const rawRating = toNumber(review?.ratingValue, null);
    const rating = rawRating === null ? null : Number((rawRating / 10).toFixed(1));
    const reviewImages = extractImageUrls(review?.images);

    return stripEmptyFields({
        reviewId: toText(review?.id),
        productId: context.productId,
        productUrl: context.productUrl,
        reviewTitle: toText(review?.reviewTitle),
        reviewText: toText(review?.reviewText),
        rating,
        ratingRaw: rawRating,
        helpfulYes: toNumber(review?.helpfulYes, 0),
        helpfulNo: toNumber(review?.helpfulNo, 0),
        verifiedPurchase: toBoolean(review?.verifiedPurchase),
        hasRewarded: toBoolean(review?.hasRewarded),
        postedDate: toText(review?.postedDate),
        postedDateLocalized: toText(review?.postedDateLocalized),
        languageCode: toText(review?.languageCode),
        languageName: toText(review?.languageName),
        countryCode: toText(review?.countryCode),
        countryName: toText(review?.profileInfo?.country),
        customerNickname: toText(review?.customerNickname),
        customerProfileLink: toText(review?.customerProfileLink),
        reviewerUsername: toText(review?.profileInfo?.username),
        reviewerDisplayName: toText(review?.profileInfo?.displayname),
        reviewerReviewCount: toNumber(review?.profileInfo?.ugcSummary?.reviewCount, null),
        reviewerHelpfulCount: toNumber(review?.profileInfo?.ugcSummary?.helpfulCount, null),
        reviewerImageCount: toNumber(review?.profileInfo?.ugcSummary?.imageCount, null),
        reviewImageCount: reviewImages.length,
        reviewImages,
        hasReviewImages: reviewImages.length > 0,
        sortId: context.sortId,
        page: context.page,
        scrapedAt: new Date().toISOString(),
    });
}

const resolvedProductId = resolveProductIdFromInput(productId, productUrl);
if (!resolvedProductId) {
    throw new Error('Missing valid productId. Provide `productId` or a `productUrl` ending with numeric product ID.');
}

const maxReviewsLimit = Number(maxReviews);
if (!Number.isInteger(maxReviewsLimit) || maxReviewsLimit < 0) {
    throw new Error('maxReviews must be an integer greater than or equal to 0.');
}

const pageSizeLimit = Number(pageSize);
if (!Number.isInteger(pageSizeLimit) || pageSizeLimit < 1) {
    throw new Error('pageSize must be an integer greater than or equal to 1.');
}

const selectedSortId = resolveSortId(sortId, sortBy);
const selectedLanguageCode = toText(languageCode) || DEFAULT_LANGUAGE_CODE;
const selectedCountryCode = toText(countryCode);
const selectedWithImagesOnly = toBoolean(withImagesOnly);
const selectedWithCountryReview = toBoolean(withCountryReview);
const normalizedProductUrl = normalizeProductUrl(productUrl, resolvedProductId, productId);
const warmupProductUrl = buildWarmupProductUrl(productUrl, resolvedProductId, productId);
const hasProxyConfigurationInput = Object.prototype.hasOwnProperty.call(input, 'proxyConfiguration');
const primaryProxyConfiguration = await createOptionalProxyConfiguration(proxyConfig);
const fallbackProxyConfiguration = (!hasProxyConfigurationInput && Actor.isAtHome())
    ? await createOptionalProxyConfiguration({ useApifyProxy: true })
    : null;
const runStartedAt = Date.now();
const wantedReviews = maxReviewsLimit === 0 ? Number.POSITIVE_INFINITY : maxReviewsLimit;

log.info('Starting iHerb Reviews scraper (API-first Firefox session mode)', {
    productId: resolvedProductId,
    productUrl: normalizedProductUrl,
    warmupProductUrl,
    maxReviews: maxReviewsLimit,
    pageSize: pageSizeLimit,
    sortId: selectedSortId,
    languageCode: selectedLanguageCode,
    countryCode: selectedCountryCode,
    withImagesOnly: selectedWithImagesOnly,
    withCountryReview: selectedWithCountryReview,
    usesProxy: Boolean(primaryProxyConfiguration),
    hasProxyFallback: Boolean(fallbackProxyConfiguration),
});

const seenReviewIds = new Set();
let totalReviewsScraped = 0;
let pagesFetched = 0;
let finalErrorMessage = null;
let countryReviews = [];
let activeProxyConfiguration = primaryProxyConfiguration;

async function openReviewSession() {
    const launchOptions = { headless: true };
    const proxyUrl = activeProxyConfiguration ? await activeProxyConfiguration.newUrl() : null;

    if (proxyUrl) {
        const parsedProxy = new URL(proxyUrl);
        launchOptions.proxy = {
            server: `${parsedProxy.protocol}//${parsedProxy.hostname}${parsedProxy.port ? `:${parsedProxy.port}` : ''}`,
            username: parsedProxy.username ? decodeURIComponent(parsedProxy.username) : undefined,
            password: parsedProxy.password ? decodeURIComponent(parsedProxy.password) : undefined,
        };
    }

    const userAgent = getRandomUserAgent();
    const browser = await firefox.launch(launchOptions);
    const context = await browser.newContext({
        userAgent,
        locale: selectedLanguageCode,
        viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();

        if (
            resourceType === 'image' ||
            resourceType === 'font' ||
            resourceType === 'media' ||
            resourceType === 'stylesheet' ||
            url.includes('google-analytics') ||
            url.includes('googletagmanager') ||
            url.includes('doubleclick') ||
            url.includes('facebook') ||
            url.includes('adsense')
        ) {
            return route.abort();
        }

        return route.continue();
    });

    await page.goto(warmupProductUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(SESSION_WARMUP_WAIT_MS);

    return {
        browser,
        context,
        page,
        referer: page.url() || warmupProductUrl,
        pagesUsed: 0,
    };
}

async function closeReviewSession(session) {
    if (!session) return;
    await session.page?.close().catch(() => {});
    await session.context?.close().catch(() => {});
    await session.browser?.close().catch(() => {});
}

let session;

try {
    session = await openReviewSession();
    let pageNumber = 1;
    let totalSessionRotations = 0;
    let pageRotationAttempts = 0;

    while (totalReviewsScraped < wantedReviews) {
        if (!session) {
            session = await openReviewSession();
            totalSessionRotations += 1;
        }

        if (session.pagesUsed >= MAX_PAGES_PER_SESSION) {
            await closeReviewSession(session);
            session = await openReviewSession();
            totalSessionRotations += 1;
        }

        if (totalSessionRotations > MAX_TOTAL_SESSION_ROTATIONS) {
            throw new Error(`Exceeded maximum total session rotations (${MAX_TOTAL_SESSION_ROTATIONS}) while paginating reviews.`);
        }

        const endpoint = buildReviewsEndpoint({
            pid: resolvedProductId,
            page: pageNumber,
            size: pageSizeLimit,
            selectedSortId,
            selectedLanguageCode,
            selectedCountryCode,
            imagesOnly: selectedWithImagesOnly,
            includeCountryReview: selectedWithCountryReview,
        });

        let pageData;
        try {
            pageData = await fetchJsonWithRetry({
                apiRequestContext: session.context.request,
                endpoint,
                referer: session.referer,
                label: `Review API page ${pageNumber}`,
            });
        } catch (error) {
            finalErrorMessage = error?.message ?? String(error);

            if (finalErrorMessage.includes('status 403')) {
                pageRotationAttempts += 1;

                if (pageNumber === 1 && pageRotationAttempts >= 3 && !activeProxyConfiguration && fallbackProxyConfiguration) {
                    activeProxyConfiguration = fallbackProxyConfiguration;
                    log.warning('Repeated page 1 blocks detected without a configured proxy; switching to Apify Proxy fallback.', {
                        pageNumber,
                        pageRotationAttempts,
                    });
                }

                if (pageRotationAttempts > MAX_SESSION_ROTATIONS_PER_PAGE) {
                    throw new Error(`Page ${pageNumber} remained blocked after ${MAX_SESSION_ROTATIONS_PER_PAGE} session refresh attempts.`);
                }

                log.warning(`Session blocked on page ${pageNumber}; rotating session and retrying page.`, {
                    error: finalErrorMessage,
                    pageRotationAttempts,
                });
                await closeReviewSession(session);
                session = null;
                continue;
            }

            log.warning(`Review pagination stopped on page ${pageNumber}`, { error: finalErrorMessage });
            break;
        }

        finalErrorMessage = null;
    pageRotationAttempts = 0;
        session.pagesUsed += 1;
        pagesFetched += 1;

        const items = Array.isArray(pageData?.items) ? pageData.items : [];
        if (Array.isArray(pageData?.countryReviews) && countryReviews.length === 0) {
            countryReviews = pageData.countryReviews.map((entry) => stripEmptyFields({
                countryCode: toText(entry?.countryCode),
                countryName: toText(entry?.countryName),
                reviewCount: toNumber(entry?.reviewCount, 0),
                translatedReviewCount: toNumber(entry?.translatedReviewCount, 0),
                isDefault: toBoolean(entry?.isDefault),
            }));
        }

        if (items.length === 0) {
            log.info(`No reviews returned on page ${pageNumber}; stopping pagination.`);
            break;
        }

        const normalized = [];
        for (const rawReview of items) {
            const mapped = mapReview(rawReview, {
                productId: resolvedProductId,
                productUrl: normalizedProductUrl,
                sortId: selectedSortId,
                page: pageNumber,
            });

            const reviewId = toText(mapped.reviewId);
            if (!reviewId || seenReviewIds.has(reviewId)) continue;

            seenReviewIds.add(reviewId);
            normalized.push(mapped);

            if (totalReviewsScraped + normalized.length >= wantedReviews) break;
        }

        if (normalized.length > 0) {
            await Actor.pushData(normalized);
            totalReviewsScraped += normalized.length;
        }

        log.info(`Review page ${pageNumber} processed`, {
            fetchedItems: items.length,
            savedItems: normalized.length,
            totalReviewsScraped,
        });

        const reachedReviewsLimit = totalReviewsScraped >= wantedReviews;
        const reachedEndByPageSize = items.length < pageSizeLimit;
        if (reachedReviewsLimit || reachedEndByPageSize) break;

        await sleepRandom(MIN_PAGE_DELAY_MS, MAX_PAGE_DELAY_MS);
        pageNumber += 1;
    }

} catch (error) {
    finalErrorMessage = error?.message ?? String(error);
    log.error('Run failed while preparing Playwright review session.', { error: finalErrorMessage });
} finally {
    await closeReviewSession(session);
}

if (totalReviewsScraped === 0 && finalErrorMessage) {
    log.softFail('No reviews were scraped. Returning gracefully with diagnostics.', {
        productId: resolvedProductId,
        productUrl: normalizedProductUrl,
        error: finalErrorMessage,
    });
}

const durationSec = Math.round((Date.now() - runStartedAt) / 1000);
const statistics = stripEmptyFields({
    totalReviewsScraped,
    pagesFetched,
    extractionMethod: 'iHerb reviews API (Playwright Firefox session)',
    endpoint: `${API_HOST}/ugc/api/review/v2/search`,
    productId: resolvedProductId,
    productUrl: normalizedProductUrl,
    warmupProductUrl,
    sortId: selectedSortId,
    pageSize: pageSizeLimit,
    languageCode: selectedLanguageCode,
    countryCode: selectedCountryCode,
    withImagesOnly: selectedWithImagesOnly,
    withCountryReview: selectedWithCountryReview,
    countryReviewBuckets: countryReviews,
    lastError: finalErrorMessage ?? '',
    duration: `${durationSec} seconds`,
    timestamp: new Date().toISOString(),
});

await Actor.setValue('statistics', statistics);

log.info('Scraping completed', statistics);

await Actor.exit();
