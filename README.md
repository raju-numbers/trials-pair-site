# XHYPHER TECH PAIR WEB

WhatsApp session pairing server with a web UI. Pairs your device, uploads credentials to [Hastebin](https://hastebin.com), and delivers the session key directly to your WhatsApp.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Baileys](https://img.shields.io/badge/Powered%20by-Baileys-blueviolet?style=flat-square)](https://github.com/eypzx/baileys)

---

## Features

- 195 countries with searchable flag and dial code picker, sorted alphabetically
- Pairing code generated and delivered instantly via the web UI or REST API
- Credentials automatically uploaded to Hastebin after a successful pair
- Session key sent directly to the paired WhatsApp number
- Multiple users can pair simultaneously without conflicts
- Session folder automatically deleted after each successful pair
- Documentation page available at `/docs`

---

## How It Works

```
User enters phone number
        |
        v
GET /api/pair?n=233xxxxxxxxxx
        |
        v
Baileys generates pairing code  -->  { code: "XXXX-XXXX" }
        |
        v  (user enters code in WhatsApp)
connection === 'open'
        |
        v
creds.json  -->  uploaded to Hastebin
        |
        v
XHYPHER:~{hastebin-key}  -->  sent to user's WhatsApp
        |
        v
Session folder deleted, server ready for next user
```

---

## Requirements

- Node.js 18 or higher
- A [Hastebin](https://hastebin.com) account and API token

---

## API Reference

### GET /api/pair

Request a WhatsApp pairing code for a phone number.

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `n` | string | Yes | Full phone number with country code, digits only. Example: `233209961490` |

**Success Response**

```json
{
  "code": "XHYP-HERX"
}
```

**Error Response**

```json
{
  "error": "number required ?n="
}
```

**Example**

```bash
curl "http://localhost:5000/api/pair?n=233209961490"
```

---

## Hastebin Storage

Credentials are stored using the [Hastebin](https://hastebin.com) API.

After a successful pairing, the server:

1. Reads the generated `creds.json` from the temporary session folder
2. Uploads it to `https://hastebin.com/documents` using your bearer token
3. Sends the resulting key to your WhatsApp in the format `XHYPHERX:~<key>`
4. Deletes the local session folder

To retrieve your credentials later, the key is fetched from:

```
GET https://hastebin.com/raw/<key>
Authorization: Bearer <HASTEBIN_TOKEN>
```

> Keep your session key private. It grants full access to your WhatsApp session. Never commit it to a public repository.

---

## Bot Integration

### session.js

Add this file to your bot project to restore the session from Hastebin on startup.

```js
"use strict";

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");

const TOKEN = process.env.HASTEBIN_TOKEN;

async function MakeSession(sessionId, folderPath) {
  try {
    const pasteId = sessionId.split("~")[1];
    if (!pasteId)
      throw new Error("Invalid SESSION_ID. Expected format: XHYHER:~<pasteId>");

    const rawUrl = `https://hastebin.com/raw/${pasteId}`;
    const response = await axios.get(rawUrl, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });

    const raw = response.data;
    if (!raw) throw new Error("Empty response from Hastebin.");

    // /raw/ returns content directly as a string, not wrapped in an object
    const creds = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!fs.existsSync(folderPath))
      fs.mkdirSync(folderPath, { recursive: true });

    fs.writeFileSync(
      path.join(folderPath, "creds.json"),
      JSON.stringify(creds, null, 2)
    );

    console.log("[session] creds.json saved successfully.");
  } catch (err) {
    console.error("[session] Failed to load session:", err.message);
    process.exit(1);
  }
}

module.exports = { MakeSession };
```

### index.js

Call `MakeSession` before initialising your Baileys socket. It only downloads the file once — if `creds.json` already exists it skips the download.

```js
require("dotenv").config({ path: "./config.env" });

const fs   = require("fs");
const path = require("path");
const { MakeSession } = require("./session");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers
} = require("@eypzx/baileys");

const pino = require("pino");

const SESSION_DIR = "./auth_session";

async function startBot() {
  const sessionId = process.env.SESSION_ID;

  if (sessionId && !fs.existsSync(path.join(SESSION_DIR, "creds.json"))) {
    console.log("[session] Restoring session from Hastebin...");
    await MakeSession(sessionId, SESSION_DIR);
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(
               state.keys,
               pino({ level: "fatal" }).child({ level: "fatal" })
             )
    },
    printQRInTerminal: false,
    logger: pino({ level: "fatal" }).child({ level: "fatal" }),
    browser: Browsers.macOS("Safari")
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection }) => {
    if (connection === "open") console.log("[bot] Connected to WhatsApp.");
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg  = messages[0];
    if (!msg.message) return;
    const text = msg.message.conversation ||
                 msg.message.extendedTextMessage?.text || "";
    if (text.toLowerCase() === "ping")
      await sock.sendMessage(msg.key.remoteJid, { text: "Pong!" });
  });
}

startBot();
```

### config.env (bot)

```env
SESSION_ID=XHYPHER:~abc123xyz789
HASTEBIN_TOKEN=your_hastebin_bearer_token_here
```

---

## Project Structure

```
pair-web/
├── public/
│   ├── pair.html         # served at /
│   └── docs.html         # served at /docs
├── index.js              # Express server and pairing logic
├── session.js            # MakeSession helper for bots
├── config.env            # Environment variables
├── package.json
└── README.md
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HASTEBIN_TOKEN` | Yes | Hastebin API bearer token. Used by the pairing server to upload credentials and by `MakeSession` to download them. |
| `PORT` | No | HTTP port for the pairing server. Defaults to `5000`. |
| `SESSION_ID` | Yes (bot only) | Session key received on WhatsApp after pairing, in the format `XHYPHER:~<pasteId>`. |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@eypzx/baileys` | WhatsApp Web API |
| `express` | HTTP server |
| `axios` | Hastebin API requests |
| `pino` | Logger |
| `dotenv` | Environment variable loader |

---

## License

MIT - see [LICENSE](LICENSE) for details.
