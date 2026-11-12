// One thread: its own ACP connection (vendored assistant-ui adapter) drawn with assistant-ui's Thread.
// An existing thread opens with session/load and shows its history; a new one opens with session/new + _meta.hearth.
import { useEffect, useMemo, useRef } from 'react';
import { AssistantRuntimeProvider, useAuiState } from '@assistant-ui/react';
import { AcpClient, useAcpRuntime, useAcpSessionTitle } from '@/vendor/acp';
import type { AcpWebSocketLike } from '@/vendor/acp/AcpClient';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { openSocket } from '@/lib/servers';

export type ThreadTarget =
  | { kind: 'open'; sessionId: string; cwd: string }
  | { kind: 'new'; cwd: string; meta: Record<string, unknown> };

export interface ThreadEvents {
  onError: (message: string) => void;
  /** The server-side session id, once known (a new thread gets one on its first message). */
  onSession: (sessionId: string) => void;
  /** The server renamed the thread (session_info_update). */
  onTitle: (title: string) => void;
  /** A turn finished: the sidebar may have changed. */
  onTurnEnd: () => void;
}

export function ThreadPane({ url, serverKey, target, events }: { url: string; serverKey: string; target: ThreadTarget; events: ThreadEvents }) {
  const client = useMemo(() => new AcpClient({
    url,
    cwd: target.cwd || '/',
    clientInfo: { name: 'hearth', version: '0.1.0' },
    webSocketFactory: (u) => openSocket(u, serverKey) as unknown as AcpWebSocketLike,
    ...(target.kind === 'open' ? { sessionId: target.sessionId } : { newSessionMeta: target.meta }),
  }), [url, serverKey, target]);
  useEffect(() => () => client.dispose(), [client]);
  return <Runtime client={client} events={events} />;
}

function Runtime({ client, events }: { client: AcpClient; events: ThreadEvents }) {
  const ev = useRef(events);
  ev.current = events;
  const runtime = useAcpRuntime({ client, permissions: 'ask', onError: (e) => ev.current.onError(e.message) });
  useEffect(() => client.subscribeConnectionChange(() => { if (client.sessionId) ev.current.onSession(client.sessionId); }), [client]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Watch events={ev} />
      <div className="relative h-full">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}

/** Reports title changes and turn ends from inside the runtime. */
function Watch({ events }: { events: React.RefObject<ThreadEvents> }) {
  const title = useAcpSessionTitle();
  const running = useAuiState((s) => s.thread.isRunning);
  const was = useRef(running);
  useEffect(() => { if (title) events.current.onTitle(title); }, [title, events]);
  useEffect(() => { if (was.current && !running) events.current.onTurnEnd(); was.current = running; }, [running, events]);
  return null;
}
