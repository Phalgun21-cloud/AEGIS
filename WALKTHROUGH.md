# AEGIS walkthrough: from a question to a submitted exam

This walks one exam through the whole pipeline by hand:

author writes → reviewer approves → admin plans, generates and schedules → candidate takes it
→ admin reads the results.

It works the same locally (http://localhost:3000) and on the deployed site.

## Before you start

- **You need four accounts: admin, author, reviewer and candidate.**
  - Locally they are in `TEST_ACCOUNTS.local.md`.
  - On the deployed site, sign in as the admin and create the other three under
    **Users** → **New account**. Each needs an email, a full name, a role and an initial
    password of 10–15 characters.
- **Use a separate browser window for each role.** Each window stays signed in as one
  account. For example, use a normal window for one role and a private/incognito window for
  another, or two different browsers. Otherwise, sign out and back in between steps.
- **Rules worth knowing up front:**
  - Reviewers can't approve their own questions.
  - An exam's release time must be in the future.
  - The paper must be generated before the release time, because it is locked once
    released.
  - Candidates can only start once the exam is live.
  - Results appear only after the exam window closes.

## 1. Author: write questions

Sign in as the **author** → **My Questions** → **New question**.

1. Fill in:
   - **Subject**, for example `Chemistry`
   - **Topic**, for example `Atoms`
   - **Difficulty**: easy, medium or hard
   - **Marks**
   - **Question**
   - Two to eight **options**, with the correct one marked
   - An **Explanation** if you like (optional)
2. **Save draft** keeps the question for editing. **Submit for review** sends it to the
   reviewers.
3. Write a few questions this way. Keep the **subject and topic spelled the same** every time,
   because the blueprint matches on them. Capitalisation doesn't matter.

For a quick test, three questions are enough: one easy, one medium and one hard, all under
the same subject and topic.

## 2. Reviewer: approve or reject

Sign in as the **reviewer** → **Review Queue**.

1. Each submitted question is shown in full.
2. **Duplicate check** compares the question against approved questions in the same subject
   and flags likely copies.
3. Choose one:
   - **Approve & seal**. The question is encrypted into the vault. From then on, nobody can
     read it in plain text before an exam releases, not even the admin.
   - **Reject with feedback** (the feedback is required). The question goes back to the author, who sees the
     feedback, can edit it and can resubmit.

## 3. Admin: check the question bank

Sign in as the **admin** → **Question Bank**.

The bank shows only metadata (subject, topic, difficulty, marks, how often each question has
been used), never the content. The **coverage** table shows how many approved questions
exist for each topic and difficulty. Use it to plan the blueprint.

## 4. Admin: create the exam

Go to **Exams** → **New exam**.

1. Fill in:
   - **Title**
   - **Subject**. This must match the questions' subject.
   - **Candidate instructions**
   - **Release (start) time**. For a test now, set it **5–10 minutes from now**, which leaves
     time for the next two steps.
   - **Duration** per candidate, for example 10 minutes
   - **Window**: how long the exam stays open after release, for example 15 minutes
2. Click **Create exam** and open it. It starts in the **draft** state.

## 5. Admin: blueprint → generate → enrol

These are the tabs on the exam page.

1. **Blueprint.** Add rows of *topic + difficulty + count*, plus optional marks. For
   example: Atoms / easy / 1, Atoms / medium / 1, Atoms / hard / 1. Then click
   **Save blueprint**.
2. **AI Paper Generator** → **Generate & seal paper**. It:
   - takes approved questions from the vault for that subject,
   - drops near-duplicates,
   - fills each blueprint row, using the least-used questions first,
   - encrypts the finished paper under a new key.

   The exam becomes **sealed**. If there aren't enough approved questions, it tells you
   which row is short; approve more questions, then generate again. **Regenerate paper**
   replaces the paper any time before release.
3. **Candidates.** Search for candidates, tick them and click **Enrol N selected**.
4. **Schedule.** Change the times here if you need to. Editing a sealed exam may discard the
   paper; if it does, generate again.

At the release time the exam turns **live** by itself.

## 6. Candidate: take the exam

Sign in as the **candidate** → **My Exams**.

1. The exam is listed as **Upcoming**, with a countdown. At release it turns **Open now**.
2. Open it → **Start exam**.
   - Your timer begins: the duration, cut short by the end of the window if that comes
     first.
3. Answer the questions using **← Previous** and **Next →**.
   - Answers **save automatically** ("Saving…" / "Saved").
   - Closing the tab is safe: **Resume** picks up where you left off.
4. **Submit** → **Submit now**. You get a receipt with a SHA-256 fingerprint of your answers.
   **View receipt** shows it again later.
5. If the time runs out first, the attempt is **submitted automatically** at the deadline.

## 7. Admin: watch it live and read the results

On the exam page:

- **Live Exam** shows, while the exam runs, who hasn't started, who's in progress, who has
  submitted, and how much each candidate has answered.
  - On the deployed site this says **Polling**, refreshing every 3 seconds. Locally it uses
    a live WebSocket.
- **Results** opens once the window closes. It shows:
  - the average, highest and lowest scores,
  - each candidate's score and submission time,
  - whether each attempt was auto-submitted,
  - each candidate's receipt fingerprint,
  - the percentage of correct answers for every question.

## 8. Admin: verify the audit trail

**Audit Logs** records every step above: sign-ins, question approvals, paper generation,
release, attempts and submissions. Entries are hash-chained. **Verify chain** confirms that
nothing has been altered or deleted.

## Quick-test timeline (about 20 minutes)

| Time | Who | What |
|---|---|---|
| 0:00 | Author | Write and submit 3 questions (easy, medium and hard; same subject and topic) |
| 0:05 | Reviewer | Approve all 3 |
| 0:07 | Admin | New exam, release in 8 minutes, duration 5, window 10 → blueprint → generate → enrol |
| 0:15 | Candidate | Exam opens → Start exam → answer → Submit |
| 0:25 | Admin | Window closed → Results, then Audit Logs → Verify chain |

## Troubleshooting

| What you see | Why |
|---|---|
| "Not enough distinct approved questions" when generating | A blueprint row asks for more approved questions than the vault has for that topic and difficulty, or the exam's subject or topic is spelled differently from the questions'. |
| "start_at must be in the future" | The release time has already passed. Pick a later time. |
| "Not allowed while the exam is live" | The paper and blueprint are locked after release. Make a new exam instead. |
| The candidate doesn't see the exam | They haven't been enrolled (Candidates tab), or they're signed in as a different account. |
| Results tab is empty | The window hasn't closed yet. |
| First page load on the deployed site takes up to a minute | The free Render server was asleep and is waking up. |
