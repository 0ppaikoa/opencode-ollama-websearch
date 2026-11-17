# opencode-ollama-websearch

[Ollama Web Search](https://ollama.com/blog/web-search) as a **websearch provider** for [OpenCode](https://opencode.ai), implemented as a server plugin. Once installed, OpenCode can search the web through Ollama's API and cite sources like any built-in search provider.

- Provider id: `ollama`
- Free tier available with an [Ollama account](https://ollama.com/settings/keys) (see the blog for rate limits)
- No OpenAI-compatible translation layer — calls `https://ollama.com/api/web_search` directly

## Install

Clone and point your OpenCode config at the checkout:

```jsonc title="~/.config/opencode/opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/home/user/codes/opencode-ollama-websearch"],
  "websearch": { "provider": "ollama" }
}
```

Relative paths in `plugins` for project config are resolved per the OpenCode plugin loader; use an absolute path or a published package name to be safe.

## API key

The plugin resolves the key in this order:

1. **Plugin options** (goes in your config — avoid unless you keep the file private):
   ```jsonc
   { "plugins": [{ "package": "/home/user/codes/opencode-ollama-websearch", "options": { "apiKey": "ollama_..." } }] }
   ```
2. **`/connect` → Ollama** — the key is stored in the OpenCode server's SQLite database, not in any config file or environment variable. The plugin resolves the credential at load time (defensively unwrapped: `key`/`apiKey`/`token`/`value`/`password`/`secret`).
3. **`OLLAMA_API_KEY`** in the OpenCode server process environment (convenient for development only; note that SSH shells do not reach the server process unless it was started there).

Optional options: `endpoint` (override the API URL, e.g. for testing) and `max_results` (number, passed through to the API).

## Usage

Select the provider on first prompt, or set `websearch.provider` to `"ollama"`. The `websearch` permission action behaves the same as for built-in providers.

## Develop

Requires Node.js >= 22 (uses built-in type stripping for the `.ts` source).

```bash
npm test
```

The test suite runs against a local stub implementing the Ollama `web_search` HTTP API (Bearer auth, `{"query", "max_results?"}` → `{"results": [{title, url, content}]}`). No network access and no API key are needed. The first run creates a minimal `@opencode/plugin` shim in `node_modules/` (gitignored); if you `npm install` the real package, tests use it instead.

## Publishing

Not published yet. When publishing:

```bash
npm publish
```

and reference it by name in `plugins`: `"plugins": ["opencode-ollama-websearch@^0.1.0"]`.

OpenCode resolves `plugins` entries that are npm package names; pin a version range when you want automatic patch updates.

## License

MIT
