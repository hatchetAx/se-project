import React from "react";
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { COLORS } from "../styles/splash-page.styles";

type InlineProps = {
  text: string;
  style?: object;
};

function InlineText({ text, style }: InlineProps) {
  const pattern =
    /(\[[^\]]+\]\((?:https?:\/\/|www\.)[^)\s]+(?:\s+(?:["'][^"']*["']))?\)|`[^`]+`|<https?:\/\/[^>]+>|\b(?:https?:\/\/|www\.)[^\s<]+|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|~~[^~]+~~|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  const parts = text.split(pattern).filter(Boolean);

  return (
    <Text style={[styles.inline, style]}>
      {parts.map((part, index) => {
        const markdownLink = part.match(
          /^\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^)\s]+)(?:\s+(?:["'][^"']*["']))?\)$/,
        );
        const angleLink = part.match(/^<((?:https?:\/\/)[^>]+)>$/);
        const bareLink = part.match(/^(?:(?:https?:\/\/|www\.)[^\s<]+)$/);
        const link = markdownLink
          ? [markdownLink[0], markdownLink[1], markdownLink[2]]
          : angleLink
            ? [angleLink[0], angleLink[1], angleLink[1]]
            : bareLink
              ? [bareLink[0], bareLink[0], bareLink[0]]
              : null;
        if (link) {
          const cleanUrl = link[2].replace(/[),.!?]+$/, "");
          const href =
            cleanUrl.startsWith("www.") ? `https://${cleanUrl}` : cleanUrl;
          const label =
            angleLink || bareLink
              ? link[1].replace(/[),.!?]+$/, "")
              : link[1];
          return (
            <Text
              key={index}
              style={styles.link}
              onPress={() => void Linking.openURL(href)}
            >
              {label.replace(/[),.!?]+$/, "")}
            </Text>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <Text key={index} style={styles.inlineCode}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        if (part.startsWith("***") && part.endsWith("***")) {
          return (
            <Text key={index}>
              <InlineText
                text={part.slice(3, -3)}
                style={styles.boldItalic}
              />
            </Text>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text key={index}>
              <InlineText text={part.slice(2, -2)} style={styles.bold} />
            </Text>
          );
        }
        if (part.startsWith("~~") && part.endsWith("~~")) {
          return (
            <Text key={index}>
              <InlineText text={part.slice(2, -2)} style={styles.strike} />
            </Text>
          );
        }
        if (part.startsWith("__") && part.endsWith("__")) {
          return (
            <Text key={index}>
              <InlineText text={part.slice(2, -2)} style={styles.underline} />
            </Text>
          );
        }
        if (
          (part.startsWith("*") && part.endsWith("*")) ||
          (part.startsWith("_") && part.endsWith("_"))
        ) {
          return (
            <Text key={index}>
              <InlineText text={part.slice(1, -1)} style={styles.italic} />
            </Text>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}

function splitTableRow(line: string): string[] {
  const source = line.trim();
  const withoutOuterPipes =
    source.startsWith("|") && source.endsWith("|")
      ? source.slice(1, -1)
      : source.replace(/^\|/, "").replace(/\|$/, "");

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let inInlineCode = false;
  let bracketDepth = 0;
  let linkParenDepth = 0;
  for (let index = 0; index < withoutOuterPipes.length; index += 1) {
    const character = withoutOuterPipes[index];
    if (character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === "`" && !escaped) {
      inInlineCode = !inInlineCode;
      cell += character;
      escaped = false;
      continue;
    }
    if (!inInlineCode) {
      if (character === "[") bracketDepth += 1;
      if (character === "]" && bracketDepth > 0) bracketDepth -= 1;
      if (character === "(" && bracketDepth === 0 && cell.trim().endsWith("]")) {
        linkParenDepth += 1;
      } else if (character === "(" && linkParenDepth > 0) {
        linkParenDepth += 1;
      } else if (character === ")" && linkParenDepth > 0) {
        linkParenDepth -= 1;
      }
    }
    if (
      character === "|" &&
      !escaped &&
      !inInlineCode &&
      bracketDepth === 0 &&
      linkParenDepth === 0
    ) {
      cells.push(cell.trim());
      cell = "";
      escaped = false;
      continue;
    }
    cell += character;
    escaped = false;
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

export default function ChatMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) continue;

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(
        <View key={`code-${index}`} style={styles.codeBlock}>
          {language ? <Text style={styles.codeLanguage}>{language}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText}>{codeLines.join("\n")}</Text>
          </ScrollView>
        </View>,
      );
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <View key={`table-${index}`} style={styles.tableScroll}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            nestedScrollEnabled
            contentContainerStyle={styles.table}
          >
            <View
              style={[
                styles.tableMatrix,
                { width: headers.length * 112 },
              ]}
            >
              <View style={styles.tableRow}>
                {headers.map((header, cellIndex) => (
                  <View
                    key={cellIndex}
                    style={[
                      styles.tableCell,
                      styles.tableHeader,
                      cellIndex === headers.length - 1 && styles.tableLastCell,
                    ]}
                  >
                    <InlineText text={header} />
                  </View>
                ))}
              </View>
              {rows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.tableRow}>
                  {headers.map((_, cellIndex) => (
                    <View
                      key={cellIndex}
                      style={[
                        styles.tableCell,
                        rowIndex === rows.length - 1 && styles.tableLastRow,
                        cellIndex === headers.length - 1 && styles.tableLastCell,
                      ]}
                    >
                      <InlineText text={row[cellIndex] ?? ""} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>,
      );
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#{1,6}\s/, "");
      const headingStyle =
        level <= 2 ? styles.headingLarge : level === 3 ? styles.headingMedium : styles.headingSmall;
      blocks.push(
        <Text key={`heading-${index}`} style={headingStyle}>
          <InlineText text={text} />
        </Text>,
      );
      continue;
    }

    if (/^([-*_])\s*\1\s*\1\s*$/.test(line.trim())) {
      blocks.push(<View key={`rule-${index}`} style={styles.rule} />);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [line.replace(/^\s*>\s?/, "")];
      while (index + 1 < lines.length && /^\s*>/.test(lines[index + 1])) {
        index += 1;
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
      }
      blocks.push(
        <View key={`quote-${index}`} style={styles.quote}>
          <InlineText text={quoteLines.join("\n")} />
        </View>,
      );
      continue;
    }

    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <View key={`list-${index}`} style={styles.list}>
          {items.map((item, itemIndex) => (
            <View key={itemIndex} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <InlineText text={item} style={styles.listText} />
            </View>
          ))}
        </View>,
      );
      continue;
    }

    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <View key={`ordered-${index}`} style={styles.list}>
          {items.map((item, itemIndex) => (
            <View key={itemIndex} style={styles.listItem}>
              <Text style={styles.number}>{itemIndex + 1}.</Text>
              <InlineText text={item} style={styles.listText} />
            </View>
          ))}
        </View>,
      );
      continue;
    }

    blocks.push(
      <InlineText key={`p-${index}`} text={line} style={styles.paragraph} />,
    );
  }

  return <View style={styles.content}>{blocks}</View>;
}

const styles = StyleSheet.create({
  content: { gap: 8 },
  inline: { fontSize: 15, lineHeight: 22, color: COLORS.text },
  paragraph: { fontSize: 15, lineHeight: 22, color: COLORS.text },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  boldItalic: { fontWeight: "700", fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
  strike: { textDecorationLine: "line-through" },
  link: { color: COLORS.navy, textDecorationLine: "underline", fontWeight: "600" },
  inlineCode: {
    fontFamily: "monospace",
    backgroundColor: "#EEF1F5",
    color: "#26384F",
  },
  headingLarge: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: COLORS.text },
  headingMedium: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: COLORS.text },
  headingSmall: { fontSize: 16, lineHeight: 22, fontWeight: "700", color: COLORS.text },
  codeBlock: {
    width: "100%",
    borderRadius: 10,
    backgroundColor: "#172033",
    padding: 12,
  },
  codeLanguage: {
    color: "#AFC1DC",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 8,
  },
  codeText: { color: "#F7FAFF", fontFamily: "monospace", fontSize: 13, lineHeight: 20 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.navy,
    backgroundColor: COLORS.navyTint,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  list: { gap: 5 },
  listItem: { flexDirection: "row", alignItems: "flex-start" },
  bullet: { width: 18, fontSize: 15, lineHeight: 22, color: COLORS.navy },
  number: { width: 26, fontSize: 15, lineHeight: 22, color: COLORS.navy, fontWeight: "600" },
  listText: { flex: 1 },
  rule: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  tableScroll: {
    width: "100%",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingBottom: 8,
  },
  table: { alignItems: "flex-start", flexGrow: 1 },
  tableMatrix: { flexDirection: "column", alignItems: "flex-start" },
  tableRow: { flexDirection: "row" },
  tableCell: {
    width: 112,
    minHeight: 44,
    justifyContent: "center",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableHeader: { backgroundColor: COLORS.navyTint },
  tableLastCell: { borderRightWidth: 0 },
  tableLastRow: { borderBottomWidth: 0 },
});
