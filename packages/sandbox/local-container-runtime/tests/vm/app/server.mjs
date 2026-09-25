import http from 'node:http'
import pg from 'pg'
import { WebSocketServer } from 'ws'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await pool.query('CREATE TABLE IF NOT EXISTS counter (id integer PRIMARY KEY, value integer NOT NULL)')
await pool.query('INSERT INTO counter VALUES (1, 0) ON CONFLICT DO NOTHING')
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'POST') await pool.query('UPDATE counter SET value = value + 1 WHERE id = 1')
    const { rows } = await pool.query('SELECT value FROM counter WHERE id = 1')
    response.setHeader('Content-Type', 'text/html')
    response.end(`<h1>Development VM</h1><p id="counter">${rows[0].value}</p><button onclick="fetch('/',{method:'POST'}).then(()=>location.reload())">Increment</button>`)
  } catch { response.writeHead(500).end('Database unavailable') }
})
const websocket = new WebSocketServer({ server })
websocket.on('connection', socket => socket.on('message', value => socket.send(value.toString())))
server.listen(8080, '0.0.0.0')
