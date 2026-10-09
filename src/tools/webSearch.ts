/**
 * nanogpt_web_search tool
 *
 * Search the web for current information using multiple providers:
 * - linkup: Default provider, supports standard/deep depth and richer output types
 * - tavily: Advanced search with answer generation, topic filtering
 * - exa: Neural/semantic search with content extraction
 * - kagi: Privacy-focused search with web/news/search modes
 * - perplexity: AI-powered search with domain/language filtering
 * - valyu: Aggregated web retrieval with configurable budgets
 * - brave: Brave Search API (web/news/images/video/local)
 */

import { z } from 'zod';
import { requestJson } from '../httpClient.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

// Input schema
export const inputSchema = z.object({
  // Required
  query: z.string().min(1).describe('The search query'),

  // Provider selection
  provider: z.enum(['linkup', 'tavily', 'exa', 'kagi', 'perplexity', 'valyu', 'brave']).optional()
    .describe('Web search provider to use. Default: linkup'),

  // Common options
  depth: z.enum(['standard', 'deep', 'fast', 'auto', 'neural']).optional()
    .describe('Search depth. fast/auto/neural only for Exa. Default: standard'),
  maxResults: z.number().int().min(1).max(100).optional()
    .describe('Maximum number of results to return (provider-specific limits apply)'),
  includeImages: z.boolean().optional()
    .describe('Include image results (Linkup, Tavily)'),
  includeImageDescriptions: z.boolean().optional()
    .describe('Include image descriptions (Tavily; requires includeImages=true)'),
  fromDate: z.string().optional()
    .describe('Start date filter (YYYY-MM-DD) for Linkup/Brave freshness ranges'),
  toDate: z.string().optional()
    .describe('End date filter (YYYY-MM-DD) for Linkup/Brave freshness ranges'),
  excludeDomains: z.array(z.string()).optional()
    .describe('Domains to exclude from results'),
  includeDomains: z.array(z.string()).optional()
    .describe('Only include results from these domains'),

  // Linkup-specific
  outputType: z.enum(['searchResults', 'sourcedAnswer', 'structured']).optional()
    .describe('Output format (Linkup only). Default: searchResults'),
  structuredOutputSchema: z.string().optional()
    .describe('JSON schema for structured output (Linkup only, requires outputType=structured)'),

  // Kagi-specific
  kagiSource: z.enum(['web', 'news', 'search']).optional()
    .describe('Kagi search mode: web (enriched), news, or search (full search API)'),

  // Tavily-specific
  includeAnswer: z.union([z.boolean(), z.enum(['basic', 'advanced'])]).optional()
    .describe('Include AI-generated answer (Tavily)'),
  includeRawContent: z.union([z.boolean(), z.enum(['markdown', 'text'])]).optional()
    .describe('Include raw page content (Tavily)'),
  topic: z.enum(['general', 'news', 'finance']).optional()
    .describe('Search topic category (Tavily)'),
  timeRange: z.enum(['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y']).optional()
    .describe('Time range filter (Tavily)'),
  chunksPerSource: z.number().int().min(1).max(3).optional()
    .describe('Chunks per source for deep search (Tavily, depth=deep only)'),
  country: z.string().optional()
    .describe('Country code for localized results (Tavily, Perplexity, Brave)'),

  // Exa-specific
  numResults: z.number().int().min(1).max(100).optional()
    .describe('Number of results to return (Exa)'),
  category: z.enum([
    'company', 'research paper', 'news', 'pdf', 'github',
    'tweet', 'personal site', 'people', 'financial report'
  ]).optional()
    .describe('Content category filter (Exa)'),
  userLocation: z.string().optional()
    .describe('User location (two-letter ISO country code) for Exa'),
  additionalQueries: z.array(z.string()).optional()
    .describe('Additional queries for Exa deep search'),
  startCrawlDate: z.string().optional()
    .describe('Earliest crawl date (YYYY-MM-DD) for Exa'),
  endCrawlDate: z.string().optional()
    .describe('Latest crawl date (YYYY-MM-DD) for Exa'),
  startPublishedDate: z.string().optional()
    .describe('Earliest publish date (YYYY-MM-DD) for Exa'),
  endPublishedDate: z.string().optional()
    .describe('Latest publish date (YYYY-MM-DD) for Exa'),
  includeText: z.string().optional()
    .describe('Text that must be included in Exa results'),
  excludeText: z.string().optional()
    .describe('Text to exclude from Exa results'),
  context: z.union([
    z.boolean(),
    z.object({ maxCharacters: z.number().int().positive().optional() })
  ]).optional()
    .describe('Include surrounding context (Exa)'),
  contents: z.object({
    text: z.union([
      z.boolean(),
      z.object({
        maxCharacters: z.number().int().positive().optional(),
        includeHtmlTags: z.boolean().optional(),
      })
    ]).optional(),
    highlights: z.object({
      numSentences: z.number().int().positive().optional(),
      highlightsPerUrl: z.number().int().positive().optional(),
      query: z.string().optional(),
    }).optional(),
    summary: z.object({
      query: z.string().optional(),
    }).optional(),
    livecrawl: z.enum(['never', 'fallback', 'always', 'preferred']).optional(),
    subpages: z.number().int().min(0).optional(),
  }).optional()
    .describe('Content extraction options (Exa)'),

  // Perplexity-specific
  maxTokensPerPage: z.number().int().positive().optional()
    .describe('Max tokens per page (Perplexity)'),
  searchDomainFilter: z.array(z.string()).optional()
    .describe('Domain allowlist/denylist, prefix with - to exclude (Perplexity)'),
  searchLanguageFilter: z.array(z.string()).optional()
    .describe('ISO 639-1 language codes to filter by (Perplexity)'),

  // Brave-specific
  count: z.number().int().min(0).max(20).optional()
    .describe('Number of Brave results to return (0-20)'),
  offset: z.number().int().min(0).max(9).optional()
    .describe('Brave pagination offset (0-9)'),
  safesearch: z.enum(['off', 'moderate', 'strict']).optional()
    .describe('Brave safesearch mode'),
  freshness: z.string().optional()
    .describe('Brave freshness filter (e.g. 2024-01-01to2024-02-01)'),
  searchLang: z.string().optional()
    .describe('Brave search language (search_lang)'),
  uiLang: z.string().optional()
    .describe('Brave UI language (ui_lang)'),
  extraSnippets: z.boolean().optional()
    .describe('Include extra snippets (Brave)'),
  spellcheck: z.boolean().optional()
    .describe('Enable spellcheck (Brave)'),
  goggles: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Brave goggles ruleset(s)'),

  // Valyu-specific
  searchType: z.enum(['all', 'web']).optional()
    .describe('Valyu search type'),
  fastMode: z.boolean().optional()
    .describe('Enable fast mode (Valyu)'),
  maxNumResults: z.number().int().min(1).max(50).optional()
    .describe('Max results for Valyu'),
  maxPrice: z.number().positive().optional()
    .describe('Max price per 1k results for Valyu'),
  relevanceThreshold: z.number().min(0).max(1).optional()
    .describe('Valyu relevance threshold (0-1)'),
  responseLength: z.union([
    z.number().int().positive(),
    z.enum(['short', 'medium', 'large', 'max'])
  ]).optional()
    .describe('Valyu response length'),
  countryCode: z.string().optional()
    .describe('Valyu 2-letter country code'),
  includedSources: z.array(z.string()).optional()
    .describe('Valyu included sources'),
  excludedSources: z.array(z.string()).optional()
    .describe('Valyu excluded sources'),
  urlOnly: z.boolean().optional()
    .describe('Valyu url-only mode'),
  valyuCategory: z.string().optional()
    .describe('Valyu category'),
  isToolCall: z.boolean().optional()
    .describe('Valyu tool-call mode'),

  // Debug
  include_raw: z.boolean().optional().default(false)
    .describe('Include raw API response for debugging'),
});

// Output schema
export const outputSchema = z.object({
  data: z.unknown(),
  metadata: z.record(z.unknown()),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

// JSON Schemas for MCP registration
export const inputJsonSchema = zodToJsonSchema(inputSchema);
export const outputJsonSchema = zodToJsonSchema(outputSchema);

// Tool metadata
export const name = 'nanogpt_web_search';
export const description =
  'Search the web using multiple providers. Providers: linkup (default), tavily (AI answers), exa (semantic/neural), kagi (privacy-focused), perplexity (AI-powered), valyu (aggregated), brave (Brave Search API). Each provider has unique features - see parameter descriptions.';

// Annotations
export const annotations = {
  readOnlyHint: false,
  openWorldHint: true,
};

interface WebSearchResponse {
  data?: unknown;
  metadata?: {
    query?: string;
    provider?: string;
    depth?: string;
    outputType?: string;
    timestamp?: string;
    cost?: number;
    kagiSource?: string;
  };
  // Provider-specific extras
  tavily?: {
    answer?: string;
    responseTime?: number | string;
    usage?: unknown;
    autoParameters?: unknown;
    requestId?: string;
  };
  exa?: {
    requestId?: string;
    resolvedSearchType?: string;
    searchType?: string;
    context?: unknown;
    costDollars?: number;
  };
  kagi?: {
    source?: string;
    meta?: unknown;
  };
  perplexity?: {
    requestId?: string;
  };
  valyu?: {
    requestId?: string;
  };
  error?: string;
}

/**
 * Handler for nanogpt_web_search
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);

    // Build request body with all parameters
    const requestBody: Record<string, unknown> = {
      query: input.query,
    };

    // Provider selection
    if (input.provider) requestBody.provider = input.provider;

    // Common options
    if (input.depth) requestBody.depth = input.depth;
    if (input.maxResults !== undefined) requestBody.maxResults = input.maxResults;
    if (input.includeImages !== undefined) requestBody.includeImages = input.includeImages;
    if (input.includeImageDescriptions !== undefined) requestBody.includeImageDescriptions = input.includeImageDescriptions;
    if (input.fromDate) requestBody.fromDate = input.fromDate;
    if (input.toDate) requestBody.toDate = input.toDate;
    if (input.excludeDomains) requestBody.excludeDomains = input.excludeDomains;
    if (input.includeDomains) requestBody.includeDomains = input.includeDomains;

    // Linkup-specific
    if (input.outputType) requestBody.outputType = input.outputType;
    if (input.structuredOutputSchema) requestBody.structuredOutputSchema = input.structuredOutputSchema;

    // Kagi-specific
    if (input.kagiSource) requestBody.kagiSource = input.kagiSource;

    // Tavily-specific
    if (input.includeAnswer !== undefined) requestBody.includeAnswer = input.includeAnswer;
    if (input.includeRawContent !== undefined) requestBody.includeRawContent = input.includeRawContent;
    if (input.topic) requestBody.topic = input.topic;
    if (input.timeRange) requestBody.timeRange = input.timeRange;
    if (input.chunksPerSource !== undefined) requestBody.chunksPerSource = input.chunksPerSource;
    if (input.country) requestBody.country = input.country;

    // Exa-specific
    if (input.numResults !== undefined) requestBody.numResults = input.numResults;
    if (input.category) requestBody.category = input.category;
    if (input.userLocation) requestBody.userLocation = input.userLocation;
    if (input.additionalQueries) requestBody.additionalQueries = input.additionalQueries;
    if (input.startCrawlDate) requestBody.startCrawlDate = input.startCrawlDate;
    if (input.endCrawlDate) requestBody.endCrawlDate = input.endCrawlDate;
    if (input.startPublishedDate) requestBody.startPublishedDate = input.startPublishedDate;
    if (input.endPublishedDate) requestBody.endPublishedDate = input.endPublishedDate;
    if (input.includeText) requestBody.includeText = input.includeText;
    if (input.excludeText) requestBody.excludeText = input.excludeText;
    if (input.context !== undefined) requestBody.context = input.context;
    if (input.contents) requestBody.contents = input.contents;

    // Perplexity-specific
    if (input.maxTokensPerPage !== undefined) requestBody.maxTokensPerPage = input.maxTokensPerPage;
    if (input.searchDomainFilter) requestBody.searchDomainFilter = input.searchDomainFilter;
    if (input.searchLanguageFilter) requestBody.searchLanguageFilter = input.searchLanguageFilter;

    // Brave-specific
    if (input.count !== undefined) requestBody.count = input.count;
    if (input.offset !== undefined) requestBody.offset = input.offset;
    if (input.safesearch) requestBody.safesearch = input.safesearch;
    if (input.freshness) requestBody.freshness = input.freshness;
    if (input.searchLang) requestBody.searchLang = input.searchLang;
    if (input.uiLang) requestBody.uiLang = input.uiLang;
    if (input.extraSnippets !== undefined) requestBody.extraSnippets = input.extraSnippets;
    if (input.spellcheck !== undefined) requestBody.spellcheck = input.spellcheck;
    if (input.goggles) requestBody.goggles = input.goggles;

    // Valyu-specific
    if (input.searchType) requestBody.searchType = input.searchType;
    if (input.fastMode !== undefined) requestBody.fastMode = input.fastMode;
    if (input.maxNumResults !== undefined) requestBody.maxNumResults = input.maxNumResults;
    if (input.maxPrice !== undefined) requestBody.maxPrice = input.maxPrice;
    if (input.relevanceThreshold !== undefined) requestBody.relevanceThreshold = input.relevanceThreshold;
    if (input.responseLength !== undefined) requestBody.responseLength = input.responseLength;
    if (input.countryCode) requestBody.countryCode = input.countryCode;
    if (input.includedSources) requestBody.includedSources = input.includedSources;
    if (input.excludedSources) requestBody.excludedSources = input.excludedSources;
    if (input.urlOnly !== undefined) requestBody.urlOnly = input.urlOnly;
    if (input.valyuCategory) requestBody.category = input.valyuCategory;
    if (input.isToolCall !== undefined) requestBody.isToolCall = input.isToolCall;

    // Call NanoGPT API - web search can take up to 5 minutes
    const response = await requestJson<WebSearchResponse>({
      method: 'POST',
      path: '/api/web',
      body: requestBody,
      timeoutMs: 300000, // 5 minutes
    });

    const data = response.json;
    const provider = data.metadata?.provider || input.provider || 'linkup';

    // Build output with provider-specific extras
    const output: Record<string, unknown> = {
      data: data.data,
      metadata: data.metadata || {},
    };

    // Include provider-specific response data
    if (data.tavily) output.tavily = data.tavily;
    if (data.exa) output.exa = data.exa;
    if (data.kagi) output.kagi = data.kagi;
    if (data.perplexity) output.perplexity = data.perplexity;
    if (data.valyu) output.valyu = data.valyu;

    // Process raw response
    const { raw, resourceLink } = processRawResponse(
      { status: response.status, headers: response.headers, body: data },
      input.include_raw
    );
    if (raw !== undefined) {
      output.raw = raw;
    }

    // Build human-readable content
    let displayText: string;
    const resultData = data.data;
    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

    if (Array.isArray(resultData)) {
      displayText = `[${providerLabel}] Found ${resultData.length} result(s) for: "${input.query}"`;

      // Show Tavily answer if present
      if (data.tavily?.answer) {
        displayText += `\n\nAnswer: ${String(data.tavily.answer).slice(0, 300)}`;
        if (String(data.tavily.answer).length > 300) displayText += '...';
      }

      // Add first few results as preview
      const preview = resultData.slice(0, 3);
      for (const item of preview) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj.title) {
            displayText += `\n- ${obj.title}`;
            if (obj.url) displayText += ` (${obj.url})`;
          }
        }
      }
      if (resultData.length > 3) {
        displayText += `\n... and ${resultData.length - 3} more`;
      }
    } else if (typeof resultData === 'object' && resultData !== null) {
      displayText = `[${providerLabel}] Search completed for: "${input.query}"\n${JSON.stringify(resultData, null, 2).slice(0, 500)}`;
    } else {
      displayText = `[${providerLabel}] Search completed for: "${input.query}"`;
    }

    // Add cost info if available
    if (data.metadata?.cost !== undefined && data.metadata.cost > 0) {
      displayText += `\n\nCost: $${data.metadata.cost.toFixed(4)}`;
    }

    return {
      content: buildContent(displayText, resourceLink),
      structuredContent: output,
    };
  } catch (err) {
    return handleToolError(err);
  }
}
