import { Plugin } from "@opencode/plugin"

// Ollama Web Search as an OpenCode websearch provider, plus an Ollama Web
// Fetch tool.
//
// APIs:
//   POST https://ollama.com/api/web_search  -> { results: [...] }
//   POST https://ollama.com/api/web_fetch   -> { title, content, links }
// Both use: Authorization: Bearer <key>
//
// Docs: https://ollama.com/blog/web-search
//       https://docs.ollama.com/capabilities/web-search
//
// API key resolution order:
//   1. plugins options: { package: ".../ollama-websearch", options: { apiKey: "..." } }
//   2. the "ollama-cloud" integration connected via /connect (stored in the server's SQLite db);
//      the legacy "ollama" id is also accepted
//   3. OLLAMA_API_KEY from the OpenCode server process environment (dev convenience)
// Registering the provider and the tool happens unconditionally; if no key is
// configured, execution throws an actionable error instead of failing at plugin
// load.

const DEFAULT_SEARCH_ENDPOINT = "https://ollama.com/api/web_search"
const DEFAULT_FETCH_ENDPOINT = "https://ollama.com/api/web_fetch"
const OLLAMA_INTEGRATION_IDS = ["ollama-cloud", "ollama"] as const
const API_KEY_ERROR =
  "Ollama API key is not configured. Connect Ollama Cloud with /connect, " +
  "or pass options.apiKey in the plugins entry of opencode.json, " +
  "or set OLLAMA_API_KEY on the OpenCode server process."

export default Plugin.define({
  id: "ollama-websearch",
  async setup(ctx: any) {
    const options = (ctx.options ?? {}) as Record<string, any>
    const keyState = { value: await resolveApiKey(ctx, options) }

    const getApiKey = async (): Promise<string> => {
      keyState.value = keyState.value ?? (await resolveApiKey(ctx, options))
      if (!keyState.value) throw new Error(API_KEY_ERROR)
      return keyState.value
    }

    const searchEndpoint =
      nonEmptyString(options.webSearchEndpoint) ??
      nonEmptyString(options.endpoint) ??
      DEFAULT_SEARCH_ENDPOINT
    const fetchEndpoint =
      nonEmptyString(options.webFetchEndpoint) ??
      nonEmptyString(options.fetchEndpoint) ??
      DEFAULT_FETCH_ENDPOINT

    await ctx.websearch.transform((editor: any) => {
      editor.add({
        id: "ollama",
        name: "Ollama Web Search",
        execute: async ({ query }: { query: string }, { signal }: { signal: AbortSignal }) => {
          const key = await getApiKey()

          const body: Record<string, unknown> = { query }
          if (typeof options.max_results === "number") body.max_results = options.max_results

          const res = await fetch(searchEndpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal,
          })

          if (!res.ok) {
            const text = await res.text().catch(() => "")
            throw new Error(`ollama web_search failed: HTTP ${res.status} ${text.slice(0, 300)}`)
          }

          const data: any = await res.json()
          const results: any[] = Array.isArray(data?.results) ? data.results : []
          return results.map((r) => ({
            url: String(r?.url ?? ""),
            title: String(r?.title ?? ""),
            content: String(r?.content ?? ""),
            time: {},
          }))
        },
      })
    })

    if (typeof ctx.tool?.transform === "function") {
      await ctx.tool.transform((editor: any) => {
        editor.add({
          name: "ollama_web_fetch",
          description:
            "Fetch a web page through Ollama's Web Fetch API and return its title, text, and links. " +
            "Use this instead of the built-in webfetch when you want Ollama to retrieve the page, " +
            "or when its extracted title/content/links are useful. Requires an Ollama API key.",
          input: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "The HTTP or HTTPS URL to fetch.",
              },
            },
            required: ["url"],
            additionalProperties: false,
          },
          options: { codemode: false },
          execute: async ({ url }: { url: string }, context: any) => {
            const target = parseHttpUrl(url)
            const key = await getApiKey()

            const res = await fetch(fetchEndpoint, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: target.href }),
              signal: context?.signal,
            })

            if (!res.ok) {
              const text = await res.text().catch(() => "")
              throw new Error(`ollama web_fetch failed: HTTP ${res.status} ${text.slice(0, 300)}`)
            }

            const data: any = await res.json()
            const title = typeof data?.title === "string" ? data.title : ""
            const content = typeof data?.content === "string" ? data.content : ""
            const links = Array.isArray(data?.links)
              ? data.links.filter((link: unknown): link is string => typeof link === "string" && link.length > 0)
              : []

            return { content: formatWebFetch({ title, url: target.href, content, links }) }
          },
        })
      })
    } else if (ctx.tool) {
      console.warn("[ollama-websearch] ctx.tool.transform is unavailable; ollama_web_fetch was not registered")
    }

    console.log(
      "[ollama-websearch] provider registered as 'ollama'" +
        (keyState.value ? " (key configured)" : " (no key yet; will retry on query)") +
        (typeof ctx.tool?.transform === "function" ? "; tool registered as 'ollama_web_fetch'" : ""),
    )
  },
})

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid URL: ${value}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http:// or https://")
  }
  if (url.username || url.password) {
    throw new Error("URL must not include credentials")
  }
  url.hash = ""
  return url
}

function formatWebFetch(input: { title: string; url: string; content: string; links: string[] }): string {
  const sections: string[] = []
  if (input.title) sections.push(`# ${input.title}`)
  sections.push(`URL: ${input.url}`)
  if (input.content) sections.push(input.content)
  if (input.links.length > 0) {
    sections.push(`## Links\n${input.links.map((link) => `- ${link}`).join("\n")}`)
  }
  return sections.join("\n\n")
}

// Resolve the API key from plugin options, a /connect credential, or the
// server process environment. The current integration id is "ollama-cloud";
// "ollama" is kept for older OpenCode versions.
async function resolveApiKey(ctx: any, options: Record<string, any>): Promise<string | undefined> {
  if (typeof options.apiKey === "string" && options.apiKey.length > 0) return options.apiKey

  for (const integrationID of OLLAMA_INTEGRATION_IDS) {
    try {
      const connection = await ctx.integration?.connection?.active(integrationID)
      if (!connection) continue
      const credential = await ctx.integration.connection.resolve(connection)
      const key = unwrapCredential(credential)
      if (key) return key
    } catch (err) {
      console.warn(`[ollama-websearch] could not resolve the "${integrationID}" connection from /connect:`, err)
    }
  }

  if (typeof process !== "undefined" && process.env?.OLLAMA_API_KEY) {
    return process.env.OLLAMA_API_KEY
  }

  return undefined
}

// The integration connection credential shape is not part of the public,
// documented contract, so unwrap defensively.
function unwrapCredential(cred: unknown): string | undefined {
  if (!cred) return undefined
  if (typeof cred === "string") return cred.length > 0 ? cred : undefined
  if (typeof cred === "object") {
    const obj = cred as Record<string, unknown>
    for (const key of ["key", "apiKey", "token", "value", "password", "secret"]) {
      const v = obj[key]
      if (typeof v === "string" && v) return v
    }
  }
  return undefined
}
