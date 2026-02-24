import { logger } from './logger.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---G2_OUTPUT_START---';
const OUTPUT_END_MARKER = '---G2_OUTPUT_END---';

export interface ParsedOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

/**
 * Stateful parser for the OUTPUT_START/END marker protocol.
 * Feed chunks as they arrive; `onOutput` fires for each complete marker pair.
 */
export class ContainerOutputParser {
  private buffer = '';

  constructor(
    private readonly groupName: string,
    private readonly onOutput: (parsed: ParsedOutput) => void,
  ) {}

  /**
   * Feed a chunk of stdout data. Parses and emits any complete marker pairs.
   * Returns true if at least one output was parsed from this chunk.
   */
  feed(chunk: string): boolean {
    this.buffer += chunk;
    let found = false;

    let startIdx: number;
    while ((startIdx = this.buffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
      const endIdx = this.buffer.indexOf(OUTPUT_END_MARKER, startIdx);
      if (endIdx === -1) break; // Incomplete pair, wait for more data

      const jsonStr = this.buffer
        .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
        .trim();
      this.buffer = this.buffer.slice(endIdx + OUTPUT_END_MARKER.length);

      try {
        const parsed: ParsedOutput = JSON.parse(jsonStr);
        found = true;
        this.onOutput(parsed);
      } catch (err) {
        logger.warn(
          { group: this.groupName, error: err },
          'Failed to parse streamed output chunk',
        );
      }
    }

    return found;
  }

  /**
   * Parse the last marker pair from a complete stdout buffer (legacy/batch mode).
   * Returns the parsed output or null if no valid marker pair was found.
   */
  static parseLast(stdout: string, groupName: string): ParsedOutput | null {
    const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
    const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

    let jsonLine: string;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonLine = stdout
        .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
        .trim();
    } else {
      // Fallback: last non-empty line (backwards compatibility)
      const lines = stdout.trim().split('\n');
      jsonLine = lines[lines.length - 1];
    }

    try {
      return JSON.parse(jsonLine);
    } catch (err) {
      logger.error(
        { group: groupName, stdout, error: err },
        'Failed to parse container output',
      );
      return null;
    }
  }
}
