import { describe, it, expect } from 'vitest';

import {
  AuthContext,
  canSendMessage,
  canScheduleTask,
  canManageTask,
  canRegisterGroup,
  canRefreshGroups,
  canManageSession,
} from './authorization.js';

const mainCtx: AuthContext = { sourceGroup: 'main', isMain: true };
const otherCtx: AuthContext = { sourceGroup: 'other-group', isMain: false };
const thirdCtx: AuthContext = { sourceGroup: 'third-group', isMain: false };

describe('AuthorizationPolicy', () => {
  describe('canSendMessage', () => {
    it('main group can send to any group', () => {
      expect(canSendMessage(mainCtx, 'other-group')).toBe(true);
      expect(canSendMessage(mainCtx, 'third-group')).toBe(true);
      expect(canSendMessage(mainCtx, 'main')).toBe(true);
    });

    it('non-main group can send to its own group', () => {
      expect(canSendMessage(otherCtx, 'other-group')).toBe(true);
    });

    it('non-main group cannot send to a different group', () => {
      expect(canSendMessage(otherCtx, 'main')).toBe(false);
      expect(canSendMessage(otherCtx, 'third-group')).toBe(false);
    });

    it('non-main group cannot send to empty folder (unregistered JID)', () => {
      expect(canSendMessage(otherCtx, '')).toBe(false);
    });
  });

  describe('canScheduleTask', () => {
    it('main group can schedule for any group', () => {
      expect(canScheduleTask(mainCtx, 'other-group')).toBe(true);
      expect(canScheduleTask(mainCtx, 'third-group')).toBe(true);
    });

    it('non-main group can schedule for itself', () => {
      expect(canScheduleTask(otherCtx, 'other-group')).toBe(true);
    });

    it('non-main group cannot schedule for a different group', () => {
      expect(canScheduleTask(otherCtx, 'main')).toBe(false);
      expect(canScheduleTask(thirdCtx, 'other-group')).toBe(false);
    });
  });

  describe('canManageTask', () => {
    it('main group can manage any task', () => {
      expect(canManageTask(mainCtx, 'other-group')).toBe(true);
      expect(canManageTask(mainCtx, 'main')).toBe(true);
    });

    it('non-main group can manage its own task', () => {
      expect(canManageTask(otherCtx, 'other-group')).toBe(true);
    });

    it('non-main group cannot manage another groups task', () => {
      expect(canManageTask(otherCtx, 'main')).toBe(false);
      expect(canManageTask(thirdCtx, 'other-group')).toBe(false);
    });
  });

  describe('canRegisterGroup', () => {
    it('main group can register groups', () => {
      expect(canRegisterGroup(mainCtx)).toBe(true);
    });

    it('non-main group cannot register groups', () => {
      expect(canRegisterGroup(otherCtx)).toBe(false);
      expect(canRegisterGroup(thirdCtx)).toBe(false);
    });
  });

  describe('canRefreshGroups', () => {
    it('main group can refresh groups', () => {
      expect(canRefreshGroups(mainCtx)).toBe(true);
    });

    it('non-main group cannot refresh groups', () => {
      expect(canRefreshGroups(otherCtx)).toBe(false);
    });
  });

  describe('canManageSession', () => {
    it('main group can manage any session', () => {
      expect(canManageSession(mainCtx, 'other-group')).toBe(true);
      expect(canManageSession(mainCtx, 'main')).toBe(true);
    });

    it('non-main group can manage its own session', () => {
      expect(canManageSession(otherCtx, 'other-group')).toBe(true);
    });

    it('non-main group cannot manage another groups session', () => {
      expect(canManageSession(otherCtx, 'main')).toBe(false);
      expect(canManageSession(thirdCtx, 'other-group')).toBe(false);
    });
  });
});
