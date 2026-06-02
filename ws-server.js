// ws-server.js
// Simple secure WebSocket relay for frames
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const SECRET = process.env.WS_SECRET || 'change_this_secret';

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log('WebSocket relay listening on', PORT);
});

wss.on('connection', (ws, req) => {
  console.log('Client connected', req.socket.remoteAddress);
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      // token validation
      if (!data.token || data.token !== SECRET) {
        ws.send(JSON.stringify({ error: 'invalid token' }));
        return;
      }
      // broadcast to all other clients
      wss.clients.forEach(c => {
        if (c !== ws && c.readyState === WebSocket.OPEN) {
          c.send(JSON.stringify(data));
        }
      });
    } catch (e) {
      console.error('Bad message', e);
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

// heartbeat to drop dead clients
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
