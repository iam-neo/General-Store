"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

type DiagnosticState = {
  loading: boolean;
  activeAction: string | null;
  mode: "live" | "mock" | null;
  health: {
    status: string;
    backend: string;
    version: string;
    timestamp: string;
  } | null;
  schema: {
    isCompatible: boolean;
    checkedAt: string;
    sheets: Array<{
      name: string;
      exists: boolean;
      status: string;
      rowCount: number;
      missingHeaders: string[];
      extraHeaders: string[];
    }>;
  } | null;
  testResult: {
    step: string;
    testId?: string;
    message?: string;
    nonce?: string;
    readConfirmed?: boolean;
    cleanedUp?: boolean;
    error?: string;
  } | null;
  rawOutput: string | null;
  error: string | null;
};

export function BackendDiagnostic() {
  const { t } = useLocale();
  const [state, setState] = useState<DiagnosticState>({
    loading: false,
    activeAction: null,
    mode: null,
    health: null,
    schema: null,
    testResult: null,
    rawOutput: null,
    error: null,
  });

  async function runHealthCheck() {
    setState((prev) => ({ ...prev, loading: true, activeAction: "health", error: null }));
    try {
      const res = await fetch("/api/system/health");
      const json = await res.json();
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        mode: json.meta?.mode ?? "mock",
        health: json.data,
        rawOutput: JSON.stringify(json, null, 2),
      }));
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        error: err instanceof Error ? err.message : "Health check request failed",
      }));
    }
  }

  async function checkSchemaStatus() {
    setState((prev) => ({ ...prev, loading: true, activeAction: "schema", error: null }));
    try {
      const res = await fetch("/api/system/schema-status");
      const json = await res.json();
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        mode: json.meta?.mode ?? "mock",
        schema: json.data,
        rawOutput: JSON.stringify(json, null, 2),
      }));
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        error: err instanceof Error ? err.message : "Schema check request failed",
      }));
    }
  }

  async function initializeDatabase() {
    setState((prev) => ({ ...prev, loading: true, activeAction: "init", error: null }));
    try {
      const res = await fetch("/api/system/init-database", { method: "POST" });
      const json = await res.json();
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        mode: json.meta?.mode ?? "mock",
        schema: json.data?.schemaStatus,
        rawOutput: JSON.stringify(json, null, 2),
      }));
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        error: err instanceof Error ? err.message : "Database initialization request failed",
      }));
    }
  }

  async function runReadWriteTest() {
    setState((prev) => ({
      ...prev,
      loading: true,
      activeAction: "test",
      error: null,
      testResult: { step: "Creating test record..." },
    }));

    try {
      const nonce = `test-nonce-${Date.now()}`;
      const message = "Phase 4 controlled read/write test verification";

      // Step 1: Create test record
      const createRes = await fetch("/api/system/test-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, nonce }),
      });
      const createJson = await createRes.json();

      if (!createJson.success) {
        throw new Error(createJson.error?.message || "Test record creation failed");
      }

      const createdRecord = createJson.data;
      setState((prev) => ({
        ...prev,
        testResult: {
          step: "Record created. Reading back...",
          testId: createdRecord.test_id,
          nonce: createdRecord.nonce,
          message: createdRecord.message,
        },
      }));

      // Step 2: Read back record
      const readRes = await fetch(`/api/system/test-record?id=${encodeURIComponent(createdRecord.test_id)}`);
      const readJson = await readRes.json();

      if (!readJson.success) {
        throw new Error(readJson.error?.message || "Test record readback failed");
      }

      setState((prev) => ({
        ...prev,
        testResult: {
          step: "Read verified. Cleaning up test record...",
          testId: createdRecord.test_id,
          nonce: createdRecord.nonce,
          message: createdRecord.message,
          readConfirmed: true,
        },
      }));

      // Step 3: Cleanup test record
      const deleteRes = await fetch(`/api/system/test-record?id=${encodeURIComponent(createdRecord.test_id)}`, {
        method: "DELETE",
      });
      const deleteJson = await deleteRes.json();

      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        mode: createJson.meta?.mode ?? "mock",
        testResult: {
          step: "Complete: Verified safe write, read, and cleanup.",
          testId: createdRecord.test_id,
          nonce: createdRecord.nonce,
          message: createdRecord.message,
          readConfirmed: true,
          cleanedUp: deleteJson.success,
        },
        rawOutput: JSON.stringify({ create: createJson, read: readJson, delete: deleteJson }, null, 2),
      }));
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        activeAction: null,
        error: err instanceof Error ? err.message : "Test workflow failed",
        testResult: {
          step: "Failed",
          error: err instanceof Error ? err.message : "Unknown error",
        },
      }));
    }
  }

  return (
    <section aria-labelledby="diagnostic-title" className="diagnostic-card mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Icon name="settings" size={14} />
            {t("technicalDiagnostics")} · Phase 4
          </span>
          <h3 id="diagnostic-title" className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {t("technicalDiagnostics")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("backendDiagnosticSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("backendMode")}:</span>
          <span
            className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ${
              state.mode === "live"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }`}
          >
            {state.mode === "live" ? t("backendLive") : t("backendMock")}
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={state.loading}
          onClick={runHealthCheck}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-xs font-medium text-secondary-foreground transition hover:bg-secondary/80 disabled:opacity-50"
        >
          {state.activeAction === "health" ? "Checking..." : t("pingHealth")}
        </button>

        <button
          type="button"
          disabled={state.loading}
          onClick={checkSchemaStatus}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-xs font-medium text-secondary-foreground transition hover:bg-secondary/80 disabled:opacity-50"
        >
          {state.activeAction === "schema" ? "Inspecting..." : t("checkSchema")}
        </button>

        <button
          type="button"
          disabled={state.loading}
          onClick={initializeDatabase}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {state.activeAction === "init" ? "Initializing..." : t("initDatabase")}
        </button>

        <button
          type="button"
          disabled={state.loading}
          onClick={runReadWriteTest}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {state.activeAction === "test" ? "Testing..." : t("runTestOperation")}
        </button>
      </div>

      {state.error && (
        <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <strong>Error:</strong> {state.error}
        </div>
      )}

      {state.testResult && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 text-xs">
          <p className="font-semibold text-foreground">Test Workflow Progress:</p>
          <p className="mt-1 text-muted-foreground">{state.testResult.step}</p>
          {state.testResult.testId && (
            <p className="mt-1 text-muted-foreground">
              Record ID: <code className="font-mono">{state.testResult.testId}</code>
            </p>
          )}
          {state.testResult.readConfirmed && (
            <p className="mt-1 text-emerald-600 dark:text-emerald-400">✓ Readback verified from isolated SystemTest sheet</p>
          )}
          {state.testResult.cleanedUp && (
            <p className="mt-1 text-emerald-600 dark:text-emerald-400">✓ Test record cleaned up safely</p>
          )}
        </div>
      )}

      {state.schema && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sheet Compatibility ({state.schema.isCompatible ? "All Compatible" : "Action Needed"})
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {state.schema.sheets.map((sheet) => (
              <div
                key={sheet.name}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-xs"
              >
                <div>
                  <span className="font-medium text-foreground">{sheet.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {sheet.exists ? `${sheet.rowCount} records` : "Not created yet"}
                  </span>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    sheet.status === "ok"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {sheet.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.rawOutput && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            View raw technical payload
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] text-muted-foreground">
            {state.rawOutput}
          </pre>
        </details>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground">
        {t("diagnosticNotice")}
      </p>
    </section>
  );
}
