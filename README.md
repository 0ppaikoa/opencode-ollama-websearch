# opencode-ollama-websearch

Ollama's [Web Search](https://ollama.com/blog/web-search) and Web Fetch APIs for [OpenCode](https://opencode.ai), implemented as a server plugin.

- **Web Search**: a websearch provider with id `ollama`
- **Web Fetch**: a tool named `ollama_web_fetch`
- Free tier available with an [Ollama account](https://ollama.com/settings/keys) (see the blog for rate limits)
- No OpenAI-compatible translation layer: calls `https://ollama.com/api/web_search` and `https://ollama.com/api/web_fetch` directly

## Install

Clone and point your OpenCode config at the checkout:

```jsonc title="~/.config/opencode/opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/path/to/opencode-ollama-websearch"],
  "websearch": { "provider": "ollama" }
}
```

Relative paths in `plugins` for project config are resolved per the OpenCode plugin loader; use an absolute path or a published package name to be safe.

## API key

Both the Web Search provider and the Web Fetch tool use the same key. The plugin resolves it in this order:

1. **Plugin options** (goes in your config — avoid unless you keep the file private):
   ```jsonc
   { "plugins": [{ "package": "/path/to/opencode-ollama-websearch", "options": { "apiKey": "ollama_..." } }] }
   ```
2. **`/connect` → Ollama Cloud** — the key is stored in the OpenCode server's SQLite database, not in any config file or environment variable. The plugin looks for the `ollama-cloud` integration first, then the legacy `ollama` id. It resolves the credential at load time and retries at query time if no key was available (defensively unwrapped: `key`/`apiKey`/`token`/`value`/`password`/`secret`).
3. **`OLLAMA_API_KEY`** in the OpenCode server process environment (convenient for development only; note that SSH shells do not reach the server process unless it was started there).

Optional options:

- `webSearchEndpoint`: override the Web Search endpoint
- `endpoint`: legacy alias for `webSearchEndpoint`
- `webFetchEndpoint`: override the Web Fetch endpoint
- `fetchEndpoint`: alias for `webFetchEndpoint`
- `max_results`: passed to the Web Search API

## Usage

### Web Search

Select the provider on first prompt, or set `websearch.provider` to `"ollama"`. The `websearch` permission action behaves the same as for built-in providers.

### Web Fetch

The plugin also registers the `ollama_web_fetch` tool. It takes one input, `url`, and returns the page title, text, and links from Ollama's Web Fetch API.

Use it when you want Ollama to retrieve the page, or when the extracted `title`, `content`, and `links` are useful. OpenCode's built-in `webfetch` fetches the URL directly from the OpenCode server and returns text, Markdown, or HTML; it does not call Ollama and does not return the `links` list. The two tools coexist, and `ollama_web_fetch` does not replace the built-in `webfetch`.

The tool input is:

```json
{ "url": "https://example.com/" }
```

The API key is resolved the same way as for Web Search.

## Develop

Requires Node.js >= 22 (uses built-in type stripping for the `.ts` source).

```bash
npm test
```

The test suite runs against a local stub implementing the Ollama `web_search` HTTP API (Bearer auth, `{"query", "max_results?"}` → `{"results": [{title, url, content}]}`). No network access and no API key are needed. The connection tests cover both the current `ollama-cloud` integration id and the legacy `ollama` id. The current tests cover Web Search; Web Fetch is not covered by automated tests. The first run creates a minimal `@opencode/plugin` shim in `node_modules/` (gitignored); if you `npm install` the real package, tests use it instead.

## Publishing

Not published yet. When publishing:

```bash
npm publish
```

and reference it by name in `plugins`: `"plugins": ["opencode-ollama-websearch@^0.2.0"]`.

OpenCode resolves `plugins` entries that are npm package names; pin a version range when you want automatic patch updates.

## License

MIT
