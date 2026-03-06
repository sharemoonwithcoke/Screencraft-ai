"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { ServerToClientEvent } from "@screencraft/shared";

type EventHandler = (event: ServerToClientEvent) => void;

export function useWebSocket(recordingId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef<Map<ServerToClientEvent["event"], EventHandler[]>>(
    new Map()
  );

  useEffect(() => {
    if (!recordingId) return;

    const socket = io(process.env.NEXT_PUBLIC_WS_URL!, {
      auth: { recordingId },
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.onAny((eventName: string, payload: unknown) => {
      const handlers = handlersRef.current.get(
        eventName as ServerToClientEvent["event"]
      );
      if (handlers) {
        handlers.forEach((h) =>
          h({ event: eventName, payload } as ServerToClientEvent)
        );
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [recordingId]);

  const on = useCallback(
    <E extends ServerToClientEvent["event"]>(
      event: E,
      handler: (event: Extract<ServerToClientEvent, { event: E }>) => void
    ) => {
      const handlers = handlersRef.current.get(event) ?? [];
      handlers.push(handler as EventHandler);
      handlersRef.current.set(event, handlers);

      return () => {
        const updated = (handlersRef.current.get(event) ?? []).filter(
          (h) => h !== handler
        );
        handlersRef.current.set(event, updated);
      };
    },
    []
  );

  const emit = useCallback((event: string, payload: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const sendChunk = useCallback(
    (blob: Blob, index: number, recordingId: string) => {
      blob.arrayBuffer().then((buffer) => {
        socketRef.current?.emit("recorder:chunk", {
          blob: buffer,
          timestamp: Date.now(),
          index,
          recordingId,
        });
      });
    },
    []
  );

  return { on, emit, sendChunk };
}
