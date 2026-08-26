/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { genId, normName, normRoll, readSemester } from "@/lib/normalize";
import { normalizeMstConfig, publicStage, startMst } from "@/lib/mst";
import type { GroupInfo, Question, QuizSettings, StudentInfo } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: "Missing quiz link." }, { status: 400 });

  const rows = await q<{ id: string; questions: Question[]; settings: QuizSettings; accepting: boolean }>(
    `SELECT id, questions, settings, accepting FROM quizzes WHERE slug = $1`,
    [body.slug]
  );
  if (!rows.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = rows[0];
  const settings = quiz.settings;
  if (!quiz.accepting || (settings.closesAt && Date.now() > new Date(settings.closesAt).getTime())) {
    return NextResponse.json({ error: "This quiz is no longer accepting responses." }, { status: 403 });
  }

  let student: StudentInfo;
  let group: GroupInfo | null = null;

  if (settings.groupMode) {
    const g = body.group;
    const groupName = typeof g?.name === "string" ? g.name.trim() : "";
    const semester = readSemester(g?.semester);
    const rawMembers: unknown[] = Array.isArray(g?.members) ? g.members : [];
    if (!groupName || semester === null || rawMembers.length === 0) {
      return NextResponse.json({ error: "Please fill in your group name, semester and every member's details." }, { status: 400 });
    }
    const lo = settings.groupMin ?? 1;
    const hi = settings.groupMax ?? lo;
    if (rawMembers.length < lo || rawMembers.length > hi) {
      return NextResponse.json({ error: `This quiz expects ${lo === hi ? lo : `${lo} to ${hi}`} members per group.` }, { status: 400 });
    }
    const members: { name: string; roll: string }[] = [];
    for (const [i, raw] of rawMembers.entries()) {
      const m = raw as { name?: unknown; roll?: unknown };
      const name = typeof m?.name === "string" ? normName(m.name) : "";
      const roll = typeof m?.roll === "string" ? m.roll.trim() : "";
      if (!name || !/^\d{1,15}$/.test(roll)) {
        return NextResponse.json({ error: `Member ${i + 1}: a name and a digits-only roll number are required.` }, { status: 400 });
      }
      members.push({ name, roll: normRoll(roll) });
    }
    const rollSet = new Set(members.map((m) => m.roll));
    if (rollSet.size !== members.length) {
      return NextResponse.json({ error: "Two group members have the same roll number — each member must be listed once." }, { status: 400 });
    }
    group = { name: groupName, nameNorm: groupName.replace(/\s+/g, " ").toLowerCase(), semester, members };

    if (!settings.allowMultiple) {
      const prior = await q<{ group_info: GroupInfo | null; student: StudentInfo }>(
        `SELECT group_info, student FROM attempts WHERE quiz_id = $1 AND status = 'submitted'`,
        [quiz.id]
      );
      for (const p of prior) {
        const pg = p.group_info;
        if (!pg || pg.semester !== semester) continue;
        if (pg.nameNorm === group.nameNorm) {
          return NextResponse.json(
            { error: "A group with this name has already submitted. Ask your teacher if you need another attempt." },
            { status: 409 }
          );
        }
        const clash = pg.members.find((m) => rollSet.has(m.roll));
        if (clash) {
          return NextResponse.json(
            { error: `Roll number ${clash.roll} has already submitted with group “${pg.name}”. Ask your teacher if you need another attempt.` },
            { status: 409 }
          );
        }
      }
    }

    // The first listed member stands in as the attempt's student record.
    const leader = members[0];
    student = { name: leader.name, roll: leader.roll, semester, nameNorm: leader.name.toLowerCase(), rollNorm: leader.roll };
  } else {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const roll = typeof body?.roll === "string" ? body.roll.trim() : "";
    const semester = readSemester(body?.semester);
    if (!name || !roll || semester === null) {
      return NextResponse.json({ error: "Please fill in your name, roll number and semester." }, { status: 400 });
    }
    if (!/^\d{1,15}$/.test(roll)) {
      return NextResponse.json({ error: "Roll number must contain digits only." }, { status: 400 });
    }

    student = {
      name: normName(name),
      roll,
      semester,
      nameNorm: normName(name).toLowerCase(),
      rollNorm: normRoll(roll),
    };

    if (!settings.allowMultiple) {
      const dup = await q(
        `SELECT id FROM attempts
          WHERE quiz_id = $1 AND status = 'submitted'
            AND student->>'rollNorm' = $2 AND (student->>'semester')::int = $3
          LIMIT 1`,
        [quiz.id, student.rollNorm, semester]
      );
      if (dup.length) {
        return NextResponse.json(
          { error: "A response with this roll number has already been submitted. Ask your teacher if you need another attempt." },
          { status: 409 }
        );
      }
    }
  }

  const id = genId();
  // An adaptive paper is dealt from the server: the first stage is drawn now and
  // stored with the attempt, and the student is only ever sent the stage they
  // are sitting. See lib/mst.ts.
  const mstConfig = settings.mstMode ? normalizeMstConfig(settings.mst) : null;
  const mstState = mstConfig ? startMst(quiz.questions as Question[], mstConfig) : null;

  await q(`INSERT INTO attempts (id, quiz_id, student, group_info, mst) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    quiz.id,
    JSON.stringify(student),
    group ? JSON.stringify(group) : null,
    mstState ? JSON.stringify(mstState) : null,
  ]);

  const startedAt = Date.now();
  let deadlineAt: number | undefined;
  if (settings.timerMode === "quiz" && settings.maxMinutes) {
    deadlineAt = startedAt + settings.maxMinutes * 60_000;
  } else if (settings.timerMode === "question" && settings.perQuestionSeconds) {
    deadlineAt = startedAt + (quiz.questions as Question[]).length * settings.perQuestionSeconds * 1000;
  }
  if (settings.closesAt) {
    const closes = new Date(settings.closesAt).getTime();
    deadlineAt = deadlineAt ? Math.min(deadlineAt, closes) : undefined;
  }

  return NextResponse.json({
    attemptId: id,
    serverNow: startedAt,
    deadlineAt,
    ...(mstState && mstConfig
      ? {
          mst: {
            stage: mstState.stage,
            totalStages: mstConfig.stages,
            questions: publicStage(quiz.questions as Question[], mstState),
          },
        }
      : {}),
  });
}
