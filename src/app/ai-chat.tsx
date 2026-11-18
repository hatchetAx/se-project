import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import ChatMarkdown from "./components/ChatMarkdown";
import type { DatabaseResult } from "./components/resultsRepo";
import { COLORS, styles } from "./styles/ai-chat.styles";
import { useResultsDatabase } from "../components/resultsDatabase";
import {
  clearConversation,
  getConversation,
  saveConversation,
  type ChatMessage,
} from "../components/aiConversationStore";

type Message = ChatMessage;

const AI_FUNCTION_URL =
  process.env.EXPO_PUBLIC_AI_FUNCTION_URL ??
  "https://us-central1-se-project-9291e.cloudfunctions.net/helloWorld";

function extractReply(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("The AI returned an unreadable response.");
  }
  const reply = (payload as { reply?: unknown }).reply;
  if (typeof reply === "string") return reply;
  if (Array.isArray(reply)) {
    const text = reply
      .map((block) => {
        if (typeof block === "string") return block;
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  throw new Error("The AI returned an unreadable response.");
}

export default function AIChat() {
  const params = useLocalSearchParams<{
    keywords?: string;
    databases?: string;
  }>();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const db = useResultsDatabase();

  const keywords = useMemo(
    () => (params.keywords ?? "").split(",").filter(Boolean),
    [params.keywords],
  );
  const databases = useMemo<DatabaseResult[]>(() => {
    try {
      return JSON.parse(params.databases ?? "[]") as DatabaseResult[];
    } catch {
      return [];
    }
  }, [params.databases]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I’ll help you compare and evaluate these search results. Ask about coverage, access, data types, or which database fits your research.",
    },
  ]);
  const suggestions = [
    "Compare the open and closed databases",
    "Summarize the best matches",
    "Which database is easiest to access?",
  ];

  const clearChat = async () => {
    await clearConversation(db, keywords);
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content:
          "I’ll help you compare and evaluate these search results. Ask about coverage, access, data types, or which database fits your research.",
      },
    ]);
  };

  React.useEffect(() => {
    let cancelled = false;
    void getConversation(db, keywords).then((saved) => {
      if (cancelled || saved.length === 0) return;
      setMessages(saved);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd());
    });
    return () => {
      cancelled = true;
    };
  }, [db, keywords]);

  const scrollToEnd = () =>
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: 999999, animated: true }),
    );


  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || sending) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    await saveConversation(db, keywords, nextMessages);
    setDraft("");
    setSending(true);
    scrollToEnd();

    try {
      const response = await fetch(AI_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userPrompt: text,
          tagResults: databases,
          keywords,
          messages: nextMessages
            .filter((message) => message.id !== "welcome")
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!response.ok) {
        throw new Error(`AI request failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      setMessages((current) => {
        const updated: Message[] = [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: extractReply(payload),
        },
        ];
        void saveConversation(db, keywords, updated);
        return updated;
      });
    } catch (error) {
      setMessages((current) => {
        const updated: Message[] = [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error
              ? `I couldn't complete that request. ${error.message}`
              : "I couldn't complete that request. Please try again.",
        },
        ];
        void saveConversation(db, keywords, updated);
        return updated;
      });
    } finally {
      setSending(false);
      scrollToEnd();
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.headerButton}
          >
            <Ionicons name="arrow-back" size={21} color={COLORS.navy} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Database AI</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {keywords.join(", ") || `${databases.length} databases`}
            </Text>
          </View>
          <Pressable
            onPress={() => void clearChat()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Clear saved AI conversation"
            style={styles.headerButton}
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.navy} />
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
        >
          {databases.length > 0 && (
            <View style={styles.contextCard}>
              <Ionicons name="library-outline" size={16} color={COLORS.navy} />
              <Text style={styles.contextText}>
                {databases.length} database{databases.length === 1 ? "" : "s"} attached
              </Text>
            </View>
          )}

          {messages.map((message) =>
            message.role === "user" ? (
              <View key={message.id} style={styles.userRow}>
                <View style={styles.userBubble}>
                  <Text style={styles.userText}>{message.content}</Text>
                </View>
              </View>
            ) : (
              <View key={message.id} style={styles.assistantRow}>
                <View style={styles.assistantAvatar}>
                  <Ionicons name="sparkles" size={14} color={COLORS.navy} />
                </View>
                <View style={styles.assistantBubble}>
                  <ChatMarkdown content={message.content} />
                </View>
              </View>
            ),
          )}

          {sending && (
            <View
              style={styles.assistantRow}
              accessibilityRole="progressbar"
              accessibilityLabel="Database AI is responding"
              accessibilityLiveRegion="polite"
            >
              <View style={styles.assistantAvatar}>
                <Ionicons name="sparkles" size={14} color={COLORS.navy} />
              </View>
              <View style={styles.typingBubble}>
                <View style={styles.typingDot} />
                <View style={[styles.typingDot, styles.typingDotSecond]} />
                <View style={[styles.typingDot, styles.typingDotThird]} />
              </View>
            </View>
          )}

          {!sending && messages.length <= 1 && (
            suggestions.length > 0 ? (
              <View style={styles.initialSuggestions}>
                <Text style={styles.followUpLabel}>Suggested questions</Text>
                <View style={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  style={styles.suggestion}
                  onPress={() => void sendMessage(suggestion)}
                  accessibilityRole="button"
                  accessibilityHint="Send this suggested question"
                >
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                  <View style={{ flexShrink: 0 }}>
                    <Ionicons name="arrow-forward" size={14} color={COLORS.navy} />
                  </View>
                </Pressable>
              ))}
                </View>
              </View>
            ) : null
          )}
        </ScrollView>

        <View style={styles.composerWrap}>
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask about these databases..."
              placeholderTextColor={COLORS.muted}
              style={styles.input}
              multiline
              maxLength={4000}
              editable={!sending}
              accessibilityLabel="Message"
              accessibilityHint="Ask the AI about the attached database results"
            />
            <Pressable
              style={[
                styles.sendButton,
                (!draft.trim() || sending) && styles.sendButtonDisabled,
              ]}
              onPress={() => void sendMessage()}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}
            >
              {sending ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="arrow-up" size={18} color={COLORS.white} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
