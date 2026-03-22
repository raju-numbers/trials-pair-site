"use strict";

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");

const TOKEN = process.env.HASTEBIN_TOKEN;

async function MakeSession(sessionId, folderPath) {
  try {
    const pasteId = sessionId.split("~")[1];
    if (!pasteId)
      throw new Error("Invalid SESSION_ID. Expected format: XHYPHER~<pasteId>");

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
