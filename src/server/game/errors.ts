/** Expected, user-facing failure of a game rule. Message is shown to the player (Bulgarian). */
export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const fail = (code: string, message: string, status = 400): never => {
  throw new GameError(code, message, status);
};
