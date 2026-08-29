const ALLOWED_PREFIX = "audio/"

function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  if (m[1] === undefined) return { suffix: Number(m[2]) }
  if (m[2] === undefined) return { offset: Number(m[1]) }
  const start = Number(m[1]), end = Number(m[2])
  if (end < start) return null
  return { offset: start, length: end - start + 1 }
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 })
    }
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    if (!key.startsWith(ALLOWED_PREFIX)) return new Response("not found", { status: 404 })

    const rangeHeader = request.headers.get("range")
    let range = null
    if (rangeHeader) {
      range = parseRange(rangeHeader)
      if (range === null) return new Response("invalid range", { status: 416 })
    }

    let obj
    try {
      obj = await env.BUCKET.get(key, range === null ? {} : { range })
    } catch {
      return new Response("invalid range", { status: 416 })
    }
    if (obj === null) return new Response("not found", { status: 404 })

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set("etag", obj.httpEtag)
    headers.set("accept-ranges", "bytes")
    headers.set("cache-control", "public, max-age=31536000, immutable")
    headers.set("access-control-allow-origin", "*")

    if (range === null) {
      headers.set("content-length", String(obj.size))
      return new Response(request.method === "HEAD" ? null : obj.body, { status: 200, headers })
    }
    headers.set("content-range",
      `bytes ${obj.range.offset}-${obj.range.offset + obj.range.length - 1}/${obj.size}`)
    headers.set("content-length", String(obj.range.length))
    return new Response(request.method === "HEAD" ? null : obj.body, { status: 206, headers })
  },
}
