/**
 * nanogpt_get_balance tool
 *
 * Check the current account balance (USD and Nano).
 */

import { z } from 'zod';
import { requestJson } from '../httpClient.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

// Input schema
export const inputSchema = z.object({
  include_raw: z.boolean().optional().default(false),
});

// Output schema
export const outputSchema = z.object({
  usd_balance: z.number(),
  nano_balance: z.number(),
  nano_deposit_address: z.union([z.string(), z.null()]).optional(),
  receivable: z.number().optional(),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

// JSON Schemas for MCP registration
export const inputJsonSchema = zodToJsonSchema(inputSchema);
export const outputJsonSchema = zodToJsonSchema(outputSchema);

// Tool metadata
export const name = 'nanogpt_get_balance';
export const description =
  'Check the current account balance (USD and Nano). Use before expensive operations to verify sufficient funds.';

// Annotations
export const annotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

interface BalanceResponse {
  usd_balance: string;
  nano_balance: string;
  nanoDepositAddress?: string;
  receivable?: number;
}

/**
 * Handler for nanogpt_get_balance
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);

    // Call NanoGPT API
    const response = await requestJson<BalanceResponse>({
      method: 'POST',
      path: '/api/check-balance',
    });

    const data = response.json;

    // Parse balance values
    const usdBalance = parseFloat(data.usd_balance);
    const nanoBalance = parseFloat(data.nano_balance);

    if (isNaN(usdBalance) || isNaN(nanoBalance)) {
      throw new Error('Invalid balance values received from API');
    }

    // Build output
    const output: Record<string, unknown> = {
      usd_balance: usdBalance,
      nano_balance: nanoBalance,
    };

    if (data.nanoDepositAddress) {
      output.nano_deposit_address = data.nanoDepositAddress;
    }
    if (data.receivable !== undefined) {
      output.receivable = data.receivable;
    }

    // Process raw response
    const { raw, resourceLink } = processRawResponse(
      { status: response.status, headers: response.headers, body: data },
      input.include_raw
    );
    if (raw !== undefined) {
      output.raw = raw;
    }

    // Build human-readable content
    const displayText = `Balance: $${usdBalance.toFixed(2)} USD, ${nanoBalance.toFixed(6)} XNO`;

    return {
      content: buildContent(displayText, resourceLink),
      structuredContent: output,
    };
  } catch (err) {
    return handleToolError(err);
  }
}
