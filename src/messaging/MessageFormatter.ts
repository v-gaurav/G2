import type { NewMessage } from '../types.js';

/**
 * Transforms internal messages to channel-specific formats.
 * All methods are static — the class provides namespacing and testability.
 */
export class MessageFormatter {
  static escapeXml(s: string): string {
    if (!s) return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  static formatMessages(messages: NewMessage[]): string {
    const lines = messages.map((m) => {
      let attrs = `sender="${MessageFormatter.escapeXml(m.sender_name)}" time="${m.timestamp}"`;
      if (m.media_type) attrs += ` media_type="${MessageFormatter.escapeXml(m.media_type)}"`;
      if (m.media_path) attrs += ` media_path="${MessageFormatter.escapeXml(m.media_path)}"`;
      if (m.media_mimetype) attrs += ` media_mimetype="${MessageFormatter.escapeXml(m.media_mimetype)}"`;
      return `<message ${attrs}>${MessageFormatter.escapeXml(m.content)}</message>`;
    });
    return `<messages>\n${lines.join('\n')}\n</messages>`;
  }

  static stripInternalTags(text: string): string {
    return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
  }

  static formatOutbound(rawText: string): string {
    const text = MessageFormatter.stripInternalTags(rawText);
    if (!text) return '';
    return text;
  }
}

// Free function re-exports for direct imports
export const escapeXml = MessageFormatter.escapeXml;
export const formatMessages = MessageFormatter.formatMessages;
export const stripInternalTags = MessageFormatter.stripInternalTags;
export const formatOutbound = MessageFormatter.formatOutbound;
