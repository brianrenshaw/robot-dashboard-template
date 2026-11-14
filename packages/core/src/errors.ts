// errors.ts
// Errors that the Workers turn into clear HTTP or MCP responses.

export class NotFoundError extends Error {
  status = 404 as const;
}

export class InputError extends Error {
  status = 400 as const;
}

/** A name or title matched more than one record. Writes never guess. */
export class AmbiguousError extends Error {
  status = 409 as const;
  constructor(
    message: string,
    public candidates: { id: string; label: string; detail?: string }[],
  ) {
    super(message);
  }
}
