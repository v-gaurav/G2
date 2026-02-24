export interface AuthContext {
  sourceGroup: string;
  isMain: boolean;
}

/**
 * Encapsulates authorization checks for a single source context.
 * Prefer constructing one instance per request over calling standalone functions.
 */
export class AuthorizationPolicy {
  constructor(private ctx: AuthContext) {}

  get sourceGroup(): string {
    return this.ctx.sourceGroup;
  }

  get isMain(): boolean {
    return this.ctx.isMain;
  }

  /** Non-main groups can only send messages to their own group */
  canSendMessage(targetGroupFolder: string): boolean {
    return this.ctx.isMain || targetGroupFolder === this.ctx.sourceGroup;
  }

  /** Non-main groups can only schedule tasks for their own group */
  canScheduleTask(targetGroupFolder: string): boolean {
    return this.ctx.isMain || targetGroupFolder === this.ctx.sourceGroup;
  }

  /** Non-main groups can only manage (pause/resume/cancel) their own tasks */
  canManageTask(taskGroupFolder: string): boolean {
    return this.ctx.isMain || taskGroupFolder === this.ctx.sourceGroup;
  }

  /** Only main group can register new groups */
  canRegisterGroup(): boolean {
    return this.ctx.isMain;
  }

  /** Only main group can refresh/sync groups */
  canRefreshGroups(): boolean {
    return this.ctx.isMain;
  }

  /** Non-main groups can only manage their own sessions */
  canManageSession(targetGroupFolder: string): boolean {
    return this.ctx.isMain || targetGroupFolder === this.ctx.sourceGroup;
  }
}

// --- Backward-compatible standalone functions ---

/** Non-main groups can only send messages to their own group */
export function canSendMessage(ctx: AuthContext, targetGroupFolder: string): boolean {
  return ctx.isMain || targetGroupFolder === ctx.sourceGroup;
}

/** Non-main groups can only schedule tasks for their own group */
export function canScheduleTask(ctx: AuthContext, targetGroupFolder: string): boolean {
  return ctx.isMain || targetGroupFolder === ctx.sourceGroup;
}

/** Non-main groups can only manage (pause/resume/cancel) their own tasks */
export function canManageTask(ctx: AuthContext, taskGroupFolder: string): boolean {
  return ctx.isMain || taskGroupFolder === ctx.sourceGroup;
}

/** Only main group can register new groups */
export function canRegisterGroup(ctx: AuthContext): boolean {
  return ctx.isMain;
}

/** Only main group can refresh/sync groups */
export function canRefreshGroups(ctx: AuthContext): boolean {
  return ctx.isMain;
}

/** Non-main groups can only manage their own sessions */
export function canManageSession(ctx: AuthContext, targetGroupFolder: string): boolean {
  return ctx.isMain || targetGroupFolder === ctx.sourceGroup;
}
