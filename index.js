require('dotenv').config({ path: './config.env' });
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const express = require('express');
const axios = require('axios');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@eypzx/baileys');

const app = express();

// Track active pairing sessions so same number can't run twice
const activeSessions = new Set();

async function uploadToHastebin(data) {
  const token = process.env.HASTEBIN_TOKEN;
  const res = await axios.post(
    'https://hastebin.com/documents',
    JSON.stringify(data, null, 2),
    {
      headers: {
        'Content-Type': 'text/plain',
        'Authorization': `Bearer ${token}`
      }
    }
  );
  return res.data.key;
}

async function pairDevice(num, res = null) {
  console.log(`[${num}] Starting pairing`);

  num = num.replace(/[^0-9]/g, '');

  if (activeSessions.has(num)) {
    console.log(`[${num}] Already pairing, skipping duplicate`);
    if (res && !res.headersSent) res.status(429).json({ error: 'Pairing already in progress for this number' });
    return;
  }

  activeSessions.add(num);

  const authStatePath = path.resolve(`./session_${num}`);

  const cleanup = () => {
    activeSessions.delete(num);
    try { fs.rmSync(authStatePath, { recursive: true, force: true }); } catch {}
    console.log(`[${num}] Session cleaned up`);
  };

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authStatePath);
    const { version } = await fetchLatestBaileysVersion();

    const session = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: 'fatal' }).child({ level: 'fatal' })
        )
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
      browser: Browsers.macOS('Safari'),
      downloadHistory: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });

    if (!session.authState.creds.registered) {
      await delay(1500);
      const code = await session.requestPairingCode(num);
      console.log(`[${num}] Pairing Code: ${code}`);
      if (res && !res.headersSent) res.json({ code });
    }

    session.ev.on('creds.update', saveCreds);

    let sent = false;

    session.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      console.log(`[${num}] Connection: ${connection} ${statusCode ?? ''}`);

      if (connection === 'open' && !sent) {
        sent = true;

        try {
          await delay(3000);

          const credsPath = path.join(authStatePath, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            console.log(`[${num}] creds.json not found`);
            return;
          }

          const creds = JSON.parse(fs.readFileSync(credsPath));
          const key = await uploadToHastebin(creds);

          await session.sendMessage(`${num}@s.whatsapp.net`, {
            text: `XHYPHER:~${key}`
          });

          console.log(`[${num}] Session key sent`);
        } catch (e) {
          console.log(`[${num}] Error:`, e.message);
        }

        await delay(2000);
        try { await session.ws.close(); } catch {}

        // ✅ cleanup only this user's session, server keeps running
        cleanup();
      }

      if (connection === 'close') {
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.log(`[${num}] Logged out`);
          cleanup();
          return;
        }

        // Only retry if we haven't sent yet
        if (!sent) {
          console.log(`[${num}] Disconnected (${statusCode}), retrying in 3s...`);
          await delay(3000);
          activeSessions.delete(num); // allow retry
          pairDevice(num, null);
        } else {
          cleanup();
        }
      }
    });

  } catch (e) {
    console.log(`[${num}] Fatal error:`, e.message);
    cleanup();
    if (res && !res.headersSent) res.status(500).json({ error: 'failed' });
  }
}
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.get('/api/pair', async (req, res) => {
  const n = req.query.n;
  if (!n) return res.status(400).json({ error: 'number required ?n=' });

  try {
    await pairDevice(n, res);
  } catch (e) {
    console.log('API ERROR:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'failed' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('API running on port ' + PORT);
});