import { describe, it, expect } from 'vitest';

import {
  AuthContext,
  AuthorizationPolicy,
} from './Authorization.js';

const mainCtx: AuthContext = { sourceGroup: 'main', isMain: true };
const otherCtx: AuthContext = { sourceGroup: 'other-group', isMain: false };

describe('AuthorizationPolicy', () => {
  describe('class API', () => {
    it('main policy can do everything', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canSendMessage('other-group')).toBe(true);
      expect(policy.canScheduleTask('other-group')).toBe(true);
      expect(policy.canManageTask('other-group')).toBe(true);
      expect(policy.canRegisterGroup()).toBe(true);
      expect(policy.canRefreshGroups()).toBe(true);
      expect(policy.canManageSession('other-group')).toBe(true);
    });

    it('non-main policy is scoped to own group', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canSendMessage('other-group')).toBe(true);
      expect(policy.canSendMessage('main')).toBe(false);
      expect(policy.canScheduleTask('other-group')).toBe(true);
      expect(policy.canScheduleTask('main')).toBe(false);
      expect(policy.canManageTask('other-group')).toBe(true);
      expect(policy.canManageTask('main')).toBe(false);
      expect(policy.canRegisterGroup()).toBe(false);
      expect(policy.canRefreshGroups()).toBe(false);
      expect(policy.canManageSession('other-group')).toBe(true);
      expect(policy.canManageSession('main')).toBe(false);
    });

    it('exposes sourceGroup and isMain', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.sourceGroup).toBe('other-group');
      expect(policy.isMain).toBe(false);
    });
  });

  describe('canSendMessage', () => {
    it('main group can send to any group', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canSendMessage('other-group')).toBe(true);
      expect(policy.canSendMessage('third-group')).toBe(true);
      expect(policy.canSendMessage('main')).toBe(true);
    });

    it('non-main group can send to its own group', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canSendMessage('other-group')).toBe(true);
    });

    it('non-main group cannot send to a different group', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canSendMessage('main')).toBe(false);
      expect(policy.canSendMessage('third-group')).toBe(false);
    });

    it('non-main group cannot send to empty folder (unregistered JID)', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canSendMessage('')).toBe(false);
    });
  });

  describe('canScheduleTask', () => {
    it('main group can schedule for any group', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canScheduleTask('other-group')).toBe(true);
      expect(policy.canScheduleTask('third-group')).toBe(true);
    });

    it('non-main group can schedule for itself', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canScheduleTask('other-group')).toBe(true);
    });

    it('non-main group cannot schedule for a different group', () => {
      const nonMain = new AuthorizationPolicy(otherCtx);
      const third = new AuthorizationPolicy({ sourceGroup: 'third-group', isMain: false });
      expect(nonMain.canScheduleTask('main')).toBe(false);
      expect(third.canScheduleTask('other-group')).toBe(false);
    });
  });

  describe('canManageTask', () => {
    it('main group can manage any task', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canManageTask('other-group')).toBe(true);
      expect(policy.canManageTask('main')).toBe(true);
    });

    it('non-main group can manage its own task', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canManageTask('other-group')).toBe(true);
    });

    it('non-main group cannot manage another groups task', () => {
      const nonMain = new AuthorizationPolicy(otherCtx);
      const third = new AuthorizationPolicy({ sourceGroup: 'third-group', isMain: false });
      expect(nonMain.canManageTask('main')).toBe(false);
      expect(third.canManageTask('other-group')).toBe(false);
    });
  });

  describe('canRegisterGroup', () => {
    it('main group can register groups', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canRegisterGroup()).toBe(true);
    });

    it('non-main group cannot register groups', () => {
      const nonMain = new AuthorizationPolicy(otherCtx);
      const third = new AuthorizationPolicy({ sourceGroup: 'third-group', isMain: false });
      expect(nonMain.canRegisterGroup()).toBe(false);
      expect(third.canRegisterGroup()).toBe(false);
    });
  });

  describe('canRefreshGroups', () => {
    it('main group can refresh groups', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canRefreshGroups()).toBe(true);
    });

    it('non-main group cannot refresh groups', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canRefreshGroups()).toBe(false);
    });
  });

  describe('canManageSession', () => {
    it('main group can manage any session', () => {
      const policy = new AuthorizationPolicy(mainCtx);
      expect(policy.canManageSession('other-group')).toBe(true);
      expect(policy.canManageSession('main')).toBe(true);
    });

    it('non-main group can manage its own session', () => {
      const policy = new AuthorizationPolicy(otherCtx);
      expect(policy.canManageSession('other-group')).toBe(true);
    });

    it('non-main group cannot manage another groups session', () => {
      const nonMain = new AuthorizationPolicy(otherCtx);
      const third = new AuthorizationPolicy({ sourceGroup: 'third-group', isMain: false });
      expect(nonMain.canManageSession('main')).toBe(false);
      expect(third.canManageSession('other-group')).toBe(false);
    });
  });
});
