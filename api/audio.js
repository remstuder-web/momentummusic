// Vercel Serverless Function (Node.js) — proper streaming for audio elements
export default async function handler(req, res) {
  const audioUrl = req.query.url
  
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (!audioUrl) { res.status(400).end('Missing url'); return }

  const fetchHeaders = { 'User-Agent': 'Mozilla/5.0' }
  if (req.headers.range) fetchHeaders['Range'] = req.headers.range

  try {
    const upstream = await fetch(audioUrl, { headers: fetchHeaders })
    
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Accept-Ranges', 'bytes')
    
    const forward = ['content-type','content-length','content-range','accept-ranges']
    for (const h of forward) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }

    res.status(upstream.status)
    
    // Pipe the response body
    const reader = upstream.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch(e) {
    res.status(502).end('Error: ' + e.message)
  }
}
