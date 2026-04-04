export const config = { runtime: 'edge' }

export default async function handler(req) {
  const url = new URL(req.url)
  const audioUrl = url.searchParams.get('url')

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    }})
  }

  if (!audioUrl) return new Response('Missing url param', { status: 400 })

  const upstreamHeaders = {}
  const range = req.headers.get('range')
  if (range) upstreamHeaders['Range'] = range

  const upstream = await fetch(audioUrl, { headers: upstreamHeaders })

  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
  headers.set('Accept-Ranges', 'bytes')

  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('Content-Type', ct)
  const cr = upstream.headers.get('content-range')
  if (cr) headers.set('Content-Range', cr)
  const cl = upstream.headers.get('content-length')
  if (cl) headers.set('Content-Length', cl)

  return new Response(upstream.body, { status: upstream.status, headers })
}
