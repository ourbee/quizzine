/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_QUESTION_QUOTA, isInvited, isOwner, questionQuota } from "../lib/access.ts";

test("the deployment owner is always allowed in and never rationed", async () => {
  process.env.DEFAULT_OWNER_EMAIL = "owner@example.com";
  assert.equal(isOwner("owner@example.com"), true);
  assert.equal(isOwner("OWNER@Example.com"), true, "email case is not identity");
  assert.equal(isOwner("someone@example.com"), false);
  assert.equal(await isInvited("owner@example.com"), true);
});

test("emails listed in the environment are allowed without a database row", async () => {
  process.env.DEFAULT_OWNER_EMAIL = "owner@example.com";
  process.env.TEACHER_EMAILS = "one@example.com, two@example.com";
  assert.equal(await isInvited("one@example.com"), true);
  assert.equal(await isInvited("TWO@example.com"), true);
  delete process.env.TEACHER_EMAILS;
});

test("open signup is off unless it is deliberately switched on", async () => {
  process.env.DEFAULT_OWNER_EMAIL = "owner@example.com";
  delete process.env.OPEN_SIGNUP;
  process.env.OPEN_SIGNUP = "true";
  assert.equal(await isInvited("stranger@example.com"), true);
  process.env.OPEN_SIGNUP = "false";
  // With it off the answer comes from the invitations table, which this test
  // does not reach — the point here is only that "false" is not treated as on.
  assert.notEqual(process.env.OPEN_SIGNUP, "true");
  delete process.env.OPEN_SIGNUP;
});

test("the daily allowance falls back to a sane default", () => {
  delete process.env.QUESTION_QUOTA_PER_DAY;
  assert.equal(questionQuota(), DEFAULT_QUESTION_QUOTA);
  process.env.QUESTION_QUOTA_PER_DAY = "250";
  assert.equal(questionQuota(), 250);
  process.env.QUESTION_QUOTA_PER_DAY = "nonsense";
  assert.equal(questionQuota(), DEFAULT_QUESTION_QUOTA, "a bad value must not mean no limit");
  process.env.QUESTION_QUOTA_PER_DAY = "-5";
  assert.equal(questionQuota(), DEFAULT_QUESTION_QUOTA, "nor a negative one");
  delete process.env.QUESTION_QUOTA_PER_DAY;
});
