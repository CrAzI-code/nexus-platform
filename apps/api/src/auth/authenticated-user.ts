import type { User } from '../generated/prisma/client.js';
import type { Request } from 'express';

export type AuthenticatedUser = Pick<User, 'id' | 'name' | 'email' | 'status'>;

export interface AuthenticatedRequest extends Request {
  authenticatedUser?: AuthenticatedUser;
}
