/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import Anthropic from "@anthropic-ai/sdk";
import { Request, Response } from "express";
import { setGlobalOptions } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
// import {onRequest} from "firebase-functions/https";
// import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// The Cloud Functions for Firebase SDK to create Cloud Functions and triggers.
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

// Define the secret
const claudeKey = defineSecret("CLAUDE_KEY");

// Bind the secret in the options object so the function can access it at runtime
export const helloWorld = onRequest(
  {
    secrets: [claudeKey],
    cors: true, // Allows calls to this endpoint
  },
  async (req: Request, res: Response) => {
    try {
      // Initialize Anthropic inside the handler so it can read the secret at runtime
      const anthropic = new Anthropic({
        apiKey: claudeKey.value(),
      });

      const { userPrompt, tagResults } = req.body;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system:
          "You are a helpful search assistant. Use the provided database tag results to answer the user's request.",
        messages: [
          {
            role: "user",
            content: `User query: ${userPrompt}\n\nDatabase results: ${JSON.stringify(tagResults)}`,
          },
        ],
      });

      res.status(200).json({ reply: message.content });
    } catch (error) {
      console.error("Claude API Error:", error);
      res.status(500).json({ error: "Failed to communicate with Claude API" });
    }
  },
);
