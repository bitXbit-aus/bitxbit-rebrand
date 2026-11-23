"use client";

import { useEffect, useRef, useState } from "react";

/**
 * TEMPORARY diagnostic — an on-screen console for a real phone, opt-in with `?mwadebug=1`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Mobile Wallet Adapter flow fails ON THE DEVICE, and its failures are invisible:
 * the library wraps its launch in `try { … } catch {}`, and the Android app-launch and the
 * page↔wallet WebSocket cannot be reproduced from a desktop browser. Six rounds of
 * "nothing happens" could not be narrowed because there was nothing to read.
 *
 * This renders the things that would name the cause — the wallet registration, the CSP
 * violations, every WebSocket to the wallet, the localhost permission primer's outcome, and
 * console errors — directly on the screen, so a screenshot is the diagnosis.
 *
 * OPT-IN BY DESIGN: it does nothing unless the URL contains `mwadebug`. It hooks console,
 * fetch and WebSocket ONLY in that case, so production behaviour is untouched.
 *
 * REMOVE (or keep gated) once the mobile flow is verified end to end. It is instrumentation,
 * not a feature.
 */
export function WalletDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const buffer = useRef<string[]>([]);

  useEffect(() => {
    if (!/[?&]mwadebug/.test(window.location.search)) return;
    setEnabled(true);

    const push = (message: string) => {
      const stamp = new Date().toISOString().slice(11, 19);
      buffer.current = [...buffer.current.slice(-60), `${stamp} ${message}`];
      setLines(buffer.current);
    };

    const describe = (value: unknown): string =>
      value instanceof Error ? value.message : typeof value === "string" ? value : String(value);

    push(`env: ${navigator.userAgent}`);
    push(`selected wallet: ${localStorage.getItem("walletName") ?? "(none)"}`);
    push(`secure context: ${window.isSecureContext}`);

    // --- console ---
    for (const level of ["error", "warn"] as const) {
      const original = console[level];
      console[level] = (...args: unknown[]) => {
        push(`${level}: ${args.map(describe).join(" ")}`);
        original.apply(console, args);
      };
    }
    window.addEventListener("error", (e) => push(`error: ${describe(e.message)}`));
    window.addEventListener("unhandledrejection", (e) => push(`rejection: ${describe(e.reason)}`));

    // --- CSP: a blocked wallet iframe/websocket/fetch names its directive here ---
    document.addEventListener("securitypolicyviolation", (e) =>
      push(`CSP ${e.violatedDirective} blocked "${e.blockedURI}"`)
    );

    // --- the wallet transport ---
    const NativeWebSocket = window.WebSocket;
    const Hooked = function (
      this: unknown,
      url: string | URL,
      protocols?: string | string[]
    ) {
      push(`ws -> ${String(url)}`);
      const socket =
        protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      socket.addEventListener("open", () => push(`ws OPEN ${String(url)}`));
      socket.addEventListener("error", () => push(`ws ERROR ${String(url)}`));
      socket.addEventListener("close", (e) =>
        push(`ws CLOSE ${String(url)} code=${e.code}`)
      );
      return socket;
    } as unknown as typeof WebSocket;
    Hooked.prototype = NativeWebSocket.prototype;
    Object.assign(Hooked, {
      CONNECTING: NativeWebSocket.CONNECTING,
      OPEN: NativeWebSocket.OPEN,
      CLOSING: NativeWebSocket.CLOSING,
      CLOSED: NativeWebSocket.CLOSED,
    });
    window.WebSocket = Hooked;

    // --- the localhost permission primer ---
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("localhost")) return nativeFetch(input, init);
      push(`fetch -> ${url}`);
      return nativeFetch(input, init).then(
        (response) => {
          push(`fetch <- ${url} status=${response.status}`);
          return response;
        },
        (error: unknown) => {
          push(`fetch <- ${url} FAILED: ${describe(error)}`);
          throw error;
        }
      );
    };

    // --- is the mobile wallet actually registered in THIS browser? ---
    const found: string[] = [];
    const registry = {
      register: (...wallets: Array<{ name?: string }>) =>
        wallets.forEach((w) => found.push(w?.name ?? "(unnamed)")),
      unregister: () => {},
      get: () => found,
      on: () => {},
      off: () => {},
    };
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: registry }));
    push(
      `wallets registered: ${found.length > 0 ? found.join(", ") : "(none — MWA not registered here)"}`
    );

    return () => {
      window.WebSocket = NativeWebSocket;
      window.fetch = nativeFetch;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] max-h-[45vh] overflow-auto border-t border-green-500/40 bg-black/95 p-2 font-mono text-[10px] leading-tight text-green-400">
      <div className="mb-1 font-bold text-green-300">
        wallet debug (?mwadebug) — screenshot this if sign-in stalls
      </div>
      {lines.map((line, index) => (
        <div key={index} className="whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}
    </div>
  );
}
