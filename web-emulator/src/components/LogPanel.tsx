import React, { useEffect, useState } from "react";
import { requestLogStore, RequestLogEntry } from "../api/logStore";

function formatTs(ts: number) {
  const d = new Date(ts);
  return (
    d.toLocaleTimeString(undefined, { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

export const LogPanel: React.FC = () => {
  const [entries, setEntries] = useState<RequestLogEntry[]>(
    requestLogStore.all()
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => requestLogStore.subscribe(setEntries), []);

  return (
    <div className="bg-white border rounded-md flex flex-col h-80 shadow-sm">
      <div className="px-3 py-2 border-b flex items-center gap-3 text-xs">
        <span className="font-semibold">API Log</span>
        <span className="text-neutral-500">{entries.length}</span>
        <button
          className="ml-auto text-neutral-500 hover:text-red-600 transition-colors"
          onClick={() => requestLogStore.clear()}
        >
          Clear
        </button>
      </div>
      <div className="overflow-auto text-[11px] font-mono leading-snug">
        {entries.length === 0 && (
          <div className="p-3 text-neutral-400">No requests yet</div>
        )}
        {entries.map((e) => {
          const statusClass = e.error
            ? "text-red-600"
            : e.responseStatus && e.responseStatus >= 400
            ? "text-orange-600"
            : "text-green-600";
          return (
            <div key={e.id} className="border-b last:border-b-0">
              <button
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="w-full text-left px-2 py-1 hover:bg-neutral-50 flex items-center gap-2"
              >
                <span className="text-neutral-500 tabular-nums">
                  {formatTs(e.ts)}
                </span>
                <span className="font-semibold">{e.method}</span>
                <span className="truncate flex-1">
                  {e.url.replace(/^https?:\/\//, "")}
                </span>
                {e.responseStatus !== undefined && (
                  <span className={statusClass}>{e.responseStatus}</span>
                )}
                {e.error && <span className="text-red-600">ERR</span>}
                <span className="text-neutral-400">
                  {expanded === e.id ? "−" : "+"}
                </span>
              </button>
              {expanded === e.id && (
                <div className="px-3 pb-2 space-y-1">
                  <div className="text-neutral-600">
                    Duration: {Math.round(e.durationMs || 0)} ms
                  </div>
                  <details open>
                    <summary className="cursor-pointer">Request</summary>
                    <pre className="bg-neutral-100 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                      {JSON.stringify(
                        { headers: e.requestHeaders, body: e.requestBody },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                  <details open>
                    <summary className="cursor-pointer">Response</summary>
                    <pre className="bg-neutral-100 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                      {e.error
                        ? e.error
                        : JSON.stringify(
                            {
                              status: e.responseStatus,
                              headers: e.responseHeaders,
                              body: e.responseBody,
                            },
                            null,
                            2
                          )}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
