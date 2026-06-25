import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Actor } from 'apify';
import { firefox } from 'playwright';

import log from '@apify/log';

await Actor.init();

const API_HOST = 'https://pk.iherb.com';
const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 45000;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const DEFAULT_SORT_ID = 6;
const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_COUNTRY_CODE = '';
const DEFAULT_WITH_IMAGES_ONLY = false;
const MAX_PAGES_PER_SESSION = 3;
const MAX_TOTAL_SESSION_ROTATIONS = 100;
const MAX_SESSION_ROTATIONS_PER_PAGE = 6;
const SESSION_WARMUP_WAIT_MS = 600;
const SESSION_QUICK_WARMUP_WAIT_MS = 300;
const MIN_PAGE_DELAY_MS = 100;
const MAX_PAGE_DELAY_MS = 350;
const NAVIGATION_TIMEOUT_MS = 60000;

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media', 'stylesheet']);
const BLOCKED_URL_SNIPPETS = [
    'google-analytics',
    'googletagmanager',
    'doubleclick',
    'facebook',
    'adsense',
    'hotjar',
    'clarity.ms',
    'bing.com',
];

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
    const explicitId = toText(idInput).replace(/\D/g, '');
    const productIdForUrl = explicitId.length >= 4 ? explicitId : resolvedId;
    if (productIdForUrl) {
        return `https://www.iherb.com/pr/iherb-product/${productIdForUrl}`;
    }

    const normalized = normalizeProductUrl(urlInput, resolvedId, idInput);
    if (!normalized) return `https://www.iherb.com/pr/iherb-product/${resolvedId}`;

    try {
        const parsed = new URL(normalized);
        if (/iherb\.com$/i.test(parsed.hostname)) {
            parsed.hostname = 'www.iherb.com';
            parsed.search = '';
            parsed.hash = '';
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
    await new Promise((fulfill) => {
        setTimeout(fulfill, ms);
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

function extractProfileImageUrl(profileInfo) {
    const thumbnails = profileInfo?.image?.thumbnails;
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';

    const largest = thumbnails.reduce((best, thumbnail) => {
        const currentType = toNumber(thumbnail?.thumbnailTypeId, 0);
        const bestType = toNumber(best?.thumbnailTypeId, 0);
        return currentType > bestType ? thumbnail : best;
    }, thumbnails[0]);

    return toText(largest?.fullPath);
}

function buildReviewDedupKey(mapped, rawReview) {
    const reviewId = toText(mapped.reviewId) || toText(rawReview?.id);
    if (reviewId) return `id:${reviewId}`;

    const composite = [
        toText(mapped.postedDate),
        toText(mapped.reviewerUsername) || toText(mapped.customerProfileLink),
        toText(mapped.reviewText).slice(0, 200),
    ].join('|');

    return `composite:${composite}`;
}

function isValidReviewRecord(mapped) {
    const hasReviewId = Boolean(toText(mapped.reviewId));
    const hasReviewText = Boolean(toText(mapped.reviewText));
    const hasRating = mapped.rating !== null && mapped.rating !== undefined;

    return hasReviewId && (hasReviewText || hasRating);
}

function mapReview(review, context) {
    const rawRating = toNumber(review?.ratingValue, null);
    const rating = rawRating === null ? null : Number((rawRating / 10).toFixed(1));
    const reviewImages = extractImageUrls(review?.images);
    const displayName = toText(review?.profileInfo?.displayname) || toText(review?.customerNickname);
    const badge = review?.profileInfo?.badge;

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
        reviewerUsername: toText(review?.profileInfo?.username) || toText(review?.customerProfileLink),
        reviewerDisplayName: displayName,
        reviewerReviewCount: toNumber(review?.profileInfo?.ugcSummary?.reviewCount, null),
        reviewerHelpfulCount: toNumber(review?.profileInfo?.ugcSummary?.helpfulCount, null),
        reviewerImageCount: toNumber(review?.profileInfo?.ugcSummary?.imageCount, null),
        reviewerAnswerCount: toNumber(review?.profileInfo?.ugcSummary?.answerCount, null),
        reviewerBadgeName: toText(badge?.translation?.name) || toText(badge?.name),
        reviewerBadgeTitle: toText(badge?.translation?.title),
        reviewerProfileImage: extractProfileImageUrl(review?.profileInfo),
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

log.info('Starting iHerb Reviews scraper (Playwright Firefox session)', {
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

const seenReviewKeys = new Set();
let totalReviewsScraped = 0;
let pagesFetched = 0;
let duplicatesSkipped = 0;
let invalidReviewsSkipped = 0;
let finalErrorMessage = null;
let countryReviews = [];
let totalReviewCount = null;
let translatedTotalCount = null;
let activeProxyConfiguration = primaryProxyConfiguration;
let sharedBrowser = null;

function shouldAbortRequest(route) {
    const resourceType = route.request().resourceType();
    const url = route.request().url();

    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return true;
    return BLOCKED_URL_SNIPPETS.some((snippet) => url.includes(snippet));
}

async function ensureSharedBrowser(forceRelaunch = false) {
    if (forceRelaunch && sharedBrowser) {
        await sharedBrowser.close().catch(() => {});
        sharedBrowser = null;
    }

    if (!sharedBrowser || !sharedBrowser.isConnected()) {
        sharedBrowser = await firefox.launch({ headless: true });
    }

    return sharedBrowser;
}

async function buildBrowserContext(browser) {
    const userAgent = getRandomUserAgent();
    const contextOptions = {
        userAgent,
        locale: selectedLanguageCode,
        viewport: { width: 1366, height: 768 },
    };

    if (activeProxyConfiguration) {
        const proxyUrl = await activeProxyConfiguration.newUrl();
        const parsedProxy = new URL(proxyUrl);
        contextOptions.proxy = {
            server: `${parsedProxy.protocol}//${parsedProxy.hostname}${parsedProxy.port ? `:${parsedProxy.port}` : ''}`,
            username: parsedProxy.username ? decodeURIComponent(parsedProxy.username) : undefined,
            password: parsedProxy.password ? decodeURIComponent(parsedProxy.password) : undefined,
        };
    }

    return browser.newContext(contextOptions);
}

async function warmupContextPage(page, { quick = false } = {}) {
    await page.route('**/*', (route) => {
        if (shouldAbortRequest(route)) return route.abort();
        return route.continue();
    });

    await page.goto(warmupProductUrl, {
        waitUntil: quick ? 'commit' : 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
    });
    await sleep(quick ? SESSION_QUICK_WARMUP_WAIT_MS : SESSION_WARMUP_WAIT_MS);
}

async function openReviewSession({ quickWarmup = false, forceBrowserRelaunch = false } = {}) {
    const browser = await ensureSharedBrowser(forceBrowserRelaunch);
    const context = await buildBrowserContext(browser);
    const page = await context.newPage();

    await warmupContextPage(page, { quick: quickWarmup });

    return {
        browser,
        context,
        page,
        referer: page.url() || warmupProductUrl,
        pagesUsed: 0,
    };
}

async function closeReviewSession(session, { closeBrowser = false } = {}) {
    if (!session) return;
    await session.page?.close().catch(() => {});
    await session.context?.close().catch(() => {});

    if (closeBrowser && sharedBrowser) {
        await sharedBrowser.close().catch(() => {});
        sharedBrowser = null;
    }
}

async function rotateReviewSession(session, { forceBrowserRelaunch = false, quickWarmup = true } = {}) {
    await closeReviewSession(session);
    return openReviewSession({ quickWarmup, forceBrowserRelaunch });
}

async function fetchReviewPageData(pageNumber, existingSession) {
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

    let session = existingSession;
    if (!session) {
        session = await openReviewSession();
    }

    const pageData = await fetchJsonWithRetry({
        apiRequestContext: session.context.request,
        endpoint,
        referer: session.referer,
        label: `Review API page ${pageNumber}`,
    });

    return { pageData, session };
}

function capturePageMetadata(pageData) {
    if (totalReviewCount === null && pageData?.totalCount !== undefined) {
        totalReviewCount = toNumber(pageData.totalCount, null);
    }
    if (translatedTotalCount === null && pageData?.translatedTotalCount !== undefined) {
        translatedTotalCount = toNumber(pageData.translatedTotalCount, null);
    }

    if (Array.isArray(pageData?.countryReviews) && countryReviews.length === 0) {
        countryReviews = pageData.countryReviews.map((entry) => stripEmptyFields({
            countryCode: toText(entry?.countryCode),
            countryName: toText(entry?.countryName),
            reviewCount: toNumber(entry?.reviewCount, 0),
            translatedReviewCount: toNumber(entry?.translatedReviewCount, 0),
            isDefault: toBoolean(entry?.isDefault),
        }));
    }
}

function processReviewItems(items, pageNumber) {
    const normalized = [];

    for (const rawReview of items) {
        const mapped = mapReview(rawReview, {
            productId: resolvedProductId,
            productUrl: normalizedProductUrl,
            sortId: selectedSortId,
            page: pageNumber,
        });

        if (!isValidReviewRecord(mapped)) {
            invalidReviewsSkipped += 1;
            continue;
        }

        const dedupKey = buildReviewDedupKey(mapped, rawReview);
        if (seenReviewKeys.has(dedupKey)) {
            duplicatesSkipped += 1;
            continue;
        }

        seenReviewKeys.add(dedupKey);
        normalized.push(mapped);

        if (totalReviewsScraped + normalized.length >= wantedReviews) break;
    }

    return normalized;
}

let session;

try {
    let pageNumber = 1;
    let totalSessionRotations = 0;
    let pageRotationAttempts = 0;

    while (totalReviewsScraped < wantedReviews) {
        if (!session) {
            session = await openReviewSession({ quickWarmup: totalSessionRotations > 0 });
            totalSessionRotations += 1;
        }

        if (session.pagesUsed >= MAX_PAGES_PER_SESSION) {
            log.info(`Rotating browser context after ${session.pagesUsed} API pages to avoid PerimeterX blocks.`);
            session = await rotateReviewSession(session, { quickWarmup: true });
            totalSessionRotations += 1;
        }

        if (totalSessionRotations > MAX_TOTAL_SESSION_ROTATIONS) {
            throw new Error(`Exceeded maximum total session rotations (${MAX_TOTAL_SESSION_ROTATIONS}) while paginating reviews.`);
        }

        let pageData;
        try {
            const fetchResult = await fetchReviewPageData(pageNumber, session);
            pageData = fetchResult.pageData;
            session = fetchResult.session;
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

                log.warning(`Session blocked on page ${pageNumber}; rotating context and retrying immediately.`, {
                    error: finalErrorMessage,
                    pageRotationAttempts,
                });
                session = await rotateReviewSession(session, {
                    forceBrowserRelaunch: pageRotationAttempts % 2 === 0,
                    quickWarmup: true,
                });
                totalSessionRotations += 1;
                continue;
            }

            log.warning(`Review pagination stopped on page ${pageNumber}`, { error: finalErrorMessage });
            break;
        }

        finalErrorMessage = null;
        pageRotationAttempts = 0;
        if (session) session.pagesUsed += 1;
        pagesFetched += 1;
        capturePageMetadata(pageData);

        const items = Array.isArray(pageData?.items) ? pageData.items : [];
        if (items.length === 0) {
            log.info(`No reviews returned on page ${pageNumber}; stopping pagination.`);
            break;
        }

        const normalized = processReviewItems(items, pageNumber);

        if (normalized.length > 0) {
            await Actor.pushData(normalized);
            totalReviewsScraped += normalized.length;
        }

        log.info(`Review page ${pageNumber} processed`, {
            fetchedItems: items.length,
            savedItems: normalized.length,
            duplicatesSkipped,
            invalidReviewsSkipped,
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
    log.error('Run failed while fetching iHerb review data.', { error: finalErrorMessage });
} finally {
    await closeReviewSession(session, { closeBrowser: true });
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
    duplicatesSkipped,
    invalidReviewsSkipped,
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
    totalReviewCount,
    translatedTotalCount,
    countryReviewBuckets: countryReviews,
    lastError: finalErrorMessage ?? '',
    duration: `${durationSec} seconds`,
    timestamp: new Date().toISOString(),
});

await Actor.setValue('statistics', statistics);

log.info('Scraping completed', statistics);

await Actor.exit();
