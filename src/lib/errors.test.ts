import { expect, it } from 'vitest';
import { CONNECTION_DROPPED, isConnectionError, plainError } from './errors';

it('turns protocol messages into plain words', () => {
  expect(plainError('ACP WebSocket connection closed')).toBe(CONNECTION_DROPPED);
  expect(plainError('ACP WebSocket closed before handshake completed')).toBe(CONNECTION_DROPPED);
  expect(plainError('Cannot send session/prompt: ACP client is not connected')).toMatch(/^Not connected to the server/);
  expect(plainError('ACP session/new timed out after 30000ms')).toBe('The server took too long to answer. Try again.');
  expect(plainError('Internal error')).toBe('The server hit an error. Try again.');
  expect(plainError('"Method not found": _hearth/x')).toBe("This server can't do that.");
});

it('lets what the server wrote for people through', () => {
  expect(plainError('The turn ended with "error": provider down')).toBe('The turn ended with "error": provider down');
  expect(plainError('Invalid params: Empty prompt.')).toBe('Empty prompt.');
});

it('knows which messages a reconnect makes untrue', () => {
  expect(isConnectionError(plainError('ACP WebSocket connection closed'))).toBe(true);
  expect(isConnectionError('The turn ended with "error": provider down')).toBe(false);
});
