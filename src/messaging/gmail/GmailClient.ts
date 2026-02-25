/**
 * Gmail API client wrapper.
 * Handles OAuth token refresh and provides typed methods for email operations.
 */
import fs from 'fs';
import path from 'path';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { logger } from '../../infrastructure/Logger.js';

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private auth: OAuth2Client;
  private credentialsPath: string;

  constructor(configDir: string) {
    const keysPath = path.join(configDir, 'gcp-oauth.keys.json');
    this.credentialsPath = path.join(configDir, 'credentials.json');

    const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));

    const clientId = keys.installed?.client_id || keys.web?.client_id;
    const clientSecret = keys.installed?.client_secret || keys.web?.client_secret;

    this.auth = new OAuth2Client(clientId, clientSecret);
    this.auth.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry_date: credentials.expiry_date,
    });

    // Persist refreshed tokens
    this.auth.on('tokens', (tokens) => {
      const existing = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
      if (tokens.access_token) existing.access_token = tokens.access_token;
      if (tokens.refresh_token) existing.refresh_token = tokens.refresh_token;
      if (tokens.expiry_date) existing.expiry_date = tokens.expiry_date;
      fs.writeFileSync(this.credentialsPath, JSON.stringify(existing, null, 2));
      logger.debug('Gmail OAuth tokens refreshed');
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
  }

  /**
   * Search for emails matching a query.
   * Returns full message details for each match.
   */
  async search(query: string, maxResults = 10): Promise<GmailMessage[]> {
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messageIds = res.data.messages || [];
    const messages: GmailMessage[] = [];

    for (const { id } of messageIds) {
      if (!id) continue;
      const msg = await this.getMessage(id);
      if (msg) messages.push(msg);
    }

    return messages;
  }

  /**
   * Get a single message by ID.
   */
  async getMessage(id: string): Promise<GmailMessage | null> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });

    const msg = res.data;
    if (!msg.id || !msg.threadId) return null;

    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const body = this.extractBody(msg.payload);

    return {
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      body,
      date: getHeader('Date'),
    };
  }

  /**
   * Send an email reply in a thread.
   */
  async sendReply(
    threadId: string,
    to: string,
    subject: string,
    body: string,
    inReplyTo?: string,
  ): Promise<void> {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    const messageParts = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];

    if (inReplyTo) {
      messageParts.push(`In-Reply-To: ${inReplyTo}`);
      messageParts.push(`References: ${inReplyTo}`);
    }

    messageParts.push('', body);

    const raw = Buffer.from(messageParts.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });
  }

  /**
   * Mark a message as read by removing the UNREAD label.
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });
  }

  /**
   * Extract plain text body from a message payload.
   */
  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    // Direct body (simple messages)
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Multipart — find text/plain part
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
      // Fallback: recurse into nested multipart
      for (const part of payload.parts) {
        const text = this.extractBody(part);
        if (text) return text;
      }
    }

    return '';
  }
}
