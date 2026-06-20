-- schema.sql — AGENT-ISA storage, designed for the migration path:
-- start as a simple rules table, upgrade to full programs without
-- migrating data. Postgres syntax; trivially portable to MySQL/SQLite.

-- ============================================================
-- 1. PROGRAMS: a named playbook (your F-block, G-block)
-- ============================================================
CREATE TABLE programs (
    id            SERIAL PRIMARY KEY,
    code          TEXT NOT NULL,            -- 'morning_mail', 'g2_dee_ack'
    version       INT  NOT NULL DEFAULT 1,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    schedule_cron TEXT,                     -- '0 5 * * *' or NULL (manual)
    auto_allow    JSONB NOT NULL DEFAULT '[]',  -- tools SEND may use ungated
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (code, version)
);

-- ============================================================
-- 2. INSTRUCTIONS: the ISA. Each row = one opcode.
--    THE MIGRATION TRICK: a "simple rule" is just a program
--    with 2-4 rows (FETCH, INFER, NOTIFY, HALT). Start by only
--    ever writing those shapes; you're using a rules table.
--    Later, write longer programs with jumps and gates into the
--    SAME table; the interpreter doesn't care. No migration.
-- ============================================================
CREATE TABLE instructions (
    id          SERIAL PRIMARY KEY,
    program_id  INT NOT NULL REFERENCES programs(id),
    seq         INT NOT NULL,               -- order = program counter
    label       TEXT,                       -- 'START', 'DONE', or NULL
    op          TEXT NOT NULL,              -- 'FETCH','INFER','GATE',...
    args        JSONB NOT NULL DEFAULT '[]',
    UNIQUE (program_id, seq)
);

-- ============================================================
-- 3. RUNS: one execution of a program (append-only)
-- ============================================================
CREATE TABLE runs (
    id           BIGSERIAL PRIMARY KEY,
    program_id   INT NOT NULL REFERENCES programs(id),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    state        TEXT NOT NULL DEFAULT 'RUNNING',
                 -- RUNNING|AWAITING_APPROVAL|HALTED|ERROR|EXPIRED
    trigger      TEXT NOT NULL DEFAULT 'cron'   -- cron|manual|resume
);

-- ============================================================
-- 4. TRANSCRIPT: every executed instruction (append-only, forever)
--    This is the same audit spine as the eval harness.
-- ============================================================
CREATE TABLE transcript (
    id        BIGSERIAL PRIMARY KEY,
    run_id    BIGINT NOT NULL REFERENCES runs(id),
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    pc        INT NOT NULL,
    op        TEXT NOT NULL,
    detail    JSONB NOT NULL                -- resolved args, results, flags
);
CREATE INDEX ON transcript (run_id);

-- ============================================================
-- 5. APPROVALS: frozen gates awaiting a human (the 479-byte rows)
-- ============================================================
CREATE TABLE approvals (
    id          BIGSERIAL PRIMARY KEY,
    run_id      BIGINT NOT NULL REFERENCES runs(id),
    snapshot    JSONB NOT NULL,             -- full VM state at the GATE
    reason      JSONB,                      -- what GATE showed the human
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,       -- now() + interval '12 hours'
    decided_at  TIMESTAMPTZ,
    decision    TEXT                        -- approved|denied|expired
);

-- ============================================================
-- Append-only enforcement (invariant 3): no UPDATE/DELETE on the
-- audit trail, even from yourself. Corrections are new rows.
-- ============================================================
REVOKE UPDATE, DELETE ON transcript FROM PUBLIC;
-- approvals.decided_at/decision are the only mutable audit fields:
-- handle via a SECURITY DEFINER function or a dedicated role.

-- ============================================================
-- Example: G-block as rows (what the dashboard editor writes)
-- ============================================================
-- INSERT INTO programs (code, schedule_cron) VALUES ('g2_dee_ack', '0 19 * * *');
-- INSERT INTO instructions (program_id, seq, label, op, args) VALUES
--  (1, 0, 'START',  'FETCH',  '["r0","mail_read",{"from":"dee@co.com","unanswered":true}]'),
--  (1, 1, NULL,     'TEST',   '["r0.messages"]'),
--  (1, 2, NULL,     'JZ',     '["DONE"]'),
--  (1, 3, NULL,     'INFER',  '["r1","Draft a brief ack reply. Return {to,subject,body}.","r0.messages.0"]'),
--  (1, 4, NULL,     'GATE',   '["r1"]'),
--  (1, 5, NULL,     'JZ',     '["DENIED"]'),
--  (1, 6, NULL,     'SEND',   '["mail_send",{"to":"r1.to","subject":"r1.subject","body":"r1.body"}]'),
--  (1, 7, NULL,     'NOTIFY', '["phone","Reply to Dee sent.",{"priority":1}]'),
--  (1, 8, NULL,     'HALT',   '[]'),
--  (1, 9, 'DENIED', 'LOG',    '["human denied G-reply to Dee"]'),
--  (1,10, 'DONE',   'HALT',   '[]');
