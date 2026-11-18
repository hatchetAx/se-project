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

      const { userPrompt, tagResults, keywords, messages, suggestOnly } = req.body;
      const keywordContext =
        Array.isArray(keywords) && keywords.length > 0
          ? `Search query: ${keywords.join(", ")}`
          : "Search query: not provided";
      const conversation =
        Array.isArray(messages) && messages.length > 0
          ? messages
              .filter(
                (message: { role?: string; content?: string }) =>
                  (message.role === "user" || message.role === "assistant") &&
                  typeof message.content === "string",
              )
              .map((message: { role: "user" | "assistant"; content: string }) => ({
                role: message.role,
                content: message.content,
              }))
          : [
              {
                role: "user" as const,
                content: `User query: ${userPrompt}\n\nDatabase results: ${JSON.stringify(tagResults)}`,
              },
            ];

      if (suggestOnly) {
        const suggestionMessage = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 300,
            system:
              "Generate exactly three concise, relevant questions a researcher might ask about the attached database search results. Questions must mention the search topic or a named database when useful. Return only valid JSON: {\"suggestedQuestions\":[\"...\",\"...\",\"...\"]}. Do not add Markdown or commentary.",
            messages: [
              {
                role: "user",
                content: `${keywordContext}\nDatabase results: ${JSON.stringify(tagResults)}`,
              },
            ],
        });

        const suggestionText = suggestionMessage.content
            .map((block) => ("text" in block ? block.text : ""))
            .join("");
        let suggestedQuestions: string[] = [];
        try {
            const parsed = JSON.parse(suggestionText) as {
              suggestedQuestions?: unknown;
            };
            if (Array.isArray(parsed.suggestedQuestions)) {
              suggestedQuestions = parsed.suggestedQuestions
                .filter((question): question is string => typeof question === "string")
                .slice(0, 3);
            }
        } catch {
            suggestedQuestions = [];
        }

        res.status(200).json({
            reply: "",
            suggestedQuestions,
        });
        return;
      }

      if (conversation.length > 0 && conversation[conversation.length - 1].role === "user") {
        const latest = conversation[conversation.length - 1];
        latest.content = `${latest.content}\n\n${keywordContext}\nDatabase context: ${JSON.stringify(tagResults)}`;
      }

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system:
          [
            "You are a database research assistant for an app that helps people find web databases.",
            "Use the search query and attached database results as the only source of database-specific facts.",
            "Explain relevance to the user's query, compare access type, content, organization, availability, verification status, and ease of use.",
            "Do not invent data fields, licenses, coverage, access rules, or availability. Clearly label assumptions and unknowns.",
            "Keep the response focused and practical: lead with a direct answer, then give brief supporting evidence.",
            "When comparing databases, use a compact table if it improves clarity.",
            "Use standard Markdown pipe tables only. Include a header row and separator row (for example: | Database | Access | |---|---|), keep each table to 3-4 columns, and do not add prose inside table cells.",
            "Format responses in readable Markdown. Use headings, bold text, italics, lists, links, blockquotes, code blocks, and tables when useful.",
            "Use database names and URLs from the attached results when linking or citing sources.",
            "Ask a brief clarifying question only when the user's goal cannot be determined from the query or context.",
            "After the answer, suggest exactly three short follow-up questions relevant to the current topic and database results.",
            "Return the answer and suggested follow-ups as JSON: {\"reply\":\"Markdown answer\",\"suggestedQuestions\":[\"...\",\"...\",\"...\"]}. Do not wrap the JSON in a code block.",
          ].join(" "),
        messages: conversation,
      });

      const responseText = message.content
        .map((block) => ("text" in block ? block.text : ""))
        .join("");
      let reply = responseText;
      let suggestedQuestions: string[] = [];

      try {
        const parsed = JSON.parse(responseText) as {
          reply?: unknown;
          suggestedQuestions?: unknown;
        };
        if (typeof parsed.reply === "string") reply = parsed.reply;
        if (Array.isArray(parsed.suggestedQuestions)) {
          suggestedQuestions = parsed.suggestedQuestions
            .filter((question): question is string => typeof question === "string")
            .map((question) => question.trim())
            .filter(Boolean)
            .slice(0, 3);
        }
      } catch {
        // Older or non-JSON model responses still fall back to plain Markdown.
      }

      res.status(200).json({ reply, suggestedQuestions });
    } catch (error) {
      console.error("Claude API Error:", error);
      res.status(500).json({ error: "Failed to communicate with Claude API" });
    }
  },
);
