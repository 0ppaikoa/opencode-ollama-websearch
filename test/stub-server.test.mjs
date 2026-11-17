// Tests run against a stub HTTP server implementing the Ollama web_search API.
// The plugin imports "@opencode/plugin"; this test creates a minimal local shim in
// node_modules when the real package is not installed, so `node --test` works
// without `npm install`. node_modules/ is gitignored, so the shim is never committed.
import http from 'node:http'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shimDir = path.join(repoRoot, 'node_modules', '@opencode', 'plugin')

if (!existsSync(path.join(shimDir, 'index.js'))) {
  mkdirSync(shimDir, { recursive: true })
  writeFileSync(
    path.join(shimDir, 'package.json'),
    JSON.stringify({ name: '@opencode/plugin', version: '0.0.0-shim', type: 'module', main: 'index.js' }),
  )
  writeFileSync(path.join(shimDir, 'index.js'), 'export const Plugin = { define: (def) => def }\n')
}

const pluginUrl = path.join(repoRoot, 'index.ts')

async function makeStub() {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body })
      if (req.headers.authorization !== 'Bearer sk-test-key') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        results: [
          { title: 'A', url: 'https://a.example/', content: 'alpha' },
          { title: 'B', url: 'https://b.example/', content: 'beta' },
        ],
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/api/web_search` }
}

async function setupWith({ options = {}, connectionActive = async () => undefined, connectionResolve = async () => undefined }, editor) {
  const mod = await import(pluginUrl)
  const ctx = {
    options,
    integration: { connection: { active: connectionActive, resolve: connectionResolve } },
    websearch: { transform: async (cb) => cb(editor) },
  }
  await mod.default.setup(ctx)
  return editor
}

function makeEditor() {
  const state = { provider: null, default: undefined }
  const editor = {
    add: (p) => { state.provider = p },
    default: { get: () => state.default, set: (v) => { state.default = v } },
  }
  return { editor, state }
}

test('registers a provider under id "ollama"', async () => {
  const { editor, state } = makeEditor()
  await setupWith({}, editor)
  assert.equal(state.provider?.id, 'ollama')
  assert.equal(state.provider?.name, 'Ollama Web Search')
})

test('execute() posts the query with Bearer auth and maps results', async () => {
  const { server, requests, url } = await makeStub()
  try {
    const { editor, state } = makeEditor()
    await setupWith({ options: { apiKey: 'sk-test-key', endpoint: url } }, editor)
    const out = await state.provider.execute({ query: 'hello world' }, { signal: new AbortController().signal })
    assert.deepEqual(out, [
      { url: 'https://a.example/', title: 'A', content: 'alpha', time: {} },
      { url: 'https://b.example/', title: 'B', content: 'beta', time: {} },
    ])
    const hit = requests.at(-1)
    assert.equal(hit.headers.authorization, 'Bearer sk-test-key')
    assert.equal(JSON.parse(hit.body).query, 'hello world')
  } finally {
    server.close()
  }
})

test('missing API key throws an actionable error at query time', async () => {
  const { editor, state } = makeEditor()
  await setupWith({ options: {} }, editor)
  await assert.rejects(
    () => state.provider.execute({ query: 'x' }, { signal: new AbortController().signal }),
    /Ollama API key is not configured/,
  )
})

test('HTTP 401 from the API surfaces the status code', async () => {
  const { server, url } = await makeStub()
  try {
    const { editor, state } = makeEditor()
    await setupWith({ options: { apiKey: 'wrong', endpoint: url } }, editor)
    await assert.rejects(
      () => state.provider.execute({ query: 'x' }, { signal: new AbortController().signal }),
      /HTTP 401/,
    )
  } finally {
    server.close()
  }
})

test('API key is unwrapped from a /connect-style credential object', async () => {
  const { server, url } = await makeStub()
  try {
    const { editor, state } = makeEditor()
    await setupWith(
      {
        options: { endpoint: url },
        connectionActive: async (id) => (id === 'ollama' ? { id: 'cred-1' } : undefined),
        connectionResolve: async () => ({ key: 'sk-test-key' }),
      },
      editor,
    )
    const out = await state.provider.execute({ query: 'via /connect' }, { signal: new AbortController().signal })
    assert.equal(out.length, 2)
  } finally {
    server.close()
  }
})
