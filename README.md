# NanoGPT MCP Server

[![npm](https://img.shields.io/npm/v/@nanogpt/mcp)](https://www.npmjs.com/package/@nanogpt/mcp)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI agents such as Claude Code, Codex, Cursor and Claude Desktop access to [NanoGPT](https://nano-gpt.com): chat with hundreds of text models, generate images, videos, 3D models, music and speech, search the web, scrape pages and more. Usage is billed pay-as-you-go to your NanoGPT balance; there is no subscription.

The server runs locally over stdio and calls the NanoGPT API with your API key.

## Quick start

1. Create an API key at [nano-gpt.com/api](https://nano-gpt.com/api).
2. Add the server to your MCP client (Node.js 22 or newer).

### Claude Code

```bash
claude mcp add nanogpt --scope user \
  --env NANOGPT_API_KEY=your_api_key \
  -- npx -y @nanogpt/mcp
```

On native Windows, launch `npx` through `cmd /c`:

```bash
claude mcp add nanogpt --scope user --env NANOGPT_API_KEY=your_api_key -- cmd /c npx -y @nanogpt/mcp
```

### Codex

```bash
codex mcp add nanogpt --env NANOGPT_API_KEY=your_api_key -- npx -y @nanogpt/mcp
```

### Cursor, Claude Desktop and other JSON-configured clients

```json
{
  "mcpServers": {
    "nanogpt": {
      "command": "npx",
      "args": ["-y", "@nanogpt/mcp"],
      "env": { "NANOGPT_API_KEY": "your_api_key" }
    }
  }
}
```

Then ask your agent, for example: *"Use NanoGPT to generate a 5 second video of a paper boat on a pond"* or *"Make a 3D model of a wooden chair with NanoGPT and give me the GLB link."*

## Tools

| Area | Tools |
|------|-------|
| Account | `nanogpt_get_balance` |
| Text | `nanogpt_chat`, `nanogpt_vision`, `nanogpt_embeddings`, `nanogpt_ai_detection` |
| Images | `nanogpt_image_generate`, `nanogpt_image_edit`, `nanogpt_ai_qr` |
| Video | `nanogpt_video_generate` |
| 3D | `nanogpt_3d_generate` |
| Audio | `nanogpt_text_to_speech`, `nanogpt_music_generate`, `nanogpt_audio_transcribe` |
| Web and research | `nanogpt_web_search`, `nanogpt_scrape_urls`, `nanogpt_firecrawl`, `nanogpt_youtube_transcribe`, `nanogpt_x_research`, `nanogpt_hunter` |
| Social and maps data | `nanogpt_reddit`, `nanogpt_google_maps_scrape`, `nanogpt_google_maps_reviews_scrape`, `nanogpt_facebook_ads`, `nanogpt_facebook_posts_scrape`, `nanogpt_instagram_profile`, `nanogpt_instagram_posts_scrape`, `nanogpt_instagram_reels`, `nanogpt_linkedin_profile`, `nanogpt_tiktok_scrape` |
| Model catalogs (free) | `nanogpt_list_text_models`, `nanogpt_list_image_models`, `nanogpt_list_video_models`, `nanogpt_list_3d_models`, `nanogpt_list_audio_models` |
| Feedback (free) | `nanogpt_send_feedback`, `nanogpt_get_feedback` |

Each tool describes its parameters to the agent through MCP, so the agent can call them without reading the API documentation.

### Video and 3D generation

Video and 3D jobs run asynchronously and usually take between 30 seconds and several minutes.

- `operation: "submit_and_poll"` submits the job and waits up to `timeout_ms` (default 50 seconds) for the result. Finished jobs return the video or GLB URL. The wait includes the submit request, but a submission that is still in progress is never cut short (aborting it could lose a job that was already accepted), so an unusually slow submission can take longer than `timeout_ms`.
- If the job is still running, the result contains its `runId`. Call the tool again with `operation: "poll"` and that `runId` to keep waiting, or `operation: "status"` for a single check.
- `operation: "submit"` only submits the job.

Many MCP clients stop a tool call after 60 seconds, so keep `timeout_ms` below your client's tool timeout and use `poll` for long jobs. Use `nanogpt_list_video_models` and `nanogpt_list_3d_models` to find model ids, prices and whether a model accepts text, images or both.

### Feedback

`nanogpt_send_feedback` sends a bug report, feature request, documentation issue or model-quality report to the NanoGPT team, and `nanogpt_get_feedback` reads its status and the team's latest reply. Reports are private and free, but the account (or the team that pays for it) needs a balance or an active subscription, and each account can send 20 a day. Ask your agent to report something, or let it report a reproducible NanoGPT problem that blocks its task. Reports never include your API key; don't put passwords, personal data or full prompts in them.

### Large outputs

Large responses (raw JSON, generated images and audio) are returned as `resource_link` items and can be read through MCP resources (`nanogpt://raw/{id}`, `nanogpt://image/{id}`, `nanogpt://media/{id}`). They are kept in memory until the cache is full (`NANOGPT_MAX_RESOURCE_CACHE_ITEMS`, oldest first) or the server exits, so save outputs you need. Pass `include_raw: true` to a tool to include the raw API response.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NANOGPT_API_KEY` | (required) | Your NanoGPT API key |
| `NANOGPT_BASE_URL` | `https://nano-gpt.com` | API base URL |
| `NANOGPT_AUTH_MODE` | `bearer` | `bearer`, `x-api-key` or `both` |
| `NANOGPT_TIMEOUT_MS` | `120000` | Default HTTP request timeout |
| `NANOGPT_DEFAULT_MODEL` | (none) | Default model for `nanogpt_chat` |
| `NANOGPT_VISION_MODEL` | `Qwen/Qwen3-VL-235B-A22B-Instruct` | Default model for `nanogpt_vision` |
| `NANOGPT_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` (logs go to stderr) |
| `NANOGPT_MAX_INLINE_JSON_CHARS` | `10000` | Larger raw responses are returned as resources |
| `NANOGPT_MAX_RESOURCE_CACHE_ITEMS` | `100` | Resources kept in memory |
| `NANOGPT_MAX_RESOURCE_BYTES` | `10485760` | Maximum size of a stored resource |
| `NANOGPT_SCRAPE_MAX_URLS` | `5` | Maximum URLs per `nanogpt_scrape_urls` call |

## Billing

Paid tools deduct from your NanoGPT balance at the prices shown on [nano-gpt.com](https://nano-gpt.com) and by the model listing tools. Model listings, `nanogpt_get_balance` and the feedback tools are free. A video or 3D job is charged when it is submitted, so prefer `poll` over submitting the same job again.

## Troubleshooting

- **`Missing required environment variables: NANOGPT_API_KEY`**: the key was not passed to the server. Check the `env` section or `--env` flag of your MCP client configuration.
- **`Invalid API key`** right after setup: check both the key and the launch command. On native Windows, use the `cmd /c` form shown above.
- **Tool calls time out**: lower `timeout_ms` for video and 3D tools and continue with `operation: "poll"`.
- If your client still runs an older `nanogpt` server entry, remove it and add it again.

More documentation: [docs.nano-gpt.com/integrations/mcp](https://docs.nano-gpt.com/integrations/mcp)

## Development

```bash
npm install
npm run build
npm test        # runs the server against a local mock of the NanoGPT API
```

`npm run dev` rebuilds on change. To try a local build in Claude Code:

```bash
claude mcp add nanogpt-dev --env NANOGPT_API_KEY=your_api_key -- node /path/to/nanogpt-mcp/dist/index.js
```

## License

[MIT](LICENSE)
