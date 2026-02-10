"use client";
/* eslint-disable jsx-a11y/alt-text */

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

const pdfFontFamily = "SecondaPdfCJK";
let pdfFontRegistered = false;

function ensurePdfFontRegistered() {
  if (pdfFontRegistered) return;

  Font.register({
    family: pdfFontFamily,
    fonts: [
      {
        src: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/OTF/SimplifiedChinese/SourceHanSansSC-Regular.otf",
        fontWeight: 400,
      },
      {
        src: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/OTF/SimplifiedChinese/SourceHanSansSC-Bold.otf",
        fontWeight: 700,
      },
    ],
  });

  pdfFontRegistered = true;
}

ensurePdfFontRegistered();

export interface ReportPdfQuestionItem {
  id: string;
  questionIndex: number;
  question: string;
  answerText: string | null;
  score: number;
  strengths: string[];
  improvements: string[];
  advice: string[];
}

interface ReportPdfDocumentLabels {
  score: string;
  interviewType: string;
  targetLevel: string;
  questions: string;
  analysisSummary: string;
  topStrength: string;
  criticalFocus: string;
  noAnalysisData: string;
  yourAnswer: string;
  strengths: string;
  improvements: string;
  advice: string;
  exportedFor: string;
  generatedAt: string;
  detailedAnalysis: string;
}

interface ReportPdfDocumentProps {
  websiteName: string;
  logoDataUrl: string;
  reportTitle: string;
  userName: string;
  generatedAtText: string;
  interviewId: string;
  overallScore: number;
  interviewTypeLabel: string;
  levelLabel: string;
  questionCount: number;
  summary: string;
  topStrengths: string[];
  criticalFocus: string[];
  questions: ReportPdfQuestionItem[];
  labels: ReportPdfDocumentLabels;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    color: "#0F172A",
    fontFamily: pdfFontFamily,
    fontSize: 10,
    paddingTop: 28,
    paddingRight: 28,
    paddingBottom: 28,
    paddingLeft: 28,
    position: "relative",
  },
  watermarkLayer: {
    position: "absolute",
    top: 24,
    right: 24,
    bottom: 24,
    left: 24,
    flexDirection: "row",
    flexWrap: "wrap",
    opacity: 0.09,
  },
  watermarkItem: {
    width: "33.33%",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
    paddingLeft: 10,
  },
  watermarkLogo: {
    width: 10,
    height: 10,
    marginRight: 4,
  },
  watermarkText: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: 700,
  },
  section: {
    position: "relative",
    zIndex: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandLogo: {
    width: 24,
    height: 24,
    marginRight: 8,
  },
  websiteName: {
    fontSize: 10,
    color: "#475569",
    marginBottom: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
  },
  metaPanel: {
    textAlign: "right",
    color: "#64748B",
    fontSize: 9,
    lineHeight: 1.5,
  },
  metaValue: {
    color: "#334155",
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  statCard: {
    width: "24%",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingTop: 8,
    paddingRight: 8,
    paddingBottom: 8,
    paddingLeft: 8,
  },
  statLabel: {
    fontSize: 9,
    color: "#64748B",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: 700,
    color: "#0F172A",
  },
  block: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingTop: 8,
    paddingRight: 9,
    paddingBottom: 8,
    paddingLeft: 9,
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    color: "#0F172A",
  },
  bodyText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: "#334155",
  },
  twoColumns: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  halfColumn: {
    width: "49%",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingTop: 8,
    paddingRight: 9,
    paddingBottom: 8,
    paddingLeft: 9,
  },
  listItem: {
    fontSize: 9,
    lineHeight: 1.5,
    color: "#334155",
    marginBottom: 2,
  },
  detailsTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
    color: "#0F172A",
  },
  questionCard: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingTop: 8,
    paddingRight: 9,
    paddingBottom: 8,
    paddingLeft: 9,
    marginBottom: 8,
  },
  questionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  questionText: {
    width: "78%",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.4,
    color: "#0F172A",
  },
  scoreBadge: {
    width: "20%",
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    textAlign: "center",
    fontSize: 8.5,
    color: "#334155",
    paddingTop: 3,
    paddingBottom: 3,
  },
  answerLabel: {
    fontSize: 8.5,
    color: "#64748B",
    marginBottom: 2,
  },
  answerText: {
    fontSize: 9,
    lineHeight: 1.45,
    color: "#334155",
    marginBottom: 6,
  },
  feedbackGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  feedbackCol: {
    width: "32%",
  },
  feedbackLabel: {
    fontSize: 8.5,
    color: "#475569",
    marginBottom: 2,
    fontWeight: 700,
  },
  feedbackItem: {
    fontSize: 8.3,
    lineHeight: 1.4,
    color: "#334155",
    marginBottom: 1,
  },
});

function renderTextList(items: string[]) {
  return items.map((item, index) => (
    <Text key={`${item}-${index}`} style={styles.listItem}>
      - {item}
    </Text>
  ));
}

export function ReportPdfDocument({
  websiteName,
  logoDataUrl,
  reportTitle,
  userName,
  generatedAtText,
  interviewId,
  overallScore,
  interviewTypeLabel,
  levelLabel,
  questionCount,
  summary,
  topStrengths,
  criticalFocus,
  questions,
  labels,
}: ReportPdfDocumentProps) {
  return (
    <Document title={`${websiteName} ${reportTitle}`}>
      <Page size="A4" style={styles.page} wrap>
        <View fixed style={styles.watermarkLayer}>
          {Array.from({ length: 45 }).map((_, index) => (
            <View key={`watermark-${index}`} style={styles.watermarkItem}>
              <Image src={logoDataUrl} style={styles.watermarkLogo} />
              <Text style={styles.watermarkText}>{websiteName}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <Image src={logoDataUrl} style={styles.brandLogo} />
              <View>
                <Text style={styles.websiteName}>{websiteName}</Text>
                <Text style={styles.title}>{reportTitle}</Text>
              </View>
            </View>
            <View style={styles.metaPanel}>
              <Text>
                {labels.exportedFor}: <Text style={styles.metaValue}>{userName}</Text>
              </Text>
              <Text>
                {labels.generatedAt}:{" "}
                <Text style={styles.metaValue}>{generatedAtText}</Text>
              </Text>
              <Text>
                ID: <Text style={styles.metaValue}>{interviewId}</Text>
              </Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{labels.score}</Text>
              <Text style={styles.statValue}>{overallScore}/100</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{labels.interviewType}</Text>
              <Text style={styles.statValue}>{interviewTypeLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{labels.targetLevel}</Text>
              <Text style={styles.statValue}>{levelLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{labels.questions}</Text>
              <Text style={styles.statValue}>{questionCount}</Text>
            </View>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>{labels.analysisSummary}</Text>
            <Text style={styles.bodyText}>{summary}</Text>
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.halfColumn}>
              <Text style={styles.blockTitle}>{labels.topStrength}</Text>
              {topStrengths.length > 0 ? (
                renderTextList(topStrengths)
              ) : (
                <Text style={styles.bodyText}>{labels.noAnalysisData}</Text>
              )}
            </View>
            <View style={styles.halfColumn}>
              <Text style={styles.blockTitle}>{labels.criticalFocus}</Text>
              {criticalFocus.length > 0 ? (
                renderTextList(criticalFocus)
              ) : (
                <Text style={styles.bodyText}>{labels.noAnalysisData}</Text>
              )}
            </View>
          </View>

          <Text style={styles.detailsTitle}>{labels.detailedAnalysis}</Text>

          {questions.map((question) => (
            <View key={question.id} style={styles.questionCard}>
              <View style={styles.questionHead}>
                <Text style={styles.questionText}>
                  Q{question.questionIndex}. {question.question}
                </Text>
                <Text style={styles.scoreBadge}>
                  {labels.score}: {question.score}/10
                </Text>
              </View>

              {question.answerText ? (
                <View>
                  <Text style={styles.answerLabel}>{labels.yourAnswer}</Text>
                  <Text style={styles.answerText}>{question.answerText}</Text>
                </View>
              ) : null}

              <View style={styles.feedbackGrid}>
                <View style={styles.feedbackCol}>
                  <Text style={styles.feedbackLabel}>{labels.strengths}</Text>
                  {question.strengths.length > 0 ? (
                    question.strengths.map((item, index) => (
                      <Text key={`strength-${question.id}-${index}`} style={styles.feedbackItem}>
                        - {item}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.feedbackItem}>{labels.noAnalysisData}</Text>
                  )}
                </View>

                <View style={styles.feedbackCol}>
                  <Text style={styles.feedbackLabel}>{labels.improvements}</Text>
                  {question.improvements.length > 0 ? (
                    question.improvements.map((item, index) => (
                      <Text
                        key={`improvement-${question.id}-${index}`}
                        style={styles.feedbackItem}
                      >
                        - {item}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.feedbackItem}>{labels.noAnalysisData}</Text>
                  )}
                </View>

                <View style={styles.feedbackCol}>
                  <Text style={styles.feedbackLabel}>{labels.advice}</Text>
                  {question.advice.length > 0 ? (
                    question.advice.map((item, index) => (
                      <Text key={`advice-${question.id}-${index}`} style={styles.feedbackItem}>
                        - {item}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.feedbackItem}>{labels.noAnalysisData}</Text>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
