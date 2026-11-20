// What went wrong, in plain words. The connection code raises protocol-level messages ("ACP WebSocket connection
// closed", "Cannot send session/prompt: ACP client is not connected", "-32603 Internal error"); a person needs to
// know what happened and whether Hearth is dealing with it. Messages the server wrote for people pass through.

/** Shown while a dropped connection is being restored; cleared once it is (see App). */
export const CONNECTION_DROPPED = 'The connection to the server dropped. Hearth is reconnecting; anything still running goes on on the server.';

const RULES: [RegExp, string][] = [
  [/ACP WebSocket (connection )?closed|WebSocket closed before|connection to .* failed/i, CONNECTION_DROPPED],
  [/is not connected/i, "Not connected to the server right now. Hearth is reconnecting; try again in a moment."],
  [/timed out after \d+ ?ms/i, 'The server took too long to answer. Try again.'],
  [/^(Internal error|-32603\b.*)$/i, 'The server hit an error. Try again.'],
  [/^"?Method not found"?/i, "This server can't do that."],
];

export function plainError(message: string): string {
  const text = message.replace(/^Invalid params:\s*/, '').trim();
  for (const [pattern, plain] of RULES) if (pattern.test(text)) return plain;
  return text || 'Something went wrong.';
}

/** A message about the connection itself, which the next good connection makes untrue. */
export const isConnectionError = (plain: string) => plain === CONNECTION_DROPPED || /^Not connected to the server/.test(plain);
