/**
 * NanoGPT application scraper tools.
 *
 * These tools expose paid NanoGPT application scraper endpoints through MCP.
 */

import { z } from 'zod';
import { requestJson } from '../httpClient.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

const startUrlSchema = z.union([
  z.string().min(1),
  z.object({ url: z.string().min(1) }).passthrough(),
]);

const socialProfilesSchema = z.object({
  facebooks: z.boolean().optional(),
  instagrams: z.boolean().optional(),
  youtubes: z.boolean().optional(),
  tiktoks: z.boolean().optional(),
  twitters: z.boolean().optional(),
}).passthrough();

const commonControlsSchema = z.object({
  maxTotalChargeUsd: z.number().positive().optional()
    .describe('Maximum billed USD charge allowed for this run. Required by the API for unbounded runs.'),
  waitForFinishSecs: z.number().int().min(5).max(240).optional()
    .describe('Maximum time to wait for the scraper run to finish. Default/maximum: 240.'),
  resultLimit: z.number().int().min(1).max(5000).optional()
    .describe('Maximum number of dataset items to return from the completed run.'),
  resultOffset: z.number().int().min(0).optional()
    .describe('Dataset item offset for pagination.'),
  clean: z.boolean().optional()
    .describe('Return Apify clean dataset items. Default: true.'),
  include_raw: z.boolean().optional().default(false)
    .describe('Include the raw NanoGPT API response for debugging. Large raw responses are returned as a resource link.'),
});

export const googleMapsInputSchema = commonControlsSchema.extend({
  searchStringsArray: z.array(z.string().min(1)).optional()
    .describe('Google Maps search terms, e.g. ["coffee shops in Amsterdam"].'),
  locationQuery: z.string().optional(),
  maxCrawledPlacesPerSearch: z.number().int().positive().optional()
    .describe('Limit places crawled per search term. Use this to keep search runs bounded.'),
  language: z.string().optional(),
  categoryFilterWords: z.array(z.string()).optional(),
  searchMatching: z.string().optional(),
  placeMinimumStars: z.string().optional(),
  website: z.string().optional(),
  skipClosedPlaces: z.boolean().optional(),
  scrapePlaceDetailPage: z.boolean().optional(),
  scrapeTableReservationProvider: z.boolean().optional(),
  includeWebResults: z.boolean().optional(),
  scrapeDirectories: z.boolean().optional(),
  maxQuestions: z.number().int().min(0).optional(),
  scrapeContacts: z.boolean().optional(),
  scrapeSocialMediaProfiles: socialProfilesSchema.optional(),
  maximumLeadsEnrichmentRecords: z.number().int().min(0).optional(),
  leadsEnrichmentDepartments: z.array(z.string()).optional(),
  verifyLeadsEnrichmentEmails: z.boolean().optional(),
  maxReviews: z.number().int().min(0).optional(),
  reviewsStartDate: z.string().optional(),
  reviewsSort: z.string().optional(),
  reviewsFilterString: z.string().optional(),
  reviewsOrigin: z.string().optional(),
  scrapeReviewsPersonalData: z.boolean().optional(),
  maxImages: z.number().int().min(0).optional(),
  scrapeImageAuthors: z.boolean().optional(),
  countryCode: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  county: z.string().optional(),
  postalCode: z.string().optional(),
  customGeolocation: z.record(z.unknown()).optional(),
  startUrls: z.array(startUrlSchema).optional()
    .describe('Google Maps place/list URLs. Strings or objects like { "url": "..." } are accepted.'),
  placeIds: z.array(z.string().min(1)).optional(),
  allPlacesNoSearchAction: z.string().optional(),
}).passthrough();

export const googleMapsReviewsInputSchema = commonControlsSchema.extend({
  startUrls: z.array(startUrlSchema).optional()
    .describe('Google Maps place URLs. Strings or objects like { "url": "..." } are accepted.'),
  placeIds: z.array(z.string().min(1)).optional(),
  maxReviews: z.number().int().positive().optional()
    .describe('Maximum reviews per place. Required to make estimates bounded unless maxTotalChargeUsd is set.'),
  reviewsSort: z.string().optional()
    .describe('Review sort mode. If reviewsStartDate is set, use newest.'),
  reviewsStartDate: z.string().optional(),
  language: z.string().optional(),
  reviewsOrigin: z.string().optional(),
  personalData: z.boolean().optional(),
}).passthrough();

export const instagramPostsInputSchema = commonControlsSchema.extend({
  username: z.array(z.string().min(1)).min(1)
    .describe('Instagram usernames, profile URLs, or post/reel/TV URLs. Usernames may include @.'),
  resultsLimit: z.number().int().positive().optional()
    .describe('Posts per profile. Required for bounded profile runs unless maxTotalChargeUsd is set.'),
  skipPinnedPosts: z.boolean().optional(),
  onlyPostsNewerThan: z.string().optional(),
  dataDetailLevel: z.enum(['basicData', 'detailedData']).optional(),
}).passthrough();

export const facebookPostsInputSchema = commonControlsSchema.extend({
  startUrls: z.array(startUrlSchema).min(1)
    .describe('Facebook page URLs to scrape. Strings or objects like { "url": "..." } are accepted.'),
  resultsLimit: z.number().int().positive().optional()
    .describe('Posts per page. Required for bounded runs unless maxTotalChargeUsd is set.'),
  captionText: z.boolean().optional()
    .describe('Include caption text in scraped post records.'),
  onlyPostsNewerThan: z.string().optional()
    .describe('Only return posts newer than this date/string accepted by the upstream scraper.'),
  onlyPostsOlderThan: z.string().optional()
    .describe('Only return posts older than this date/string accepted by the upstream scraper.'),
}).passthrough();

export const tiktokInputSchema = commonControlsSchema.extend({
  hashtags: z.array(z.string().min(1)).optional(),
  resultsPerPage: z.number().int().positive().optional(),
  profiles: z.array(z.string().min(1)).optional(),
  profileScrapeSections: z.array(z.string()).optional(),
  profileSorting: z.string().optional(),
  excludePinnedPosts: z.boolean().optional(),
  oldestPostDateUnified: z.string().optional(),
  newestPostDate: z.string().optional(),
  mostDiggs: z.number().int().positive().optional(),
  leastDiggs: z.number().int().positive().optional(),
  maxFollowersPerProfile: z.number().int().min(0).optional(),
  maxFollowingPerProfile: z.number().int().min(0).optional(),
  searchQueries: z.array(z.string().min(1)).optional(),
  searchSection: z.string().optional(),
  maxProfilesPerQuery: z.number().int().positive().optional(),
  videoSearchSorting: z.string().optional(),
  videoSearchDateFilter: z.string().optional(),
  postURLs: z.array(z.string().min(1)).optional(),
  scrapeRelatedVideos: z.boolean().optional(),
  shouldDownloadVideos: z.boolean().optional(),
  shouldDownloadCovers: z.boolean().optional(),
  shouldDownloadSlideshowImages: z.boolean().optional(),
  shouldDownloadAvatars: z.boolean().optional(),
  shouldDownloadMusicCovers: z.boolean().optional(),
  videoKvStoreIdOrName: z.string().optional(),
  downloadSubtitlesOptions: z.string().optional(),
  commentsPerPost: z.number().int().min(0).optional(),
  topLevelCommentsPerPost: z.number().int().min(0).optional(),
  maxRepliesPerComment: z.number().int().min(0).optional(),
  proxyCountryCode: z.string().optional(),
}).passthrough();

export const firecrawlInputSchema = commonControlsSchema.extend({
  operation: z.enum(['scrape', 'map', 'crawl']).optional()
    .describe('Firecrawl operation to run. Defaults are handled by the NanoGPT API.'),
  url: z.string().min(1).optional(),
  urls: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().optional(),
  formats: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).optional(),
}).passthrough();

export const redditInputSchema = commonControlsSchema.extend({
  startUrls: z.array(startUrlSchema).optional(),
  searches: z.array(z.string().min(1)).optional(),
  maxItems: z.number().int().positive().optional(),
  maxPostCount: z.number().int().positive().optional(),
  maxComments: z.number().int().min(0).optional(),
  searchPosts: z.boolean().optional(),
  searchComments: z.boolean().optional(),
  searchCommunities: z.boolean().optional(),
  searchUsers: z.boolean().optional(),
}).passthrough();

export const facebookAdsInputSchema = commonControlsSchema.extend({
  startUrls: z.array(startUrlSchema).optional(),
  resultsLimit: z.number().int().positive().optional(),
  activeStatus: z.string().optional(),
  onlyTotal: z.boolean().optional(),
  isDetailsPerAd: z.boolean().optional(),
}).passthrough();

export const instagramProfileInputSchema = commonControlsSchema.extend({
  usernames: z.array(z.string().min(1)).optional(),
  username: z.array(z.string().min(1)).optional(),
  includeAboutSection: z.boolean().optional(),
  resultsLimit: z.number().int().positive().optional(),
}).passthrough();

export const instagramReelsInputSchema = commonControlsSchema.extend({
  directUrls: z.array(startUrlSchema).optional(),
  username: z.array(z.string().min(1)).optional(),
  resultsLimit: z.number().int().positive().optional(),
  search: z.string().optional(),
  addParentData: z.boolean().optional(),
}).passthrough();

export const linkedinProfileInputSchema = commonControlsSchema.extend({
  profileUrls: z.array(startUrlSchema).optional(),
  usernames: z.array(z.string().min(1)).optional(),
  resultsLimit: z.number().int().positive().optional(),
}).passthrough();

const scraperOutputSchema = z.object({
  object: z.string().optional(),
  actor: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  status: z.string().optional(),
  runId: z.string().optional(),
  defaultDatasetId: z.string().optional(),
  items: z.array(z.unknown()),
  usage: z.record(z.unknown()),
  metadata: z.record(z.unknown()),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

export const googleMapsInputJsonSchema = zodToJsonSchema(googleMapsInputSchema);
export const googleMapsReviewsInputJsonSchema = zodToJsonSchema(googleMapsReviewsInputSchema);
export const facebookPostsInputJsonSchema = zodToJsonSchema(facebookPostsInputSchema);
export const instagramPostsInputJsonSchema = zodToJsonSchema(instagramPostsInputSchema);
export const tiktokInputJsonSchema = zodToJsonSchema(tiktokInputSchema);
export const firecrawlInputJsonSchema = zodToJsonSchema(firecrawlInputSchema);
export const redditInputJsonSchema = zodToJsonSchema(redditInputSchema);
export const facebookAdsInputJsonSchema = zodToJsonSchema(facebookAdsInputSchema);
export const instagramProfileInputJsonSchema = zodToJsonSchema(instagramProfileInputSchema);
export const instagramReelsInputJsonSchema = zodToJsonSchema(instagramReelsInputSchema);
export const linkedinProfileInputJsonSchema = zodToJsonSchema(linkedinProfileInputSchema);
export const outputJsonSchema = zodToJsonSchema(scraperOutputSchema);

export const googleMaps = {
  name: 'nanogpt_google_maps_scrape',
  description:
    'Scrape Google Maps places, place details, contacts, reviews, images, and lead enrichment through NanoGPT billing.',
  inputSchema: googleMapsInputSchema,
  inputJsonSchema: googleMapsInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/googlemaps',
    label: 'Google Maps',
    itemName: 'place',
    schema: googleMapsInputSchema,
  }),
};

export const googleMapsReviews = {
  name: 'nanogpt_google_maps_reviews_scrape',
  description:
    'Scrape Google Maps reviews, reviewer metadata, and structured review records through NanoGPT billing.',
  inputSchema: googleMapsReviewsInputSchema,
  inputJsonSchema: googleMapsReviewsInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/googlemaps/reviews',
    label: 'Google Maps reviews',
    itemName: 'review',
    schema: googleMapsReviewsInputSchema,
  }),
};

export const facebookPosts = {
  name: 'nanogpt_facebook_posts_scrape',
  description:
    'Scrape public Facebook page posts, captions, videos, reactions, images, links, and metadata through NanoGPT billing.',
  inputSchema: facebookPostsInputSchema,
  inputJsonSchema: facebookPostsInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/facebook/posts',
    label: 'Facebook posts',
    itemName: 'post',
    schema: facebookPostsInputSchema,
  }),
};

export const instagramPosts = {
  name: 'nanogpt_instagram_posts_scrape',
  description:
    'Scrape Instagram posts, reels, captions, media metadata, and engagement data through NanoGPT billing.',
  inputSchema: instagramPostsInputSchema,
  inputJsonSchema: instagramPostsInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/instagram/posts',
    label: 'Instagram posts',
    itemName: 'post',
    schema: instagramPostsInputSchema,
  }),
};

export const tiktok = {
  name: 'nanogpt_tiktok_scrape',
  description:
    'Scrape TikTok hashtags, profiles, searches, video URLs, comments, subtitles, media downloads, and metadata through NanoGPT billing.',
  inputSchema: tiktokInputSchema,
  inputJsonSchema: tiktokInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/tiktok',
    label: 'TikTok',
    itemName: 'item',
    schema: tiktokInputSchema,
  }),
};

export const firecrawl = {
  name: 'nanogpt_firecrawl',
  description:
    'Scrape, map, or crawl websites through NanoGPT Firecrawl billing.',
  inputSchema: firecrawlInputSchema,
  inputJsonSchema: firecrawlInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/firecrawl',
    label: 'Firecrawl',
    itemName: 'item',
    schema: firecrawlInputSchema,
  }),
};

export const reddit = {
  name: 'nanogpt_reddit',
  description:
    'Scrape Reddit posts, comments, communities, users, and search results through NanoGPT billing.',
  inputSchema: redditInputSchema,
  inputJsonSchema: redditInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/reddit',
    label: 'Reddit',
    itemName: 'item',
    schema: redditInputSchema,
  }),
};

export const facebookAds = {
  name: 'nanogpt_facebook_ads',
  description:
    'Scrape Facebook Ads Library entries, campaign metadata, creative details, and advertiser pages through NanoGPT billing.',
  inputSchema: facebookAdsInputSchema,
  inputJsonSchema: facebookAdsInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/facebook/ads',
    label: 'Facebook ads',
    itemName: 'ad',
    schema: facebookAdsInputSchema,
  }),
};

export const instagramProfile = {
  name: 'nanogpt_instagram_profile',
  description:
    'Scrape public Instagram profile metadata and optional about-section data through NanoGPT billing.',
  inputSchema: instagramProfileInputSchema,
  inputJsonSchema: instagramProfileInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/instagram/profile',
    label: 'Instagram profile',
    itemName: 'profile',
    schema: instagramProfileInputSchema,
  }),
};

export const instagramReels = {
  name: 'nanogpt_instagram_reels',
  description:
    'Scrape Instagram reels, captions, media metadata, and engagement data through NanoGPT billing.',
  inputSchema: instagramReelsInputSchema,
  inputJsonSchema: instagramReelsInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/instagram/reels',
    label: 'Instagram reels',
    itemName: 'reel',
    schema: instagramReelsInputSchema,
  }),
};

export const linkedinProfile = {
  name: 'nanogpt_linkedin_profile',
  description:
    'Scrape public LinkedIn profile data through NanoGPT billing.',
  inputSchema: linkedinProfileInputSchema,
  inputJsonSchema: linkedinProfileInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: makeScraperHandler({
    path: '/api/v1/linkedin/profile',
    label: 'LinkedIn profile',
    itemName: 'profile',
    schema: linkedinProfileInputSchema,
  }),
};

type ScraperResponse = {
  object?: string;
  actor?: string;
  name?: string;
  model?: string;
  status?: string;
  runId?: string;
  defaultDatasetId?: string;
  items?: unknown[];
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function makeScraperHandler({
  path,
  label,
  itemName,
  schema,
}: {
  path: string;
  label: string;
  itemName: string;
  schema: z.ZodTypeAny;
}) {
  return async function handler(args: unknown) {
    try {
      const input = schema.parse(args) as Record<string, unknown> & { include_raw?: boolean };
      const { include_raw: includeRaw, ...requestBody } = input;

      const response = await requestJson<ScraperResponse>({
        method: 'POST',
        path,
        body: requestBody,
        timeoutMs: getScraperTimeoutMs(requestBody),
      });

      const data = response.json;
      const items = Array.isArray(data.items) ? data.items : [];
      const usage = data.usage || {};
      const metadata = data.metadata || {};

      const output: Record<string, unknown> = {
        object: data.object,
        actor: data.actor,
        name: data.name,
        model: data.model,
        status: data.status,
        runId: data.runId,
        defaultDatasetId: data.defaultDatasetId,
        items,
        usage,
        metadata,
      };

      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: data },
        includeRaw
      );
      if (raw !== undefined) output.raw = raw;

      return {
        content: buildContent(formatScraperDisplayText(label, itemName, data, items), resourceLink),
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  };
}

function getScraperTimeoutMs(requestBody: Record<string, unknown>): number {
  const waitForFinishSecs = typeof requestBody.waitForFinishSecs === 'number'
    ? requestBody.waitForFinishSecs
    : 240;
  return (waitForFinishSecs * 1000) + 30_000;
}

function formatScraperDisplayText(
  label: string,
  itemName: string,
  data: ScraperResponse,
  items: unknown[]
): string {
  const plural = items.length === 1 ? itemName : `${itemName}s`;
  let text = `${label} scrape returned ${items.length} ${plural}.`;

  if (data.status) text += ` Status: ${data.status}.`;
  if (data.runId) text += ` Run ID: ${data.runId}.`;

  const usage = data.usage || {};
  const actualCostUsd = typeof usage.actualCostUsd === 'number' ? usage.actualCostUsd : undefined;
  const estimatedMaxChargeUsd = typeof usage.estimatedMaxChargeUsd === 'number'
    ? usage.estimatedMaxChargeUsd
    : undefined;
  if (actualCostUsd !== undefined) text += ` Actual cost: $${actualCostUsd.toFixed(6)}.`;
  if (estimatedMaxChargeUsd !== undefined) text += ` Estimated max charge: $${estimatedMaxChargeUsd.toFixed(6)}.`;

  const preview = items.slice(0, 3).map((item, index) => summarizeItem(item, index + 1));
  if (preview.length > 0) {
    text += `\n\nPreview:\n${preview.join('\n')}`;
  }

  return text;
}

function summarizeItem(item: unknown, index: number): string {
  if (!item || typeof item !== 'object') {
    return `- ${index}: ${String(item)}`;
  }

  const obj = item as Record<string, unknown>;
  const candidateKeys = [
    'title',
    'name',
    'text',
    'caption',
    'shortCode',
    'url',
    'postUrl',
    'videoUrl',
    'placeId',
    'reviewId',
    'username',
  ];
  const parts = candidateKeys
    .map((key) => {
      const value = obj[key];
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const text = String(value).replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return `${key}: ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`;
    })
    .filter((part): part is string => Boolean(part))
    .slice(0, 3);

  if (parts.length > 0) return `- ${index}: ${parts.join(', ')}`;

  const keys = Object.keys(obj).slice(0, 8);
  return `- ${index}: ${keys.length ? `fields: ${keys.join(', ')}` : 'empty object'}`;
}
