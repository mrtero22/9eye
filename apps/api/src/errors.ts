import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

/** An error the user can read. `problems` lists every rule that failed (bulk operations). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public problems?: { code: string; message: string; blockId?: string; weekday?: number; templateId?: string }[],
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found.`);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, problems: err.problems ?? [] });
    return;
  }
  if (err instanceof ZodError) {
    const problems = err.issues.map((i) => ({ code: 'input', message: `${i.path.join('.') || 'input'}: ${i.message}` }));
    res.status(400).json({ error: 'Some fields are not valid.', problems });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Not found.', problems: [] });
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'That name is already used.', problems: [] });
      return;
    }
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request is not valid JSON.', problems: [] });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.', problems: [] });
};
