import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';

import log from '@apify/log';

await Actor.init();

const API_HOST = 'https://pk.iherb.com';
const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 30000;
const DEFAULT_SORT_ID = 6;
const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_COUNTRY_CODE = '';
const DEFAULT_WITH_IMAGES_ONLY = false;
const PAGE_SIZE = 20;
const MIN_PAGE_DELAY_MS = 300;
const MAX_PAGE_DELAY_MS = 900;
const RETRY_BASE_DELAY_MS = 2000;
const BLOCK_RETRY_BASE_DELAY_MS = 4000;
const ADAPTIVE_DELAY_STEP_MS = 2500;
const ADAPTIVE_DELAY_MAX_MS = 10000;
const MAX_CONSECUTIVE_PARTIAL_PAGES = 3;
const MAX_NO_PROGRESS_PAGES = 5;

const SORT_ID_MAP = {
    mostRecent: 6,
    newest: 6,
    recent: 6,
    oldest: 7,
    helpful: 4,
    highestRating: 1,
    lowestRating: 2,
};

const API_HEADERS = {
    accept: 'application/json',
    'user-agent': 'okhttp/4.12.0',
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
        // Ignore local input fallback errors.
    }

    return runtimeInput;
}

const input = await loadInput();
const {
    productUrl = '',
    productId = '',
    maxReviews = 20,
    sortBy = '',
    sortId = null,
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

async function rawFetch({ endpoint, proxyUrl }) {
    const response = await gotScraping.get(endpoint, {
        headers: API_HEADERS,
        proxyUrl,
        http2: false,
        useHeaderGenerator: false,
        timeout: { request: API_TIMEOUT_MS },
        retry: { limit: 0 },
    });

    return typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
}

function isBlockResponse(body) {
    return typeof body === 'string'
        && (body.includes('blockScript') || body.includes('jsClientSrc') || body.includes('altBlockScript'));
}

async function fetchPageWithRecovery({ endpoint, getProxyUrl, label }) {
    let lastError = null;
    let retryCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let proxyUrl;
        if (getProxyUrl) {
            proxyUrl = await getProxyUrl();
        }

        let body;
        try {
            body = await rawFetch({ endpoint, proxyUrl });
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                retryCount += 1;
                const waitMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
                log.warning(`Retrying ${label} in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`, {
                    error: error?.message,
                });
                await sleep(waitMs);
            }
            continue;
        }

        if (isBlockResponse(body)) {
            lastError = new Error(`${label} blocked by anti-bot protection (PerimeterX).`);
            if (attempt < MAX_RETRIES) {
                retryCount += 1;
                const waitMs = BLOCK_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
                log.warning(`Anti-bot block on ${label}; retrying with fresh proxy in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(waitMs);
            }
            continue;
        }

        let json;
        try {
            json = JSON.parse(body);
        } catch {
            lastError = new Error(`${label} returned non-JSON response.`);
            if (attempt < MAX_RETRIES) {
                retryCount += 1;
                const waitMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
                log.warning(`Non-JSON response from ${label}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(waitMs);
            }
            continue;
        }

        const items = Array.isArray(json?.items) ? json.items : [];

        if (items.length === 0) {
            const reportedZero = toNumber(json?.translatedTotalCount, null) === 0 || toNumber(json?.totalCount, null) === 0;
            if (reportedZero || attempt >= MAX_RETRIES) {
                return { json, items, empty: true, retryCount };
            }
            retryCount += 1;
            lastError = new Error(`${label} returned empty items (possible transient throttling).`);
            const waitMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
            log.warning(`Empty response from ${label}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(waitMs);
            continue;
        }

        return { json, items, empty: false, retryCount };
    }

    return { error: lastError ?? new Error(`Failed to fetch ${label}.`), retryCount };
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

const selectedSortId = resolveSortId(sortId, sortBy);
const selectedLanguageCode = toText(languageCode) || DEFAULT_LANGUAGE_CODE;
const selectedCountryCode = toText(countryCode);
const selectedWithImagesOnly = toBoolean(withImagesOnly);
const selectedWithCountryReview = toBoolean(withCountryReview);
const normalizedProductUrl = normalizeProductUrl(productUrl, resolvedProductId, productId);
const proxyConfiguration = await createOptionalProxyConfiguration(proxyConfig);
const runStartedAt = Date.now();
const wantedReviews = maxReviewsLimit === 0 ? Number.POSITIVE_INFINITY : maxReviewsLimit;

log.info('Starting iHerb Reviews scraper (API via got-scraping)', {
    productId: resolvedProductId,
    productUrl: normalizedProductUrl,
    maxReviews: maxReviewsLimit,
    pageSize: PAGE_SIZE,
    sortId: selectedSortId,
    languageCode: selectedLanguageCode,
    countryCode: selectedCountryCode,
    withImagesOnly: selectedWithImagesOnly,
    withCountryReview: selectedWithCountryReview,
    usesProxy: Boolean(proxyConfiguration),
});

const seenReviewKeys = new Set();
let totalReviewsScraped = 0;
let pagesFetched = 0;
let duplicatesSkipped = 0;
let invalidReviewsSkipped = 0;
let recoveryRetries = 0;
let adaptiveDelayMs = 0;
let consecutivePartialPages = 0;
let noProgressPages = 0;
let effectivePageSize = 0;
let finalErrorMessage = null;
let countryReviews = [];
let totalReviewCount = null;
let translatedTotalCount = null;
let effectiveAvailableCount = null;

function capturePageMetadata(pageData) {
    if (totalReviewCount === null && pageData?.totalCount !== undefined) {
        totalReviewCount = toNumber(pageData.totalCount, null);
    }
    if (translatedTotalCount === null && pageData?.translatedTotalCount !== undefined) {
        translatedTotalCount = toNumber(pageData.translatedTotalCount, null);
    }

    if (translatedTotalCount !== null || totalReviewCount !== null) {
        effectiveAvailableCount = translatedTotalCount ?? totalReviewCount;
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

try {
    let pageNumber = 1;

    const getProxyUrl = proxyConfiguration
        ? async () => proxyConfiguration.newUrl()
        : null;

    while (totalReviewsScraped < wantedReviews) {
        const endpoint = buildReviewsEndpoint({
            pid: resolvedProductId,
            page: pageNumber,
            size: PAGE_SIZE,
            selectedSortId,
            selectedLanguageCode,
            selectedCountryCode,
            imagesOnly: selectedWithImagesOnly,
            includeCountryReview: selectedWithCountryReview,
        });

        const result = await fetchPageWithRecovery({
            endpoint,
            getProxyUrl,
            label: `Review API page ${pageNumber}`,
        });

        recoveryRetries += result.retryCount;

        if (result.error) {
            finalErrorMessage = result.error?.message ?? String(result.error);
            log.warning(`Review pagination stopped on page ${pageNumber}`, { error: finalErrorMessage });
            break;
        }

        pagesFetched += 1;
        capturePageMetadata(result.json);

        const { items, empty } = result;
        if (empty) {
            log.info(`No reviews returned on page ${pageNumber} after retries; stopping pagination.`);
            break;
        }

        // The iHerb API caps `limit` at 20, so PAGE_SIZE is fixed internally.
        // Adopt the largest batch actually observed so full batches are not mistaken
        // for throttled partial pages.
        if (items.length > effectivePageSize) {
            effectivePageSize = items.length;
        }

        const normalized = processReviewItems(items, pageNumber);

        if (normalized.length > 0) {
            await Actor.pushData(normalized);
            totalReviewsScraped += normalized.length;
        }

        const isFullPage = effectivePageSize > 0 && items.length >= effectivePageSize;
        if (isFullPage) {
            consecutivePartialPages = 0;
        }

        log.info(`Review page ${pageNumber} processed`, {
            fetchedItems: items.length,
            savedItems: normalized.length,
            duplicatesSkipped,
            invalidReviewsSkipped,
            totalReviewsScraped,
        });

        const reachedReviewsLimit = totalReviewsScraped >= wantedReviews;
        const reachedReportedTotal = effectiveAvailableCount !== null && totalReviewsScraped >= effectiveAvailableCount;
        if (reachedReviewsLimit || reachedReportedTotal) break;

        if (!isFullPage) {
            consecutivePartialPages += 1;
            adaptiveDelayMs = Math.min(adaptiveDelayMs + ADAPTIVE_DELAY_STEP_MS, ADAPTIVE_DELAY_MAX_MS);
            if (consecutivePartialPages >= MAX_CONSECUTIVE_PARTIAL_PAGES) {
                finalErrorMessage = `Review API kept returning partial pages (${consecutivePartialPages} consecutive); possible throttling.`;
                log.warning(`Review pagination stopped on page ${pageNumber}`, { error: finalErrorMessage });
                break;
            }
        } else {
            adaptiveDelayMs = Math.max(0, adaptiveDelayMs - 500);
        }

        if (items.length > 0 && normalized.length === 0) {
            noProgressPages += 1;
        } else {
            noProgressPages = 0;
        }
        if (noProgressPages >= MAX_NO_PROGRESS_PAGES) {
            finalErrorMessage = `No new unique reviews for ${noProgressPages} consecutive pages; pagination not advancing.`;
            log.warning(`Review pagination stopped on page ${pageNumber}`, { error: finalErrorMessage });
            break;
        }

        await sleepRandom(MIN_PAGE_DELAY_MS, MAX_PAGE_DELAY_MS);
        if (adaptiveDelayMs > 0) await sleep(adaptiveDelayMs);
        pageNumber += 1;
    }
} catch (error) {
    finalErrorMessage = error?.message ?? String(error);
    log.error('Run failed while fetching iHerb review data.', { error: finalErrorMessage });
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
    extractionMethod: 'iHerb reviews API (got-scraping, okhttp headers)',
    endpoint: `${API_HOST}/ugc/api/review/v2/search`,
    productId: resolvedProductId,
    productUrl: normalizedProductUrl,
    sortId: selectedSortId,
    pageSize: PAGE_SIZE,
    languageCode: selectedLanguageCode,
    countryCode: selectedCountryCode,
    withImagesOnly: selectedWithImagesOnly,
    withCountryReview: selectedWithCountryReview,
    totalReviewCount,
    translatedTotalCount,
    recoveryRetries,
    countryReviewBuckets: countryReviews,
    lastError: finalErrorMessage ?? '',
    duration: `${durationSec} seconds`,
    timestamp: new Date().toISOString(),
});

await Actor.setValue('statistics', statistics);

log.info('Scraping completed', statistics);

await Actor.exit();
