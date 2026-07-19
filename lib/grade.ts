import type { PerQuestionResult, Question } from "./types";

export function grade(questions: Question[], answers: Record<string, string>) {
  const per: PerQuestionResult[] = [];
  let score = 0;
  let max = 0;
  let pending = 0;

  for (const qn of questions) {
    const raw = answers[qn.id];
    const answer = typeof raw === "string" ? raw.trim() : "";
    max += qn.points;
    if (qn.type === "mcq") {
      const correct = answer !== "" && answer === qn.correct;
      if (correct) score += qn.points;
      per.push({ qid: qn.id, answer: answer || undefined, correct, awarded: correct ? qn.points : 0, pending: false });
    } else {
      pending++;
      per.push({ qid: qn.id, answer: answer || undefined, awarded: 0, pending: true });
    }
  }
  return { per, score, max, pending };
}
