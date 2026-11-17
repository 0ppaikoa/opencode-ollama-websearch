import { Plugin } from "@opencode/plugin"

// Ollama Web Search as an OpenCode websearch provider.
// API: POST https://ollama.com/api/web_search  (Authorization: Bearer <key>)
// Docs: https://ollama.com/blog/web-search
//
// API key resolution order:
//   1. plugins options: { package: ".../ollama-websearch", options: { apiKey: "..." } }
//   2. the "ollama" integration connected via /connect (stored in the server's SQLite db)
//   3. OLLAMA_API_KEY from the OpenCode server process environment (dev convenience)
// Registering the provider happens unconditionally; if no key is configured, query
// time throws an actionable error instead of failing at plugin load.

const DEFAULT_ENDPOINT = "https://ollama.com/api/web_search"

export default Plugin.define({
  id: "ollama-websearch",
  async setup(ctx: any) {
    const options = (ctx.options ?? {}) as Record<string, any>

    let apiKey: string | undefined = typeof options.apiKey === "string" && options.apiKey.length > 0 ? options.apiKey : undefined

    if (!apiKey) {
      try {
        const connection = await ctx.integration?.connection?.active("ollama")
        if (connection) {
          const credential = await ctx.integration.connection.resolve(connection)
          apiKey = unwrapCredential(credential)
        }
      } catch (err) {
        console.warn("[ollama-websearch] could not resolve an Ollama connection from /connect:", err)
      }
    }

    if (!apiKey && typeof process !== "undefined" && process.env?.OLLAMA_API_KEY) {
      apiKey = process.env.OLLAMA_API_KEY
    }

    const endpoint = typeof options.endpoint === "string" && options.endpoint ? options.endpoint : DEFAULT_ENDPOINT

    await ctx.websearch.transform((editor: any) => {
      editor.add({
        id: "ollama",
        name: "Ollama Web Search",
        execute: async ({ query }: { query: string }, { signal }: { signal: AbortSignal }) => {
          if (!apiKey) {
            throw new Error(
              "Ollama API key is not configured. Run /connect and connect Ollama, " +
                "or pass options.apiKey in the plugins entry of opencode.json, " +
                "or set OLLAMA_API_KEY on the OpenCode server process.",
            )
          }

          const body: Record<string, unknown> = { query }
          if (typeof options.max_results === "number") body.max_results = options.max_results

          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
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

    console.log("[ollama-websearch] provider registered as 'ollama'" + (apiKey ? " (key configured)" : " (no key yet)"))
  },
})

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
