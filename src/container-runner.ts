/**
 * Container Runner for G2
 * Spawns agent execution in containers and handles IPC
 */
import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  TIMEZONE,
  TimeoutConfig,
} from './config.js';
import { ContainerOutputParser } from './container-output-parser.js';
import { readEnvFile } from './env.js';
import { GroupPaths } from './group-paths.js';
import { logger } from './logger.js';
import type { IContainerRuntime } from './interfaces/container-runtime.js';
import type { IMountFactory, VolumeMount } from './interfaces/mount-factory.js';
import { DockerRuntime } from './interfaces/docker-runtime.js';
import { DefaultMountFactory } from './interfaces/default-mount-factory.js';
import { RegisteredGroup } from './types.js';

// Default interface instances for backward compatibility
const defaultRuntime = new DockerRuntime();
const defaultMountFactory = new DefaultMountFactory(defaultRuntime);

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

export interface ContainerRunnerDeps {
  runtime?: IContainerRuntime;
  mountFactory?: IMountFactory;
}

export class ContainerRunner {
  private readonly runtime: IContainerRuntime;
  private readonly mountFactory: IMountFactory;

  constructor(deps?: ContainerRunnerDeps) {
    this.runtime = deps?.runtime ?? defaultRuntime;
    this.mountFactory = deps?.mountFactory ?? defaultMountFactory;
  }

  async run(
    group: RegisteredGroup,
    input: ContainerInput,
    onProcess: (proc: ChildProcess, containerName: string) => void,
    onOutput?: (output: ContainerOutput) => Promise<void>,
  ): Promise<ContainerOutput> {
    const startTime = Date.now();

    const groupDir = GroupPaths.groupDir(group.folder);
    fs.mkdirSync(groupDir, { recursive: true });

    this.mountFactory.prepare(group, input.isMain);
    const mounts = this.mountFactory.buildMounts(group, input.isMain);
    const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
    const containerName = `g2-${safeName}-${Date.now()}`;
    const containerArgs = this.buildContainerArgs(mounts, containerName);

    logger.debug(
      {
        group: group.name,
        containerName,
        mounts: mounts.map(
          (m) =>
            `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
        ),
        containerArgs: containerArgs.join(' '),
      },
      'Container mount configuration',
    );

    logger.info(
      {
        group: group.name,
        containerName,
        mountCount: mounts.length,
        isMain: input.isMain,
      },
      'Spawning container agent',
    );

    const logsDir = GroupPaths.logsDir(group.folder);
    fs.mkdirSync(logsDir, { recursive: true });

    return new Promise((resolve) => {
      const container = spawn(this.runtime.bin, containerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      onProcess(container, containerName);

      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;

      // Pass secrets via stdin (never written to disk or mounted as files)
      input.secrets = this.readSecrets();
      container.stdin.write(JSON.stringify(input));
      container.stdin.end();
      // Remove secrets from input so they don't appear in logs
      delete input.secrets;

      // Instance state for this run
      let timedOut = false;
      let hadStreamingOutput = false;
      let newSessionId: string | undefined;
      let outputChain = Promise.resolve();

      const timeoutConfig = new TimeoutConfig().forGroup(group);
      const configTimeout = timeoutConfig.containerTimeout;
      const timeoutMs = timeoutConfig.getHardTimeout();

      const killOnTimeout = () => {
        timedOut = true;
        logger.error({ group: group.name, containerName }, 'Container timeout, stopping gracefully');
        exec(this.runtime.stopContainer(containerName), { timeout: 15000 }, (err) => {
          if (err) {
            logger.warn({ group: group.name, containerName, err }, 'Graceful stop failed, force killing');
            container.kill('SIGKILL');
          }
        });
      };

      let timeout = setTimeout(killOnTimeout, timeoutMs);

      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(killOnTimeout, timeoutMs);
      };

      // Streaming output parser
      const parser = onOutput
        ? new ContainerOutputParser(group.name, (parsed) => {
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            resetTimeout();
            outputChain = outputChain.then(() => onOutput(parsed));
          })
        : null;

      container.stdout.on('data', (data) => {
        const chunk = data.toString();

        // Always accumulate for logging
        if (!stdoutTruncated) {
          const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
          if (chunk.length > remaining) {
            stdout += chunk.slice(0, remaining);
            stdoutTruncated = true;
            logger.warn(
              { group: group.name, size: stdout.length },
              'Container stdout truncated due to size limit',
            );
          } else {
            stdout += chunk;
          }
        }

        parser?.feed(chunk);
      });

      container.stderr.on('data', (data) => {
        const chunk = data.toString();
        const lines = chunk.trim().split('\n');
        for (const line of lines) {
          if (line) logger.debug({ container: group.folder }, line);
        }
        if (stderrTruncated) return;
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
        if (chunk.length > remaining) {
          stderr += chunk.slice(0, remaining);
          stderrTruncated = true;
          logger.warn(
            { group: group.name, size: stderr.length },
            'Container stderr truncated due to size limit',
          );
        } else {
          stderr += chunk;
        }
      });

      container.on('close', (code) => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        if (timedOut) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const timeoutLog = path.join(logsDir, `container-${ts}.log`);
          fs.writeFileSync(timeoutLog, [
            `=== Container Run Log (TIMEOUT) ===`,
            `Timestamp: ${new Date().toISOString()}`,
            `Group: ${group.name}`,
            `Container: ${containerName}`,
            `Duration: ${duration}ms`,
            `Exit Code: ${code}`,
            `Had Streaming Output: ${hadStreamingOutput}`,
          ].join('\n'));

          if (hadStreamingOutput) {
            logger.info(
              { group: group.name, containerName, duration, code },
              'Container timed out after output (idle cleanup)',
            );
            outputChain.then(() => {
              resolve({
                status: 'success',
                result: null,
                newSessionId,
              });
            });
            return;
          }

          logger.error(
            { group: group.name, containerName, duration, code },
            'Container timed out with no output',
          );

          resolve({
            status: 'error',
            result: null,
            error: `Container timed out after ${configTimeout}ms`,
          });
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = path.join(logsDir, `container-${timestamp}.log`);
        const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

        const logLines = [
          `=== Container Run Log ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `IsMain: ${input.isMain}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
          `Stdout Truncated: ${stdoutTruncated}`,
          `Stderr Truncated: ${stderrTruncated}`,
          ``,
        ];

        const isError = code !== 0;

        if (isVerbose || isError) {
          logLines.push(
            `=== Input ===`,
            JSON.stringify(input, null, 2),
            ``,
            `=== Container Args ===`,
            containerArgs.join(' '),
            ``,
            `=== Mounts ===`,
            mounts
              .map(
                (m) =>
                  `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
              )
              .join('\n'),
            ``,
            `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
            stderr,
            ``,
            `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
            stdout,
          );
        } else {
          logLines.push(
            `=== Input Summary ===`,
            `Prompt length: ${input.prompt.length} chars`,
            `Session ID: ${input.sessionId || 'new'}`,
            ``,
            `=== Mounts ===`,
            mounts
              .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
              .join('\n'),
            ``,
          );
        }

        fs.writeFileSync(logFile, logLines.join('\n'));
        logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

        if (code !== 0) {
          logger.error(
            {
              group: group.name,
              code,
              duration,
              stderr,
              stdout,
              logFile,
            },
            'Container exited with error',
          );

          resolve({
            status: 'error',
            result: null,
            error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
          });
          return;
        }

        // Streaming mode: wait for output chain to settle, return completion marker
        if (onOutput) {
          outputChain.then(() => {
            logger.info(
              { group: group.name, duration, newSessionId },
              'Container completed (streaming mode)',
            );
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        // Legacy mode: parse the last output marker pair from accumulated stdout
        const parsed = ContainerOutputParser.parseLast(stdout, group.name);
        if (parsed) {
          logger.info(
            {
              group: group.name,
              duration,
              status: parsed.status,
              hasResult: !!parsed.result,
            },
            'Container completed',
          );
          resolve(parsed);
        } else {
          resolve({
            status: 'error',
            result: null,
            error: 'Failed to parse container output',
          });
        }
      });

      container.on('error', (err) => {
        clearTimeout(timeout);
        logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
        resolve({
          status: 'error',
          result: null,
          error: `Container spawn error: ${err.message}`,
        });
      });
    });
  }

  private readSecrets(): Record<string, string> {
    return readEnvFile([
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    ]);
  }

  private buildContainerArgs(
    mounts: VolumeMount[],
    containerName: string,
  ): string[] {
    const args: string[] = ['run', '-i', '--rm', '--name', containerName];

    args.push('-e', `TZ=${TIMEZONE}`);

    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();
    if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
      args.push('--user', `${hostUid}:${hostGid}`);
      args.push('-e', 'HOME=/home/node');
    }

    for (const mount of mounts) {
      if (mount.readonly) {
        args.push(...this.runtime.readonlyMountArgs(mount.hostPath, mount.containerPath));
      } else {
        args.push(...this.runtime.readwriteMountArgs(mount.hostPath, mount.containerPath));
      }
    }

    args.push(CONTAINER_IMAGE);

    return args;
  }
}

