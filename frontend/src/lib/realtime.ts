import { useEffect, useRef, useCallback } from "react";
import { api } from "@/src/lib/api";

const WS_BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/^http/, "ws");

// Lightweight WebSocket client with auto-reconnect for the paired room.
export function useRealtime(onEvent: (e: any) => void, enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const reconnectRef = useRef<any>(null);
  const closedRef = useRef(false);

  const connect = useCallback(async () => {
    if (!enabled || closedRef.current) return;
    const token = await api.getToken();
    if (!token) return;
    const url = `${WS_BASE}/api/ws?token=${encodeURIComponent(token as string)}`;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev: any) => {
        try {
          onEventRef.current(JSON.parse(ev.data));
        } catch {}
      };
      ws.onclose = () => {
        if (!closedRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = setTimeout(connect, 2500);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    } catch {
      reconnectRef.current = setTimeout(connect, 2500);
    }
  }, [enabled]);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      clearTimeout(reconnectRef.current);
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
