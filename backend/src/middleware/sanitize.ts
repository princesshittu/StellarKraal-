/**
 * Input sanitisation middleware.
 *
 * Applies express-validator chains to every string in the body, query, and
 * route params: trim whitespace, strip HTML tags, neutralise command-injection
 * metacharacters, and reject oversized fields with 422. Query values also have
 * SQL-special characters escaped.
 */
import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationChain } from 'express-validator';

/** Maximum length of a single user-supplied string field. */
export const MAX_FIELD_LENGTH = 10_000;

type Location = 'body' | 'query' | 'params';

const factories = {
  body,
  query,
  param,
} as const;

/**
 * Removes HTML tags from a string.
 * @param value - Raw user input.
 * @returns The string with tags removed.
 */
function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

/**
 * Removes null bytes, backticks, and command-substitution sequences.
 * @param value - String that has already had HTML removed.
 * @returns The string with command-injection metacharacters removed.
 */
function neutralizeCommandInjection(value: string): string {
  return value.replace(/\0/g, '').replace(/`/g, '').replace(/\$\([^)]*\)/g, '').replace(/\$\{[^}]*\}/g, '');
}

/**
 * Escapes characters that are significant in SQL string literals.
 * @param value - Query-parameter string to escape.
 * @returns The escaped string.
 */
function escapeSql(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/;/g, '\\;')
    .replace(/--/g, '\\-\\-');
}

/**
 * Collects express-validator paths for every string in a value tree.
 * @param value - Body, query, or params node.
 * @param prefix - Path built so far.
 * @param out - Accumulator of field paths.
 * @returns Nothing.
 */
function collectPaths(value: unknown, prefix: string, out: string[]): void {
  if (typeof value === 'string') {
    if (prefix) out.push(prefix);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectPaths(item, prefix ? `${prefix}[${index}]` : `[${index}]`, out);
    });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectPaths(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
}

/**
 * Builds a sanitisation chain for one string field.
 * @param location - Request property the field lives on.
 * @param path - express-validator field path.
 * @returns Configured validation chain.
 */
function chainFor(location: Location, path: string): ValidationChain {
  const factory = location === 'params' ? factories.param : factories[location];
  return factory(path)
    .trim()
    .customSanitizer((value: unknown) => {
      if (typeof value !== 'string') return value;
      const cleaned = neutralizeCommandInjection(stripHtml(value));
      return location === 'query' ? escapeSql(cleaned) : cleaned;
    })
    .isLength({ max: MAX_FIELD_LENGTH })
    .withMessage(`must be at most ${MAX_FIELD_LENGTH} characters`);
}

interface FieldError {
  field: string;
  message: string;
}

/**
 * Returns a sanitised copy of a request value tree.
 * Records fields that exceed the length limit.
 * @param value - Body, query, or params node.
 * @param location - Which request property this node belongs to.
 * @param path - Field path used in 422 details.
 * @param errors - Accumulator for length failures.
 * @returns Sanitised copy of the value.
 */
function sanitizeNode(
  value: unknown,
  location: Location,
  path: string,
  errors: FieldError[],
): unknown {
  if (typeof value === 'string') {
    const cleaned = neutralizeCommandInjection(stripHtml(value.trim()));
    if (cleaned.length > MAX_FIELD_LENGTH) {
      errors.push({
        field: path || '_root',
        message: `must be at most ${MAX_FIELD_LENGTH} characters`,
      });
      return cleaned;
    }
    return location === 'query' ? escapeSql(cleaned) : cleaned;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeNode(item, location, path ? `${path}[${index}]` : `[${index}]`, errors),
    );
  }
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = sanitizeNode(child, location, path ? `${path}.${key}` : key, errors);
    }
    return copy;
  }
  return value;
}

/**
 * Sanitises string fields on the live request object.
 * Express 5 route params are read from this same object, so replacing
 * `req.params` does not change what the handler sees.
 * @param value - Body, query, or params node to mutate.
 * @param location - Which request property this node belongs to.
 * @param path - Field path used when recording length failures.
 * @param errors - Accumulator for length failures. Pass an empty array for a second pass.
 * @returns Nothing.
 */
function sanitizeInPlace(value: unknown, location: Location, path: string, errors: FieldError[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const field = path ? `${path}[${index}]` : `[${index}]`;
      if (typeof item === 'string') {
        value[index] = sanitizeNode(item, location, field, errors);
        return;
      }
      sanitizeInPlace(item, location, field, errors);
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const field = path ? `${path}.${key}` : key;
    if (typeof child === 'string') {
      (value as Record<string, unknown>)[key] = sanitizeNode(child, location, field, errors);
      continue;
    }
    sanitizeInPlace(child, location, field, errors);
  }
}

/**
 * Sanitises user-supplied strings and rejects oversized fields with 422.
 * @param req - Incoming request.
 * @param res - Outgoing response.
 * @param next - Next middleware.
 * @returns Nothing. Responds with 422 when validation fails.
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction): void {
  const chains: ValidationChain[] = [];
  const locations: Location[] = ['body', 'query', 'params'];
  const lengthErrors: FieldError[] = [];

  for (const location of locations) {
    const source = req[location];
    const paths: string[] = [];
    collectPaths(source, '', paths);
    for (const path of paths) {
      chains.push(chainFor(location, path));
    }
    if (source && typeof source === 'object') {
      sanitizeNode(source, location, '', lengthErrors);
    }
  }

  const finish = (): void => {
    if (lengthErrors.length > 0) {
      res.status(422).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: lengthErrors,
      });
      return;
    }
    sanitizeInPlace(req.body, 'body', '', []);
    const queryCopy = sanitizeNode(req.query, 'query', '', []);
    Object.defineProperty(req, 'query', {
      value: queryCopy,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };

  if (chains.length === 0) {
    finish();
    return;
  }

  void Promise.all(chains.map((chain) => chain.run(req)))
    .then(() => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(422).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors.array().map((issue: any) => ({
            field: 'path' in issue ? issue.path : '_root',
            message: issue.msg,
          })),
        });
        return;
      }
      finish();
    })
    .catch(next);
}

/**
 * Route params are assigned after global middleware, when the matched route
 * dispatches. Hook that dispatch so every handler sees sanitised params.
 * @returns Nothing.
 */
function installParamSanitizer(): void {
  // router has no type declarations; this is the Express route constructor.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Route = require('router/lib/route') as {
    prototype: { dispatch: (req: Request, res: Response, done: (err?: unknown) => void) => void };
  };
  const original = Route.prototype.dispatch;
  if ((original as { __sanitized?: boolean }).__sanitized) return;

  function dispatch(this: unknown, req: Request, res: Response, done: (err?: unknown) => void): void {
    const errors: FieldError[] = [];
    sanitizeInPlace(req.params, 'params', '', errors);
    if (errors.length > 0) {
      res.status(422).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors,
      });
      return;
    }
    original.call(this, req, res, done);
  }
  (dispatch as { __sanitized?: boolean }).__sanitized = true;
  Route.prototype.dispatch = dispatch;
}

installParamSanitizer();
