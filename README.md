# Any-API MCP Server Template

A minimal, configurable Model Context Protocol (MCP) server you can use to adapt any HTTP API into an MCP toolset. It focuses on safety, clarity, and fast onboarding.

## What You Get
- Generic HTTP tools: `api_probe`, `api_get`, `api_post`, `api_put`, `api_delete`
- Pluggable auth (header, bearer, basic, query param)
- Safe defaults: retries for GET only, rate-limit awareness (Retry-After), STDERR logging with redaction
- Zero-boilerplate startup via STDIO (MCP)
- TypeScript, strict mode, ESM

## Why These Defaults

An agent will call whatever tools you give it, as often as it likes. These defaults keep a new integration safe before you've learned the API's quirks:

- **Retries on reads only.** A `GET` that hits 429, 502, 503 or 504 is retried up to 3 times with exponential backoff and jitter. Writes are never retried, because repeating a `POST` can create a duplicate record or charge twice.
- **Respect the server's rate limit.** When the API sends `Retry-After`, the server waits that long instead of guessing, so the agent backs off the way the API asked.
- **Writes are off by default.** `api_post`, `api_put`, `api_delete` and any generated write tools refuse until you set `ALLOW_DESTRUCTIVE=true`. You can explore a new API read-only first.
- **Logs never hold secrets.** Each request is logged to STDERR as one JSON line, with any query parameter named like key, token, secret or password replaced by `REDACTED`.

Each of these is covered by a test in `test/`.

## Quick Start

1) Use this repo as your starting point:
- This repository root **is** the template — there is no separate `templates/` subdirectory to copy from.
- Clone it, then rename/fork it for your own project (e.g. `mcp-any-api`).

2) Install and build
```bash
npm ci
npm run build
```

3) Configure environment (two simple options)
Option A — API key/token you already have:
Create `.env.local` (auto-loaded by scripts) with your API details:
```bash
API_BASE=https://api.example.com/v1
AUTH_MODE=bearer              # one of: none|bearer|header|basic|query
AUTH_TOKEN=YOUR_TOKEN         # bearer token or header value depending on mode
AUTH_HEADER=Authorization     # used if AUTH_MODE=header (default Authorization)
AUTH_QUERY_KEY=api_key        # used if AUTH_MODE=query
ALLOW_DESTRUCTIVE=false       # guard writes
```

Option B — OAuth 2.0 (automated helpers):

Client Credentials (service-to-service):
```bash
TOKEN_URL=https://auth.example.com/oauth/token \
CLIENT_ID=... CLIENT_SECRET=... SCOPE="api.read api.write" \
npm run oauth2:client
```
This writes AUTH_MODE/AUTH_TOKEN into `.env.local`.

Device Code (user sign-in on a second device):
```bash
DEVICE_AUTH_URL=https://auth.example.com/oauth/device/code \
TOKEN_URL=https://auth.example.com/oauth/token \
CLIENT_ID=... SCOPE="api.read" \
npm run oauth2:device
```
Follow the printed verification URL and code. Upon success, the script updates `.env.local`.
```

4) Run in dev
```bash
npm run dev
```

5) Add to your MCP client (example Claude Desktop)
```json
{
  "mcpServers": {
    "any-api": {
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"],
      "env": {
        "API_BASE": "https://api.example.com/v1",
        "AUTH_MODE": "bearer",
        "AUTH_TOKEN": "YOUR_TOKEN",
        "ALLOW_DESTRUCTIVE": "false"
      }
    }
  }
}
```

## Tools

- `api_probe` (safe):
  - Inputs: `path` (string), `method` (string), optional `headers` (record)
  - Executes a single request and returns status, content-type, body preview (first N bytes)
- `api_get` (safe):
  - Inputs: `path`, optional `query` (record), optional `headers`
  - Retries on `429/502/503/504` with backoff; honors `Retry-After`
- `api_post` (guarded), `api_put` (guarded), `api_delete` (guarded):
  - Inputs: `path`, optional `payload` (any), optional `headers`
  - DELETE supports optional payload if API expects a body

All tools auto-join `API_BASE` with `path` and attach auth based on `AUTH_MODE`.

## Auth Modes
- `none`: no auth header
- `bearer`: `Authorization: Bearer <AUTH_TOKEN>`
- `header`: `<AUTH_HEADER>: <AUTH_TOKEN>`
- `basic`: `Authorization: Basic <AUTH_TOKEN>` (you provide base64)
- `query`: appends `?<AUTH_QUERY_KEY>=<AUTH_TOKEN>` (or `&` when query exists)

## Rate Limiting
- GETs retry on `429/502/503/504` using exponential backoff with jitter
- `Retry-After` header is honored when present
- Scripts accept `PROBE_DELAY_MS` to pace probes

## Examples

Probe a path safely:
```json
{
  "path": "/users",
  "method": "OPTIONS"
}
```

GET with query:
```json
{
  "path": "/search",
  "query": { "q": "widgets", "page": 2 }
}
```

POST (guarded):
```json
{
  "path": "/widgets",
  "payload": { "name": "Example", "price": 100 }
}
```

## Customizing
- Add typed, domain-specific tools by creating new handlers in `src/server.ts`
- Keep `ALLOW_DESTRUCTIVE=false` until you’re ready to allow writes
- To support OAuth2 flows, fetch tokens outside the server and set `AUTH_MODE=bearer` with `AUTH_TOKEN`

## Scripts
- `npm run validate:endpoints` (safe): probes a set of paths/methods via GET/OPTIONS; pacing + Retry-After; dynamic delay adaptation
- `npm run probe:get` (safe): throttled GET probe for a given list
- `npm run discover:openapi` (safe): tries common OpenAPI/Swagger URLs, lists endpoints/methods, and saves raw spec
- `npm run scan:wordlist` (safe): OPTIONS-scan using a small default wordlist or a provided file; dynamic delay adaptation
- `npm run inventory:api` (safe): one-command inventory; tries OpenAPI first, then wordlist; writes JSON to `reports/`
- `npm run openapi:to:tools` (safe): converts an OpenAPI JSON file to `tools.json` for dynamic tool registration
- `npm run scan:to:tools` (safe): converts a wordlist scan report to `tools.json`
- `npm run oauth2:client` / `npm run oauth2:device`: obtain OAuth tokens and update `.env.local`

Environment knobs:
- `PROBE_DELAY_MS`: pacing between requests (default 800–1500ms)
- `OUTPUT` / `OUTPUT_DIR`: where to save reports
- `WORDLIST`: path to a custom wordlist (for `scan:wordlist`)

All scripts auto-load `.env.local`.

## Dynamic Tools (No Code Changes)

This server auto-registers tools from `tools.json` (if present in the working directory). You can generate `tools.json` from discovery output:

From OpenAPI:
```bash
OPENAPI_FILE=reports/openapi_*.json TOOLS_FILE=tools.json npm run openapi:to:tools
```

From wordlist scan:
```bash
SCAN_FILE=reports/wordlist_*.json TOOLS_FILE=tools.json npm run scan:to:tools
```

Once `tools.json` exists, restart the server and the generated tools are available automatically. GET tools are safe; mutating tools are guarded (require `ALLOW_DESTRUCTIVE=true`).

### Example: Hexnode API

Use the provided example tools file and Hexnode credentials:

1) Copy example to working tools file
```bash
cp examples/hexnode.tools.json tools.json
```

2) Configure Hexnode env in `.env.local` (header auth)
```bash
API_BASE=https://<portal>.hexnodemdm.com/api/v1
AUTH_MODE=header
AUTH_HEADER=Authorization
AUTH_TOKEN=<your-hexnode-api-key>
ALLOW_DESTRUCTIVE=false
```

3) Start the server
```bash
npm run build && npm start
```

Note: Some Hexnode tenants use singular policy paths (`/policy/…`) and others plural (`/policies/…`). The example includes both; use whichever works for your tenant or remove non-applicable entries from `tools.json`.

## File Layout
- `src/server.ts`: MCP entrypoint
- `src/lib/*.ts`: helpers (qs, retry, logger)
- `scripts/*`: verification probes
- `dist/*`: compiled output

## License
MIT — see [LICENSE](./LICENSE).
