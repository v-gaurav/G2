export interface AuthContext {
  sourceGroup: string;
  isMain: boolean;
}

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
