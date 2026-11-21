import type { RequestHandler } from 'express';
import { accessOf } from './access';
import { signedInUser } from './auth';
import { platformDb, withTenant } from './db';
import { HttpError } from './errors';

/**
 * Picks the company for the request: header `X-Tenant: <slug>`, else DEV_TENANT. The signed-in
 * person must be a platform admin or an active member of it (decisions 0007, 0021); what their role
 * allows there goes to `res.locals.access` for the route rules (src/rules.ts).
 */
export const tenantMiddleware: RequestHandler = async (req, res, next) => {
  const slug = (req.header('x-tenant') || process.env.DEV_TENANT || '').trim();
  if (!slug) throw new HttpError(400, 'No company selected.');
  const tenant = await platformDb.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new HttpError(400, `Unknown company "${slug}".`);
  const access = await accessOf(signedInUser(res), tenant.id);
  if (!access) throw new HttpError(403, 'You are not a member of this company.');
  res.locals.tenant = tenant;
  res.locals.access = access;
  withTenant(tenant.id, () => next());
};
