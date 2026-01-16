import { createReadStream } from 'node:fs';
import StreamChain from 'stream-chain';
import StreamJson from 'stream-json';
import StreamPick from 'stream-json/filters/Pick.js';
import StreamArrayModule from 'stream-json/streamers/StreamArray.js';
import StreamValuesModule from 'stream-json/streamers/StreamValues.js';

const chain = StreamChain.chain;
const parser = StreamJson.parser;
const pick = StreamPick.pick;
const streamArray = StreamArrayModule.streamArray;
const streamValues = StreamValuesModule.streamValues;

export interface StreamArrayItem<T = unknown> {
  key: number;
  value: T;
}

export interface StreamValueItem<T = unknown> {
  value: T;
}

export interface JsonStreamOptions {
  pickPath?: string;
}

/**
 * Creates a streaming pipeline for large JSON files.
 * Uses stream-json to process without loading the entire file into memory.
 */
export function createJsonArrayStream<T = unknown>(
  filePath: string,
  options: JsonStreamOptions = {}
): AsyncIterable<StreamArrayItem<T>> {
  const stages: unknown[] = [
    createReadStream(filePath),
    parser(),
  ];

  if (options.pickPath) {
    stages.push(pick({ filter: options.pickPath }));
  }

  stages.push(streamArray());

  const pipeline = chain(stages);

  return {
    [Symbol.asyncIterator](): AsyncIterator<StreamArrayItem<T>> {
      let ended = false;
      let error: Error | null = null;
      const buffer: StreamArrayItem<T>[] = [];
      let resolveWait: (() => void) | null = null;

      pipeline.on('data', (data: StreamArrayItem<T>) => {
        buffer.push(data);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      pipeline.on('end', () => {
        ended = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      pipeline.on('error', (err: Error) => {
        error = err;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      return {
        async next(): Promise<IteratorResult<StreamArrayItem<T>>> {
          while (buffer.length === 0 && !ended && !error) {
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
          }

          if (error) {
            throw error;
          }

          if (buffer.length > 0) {
            return { value: buffer.shift()!, done: false };
          }

          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

/**
 * Creates a streaming pipeline that yields parsed values.
 * Useful when you need to process individual values without array context.
 */
export function createJsonValueStream<T = unknown>(
  filePath: string,
  options: JsonStreamOptions = {}
): AsyncIterable<StreamValueItem<T>> {
  const stages: unknown[] = [
    createReadStream(filePath),
    parser(),
  ];

  if (options.pickPath) {
    stages.push(pick({ filter: options.pickPath }));
  }

  stages.push(streamValues());

  const pipeline = chain(stages);

  return {
    [Symbol.asyncIterator](): AsyncIterator<StreamValueItem<T>> {
      let ended = false;
      let error: Error | null = null;
      const buffer: StreamValueItem<T>[] = [];
      let resolveWait: (() => void) | null = null;

      pipeline.on('data', (data: StreamValueItem<T>) => {
        buffer.push(data);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      pipeline.on('end', () => {
        ended = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      pipeline.on('error', (err: Error) => {
        error = err;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      return {
        async next(): Promise<IteratorResult<StreamValueItem<T>>> {
          while (buffer.length === 0 && !ended && !error) {
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
          }

          if (error) {
            throw error;
          }

          if (buffer.length > 0) {
            return { value: buffer.shift()!, done: false };
          }

          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

export interface TokenEvent {
  name: string;
  value?: unknown;
}

/**
 * Low-level streaming parser that emits JSON tokens.
 * Useful for schema extraction where we need to track structure without
 * fully assembling objects.
 */
export function createJsonTokenStream(
  filePath: string
): AsyncIterable<TokenEvent> {
  const pipeline = chain([
    createReadStream(filePath),
    parser(),
  ]);

  return {
    [Symbol.asyncIterator](): AsyncIterator<TokenEvent> {
      let ended = false;
      let error: Error | null = null;
      const buffer: TokenEvent[] = [];
      let resolveWait: (() => void) | null = null;

      pipeline.on('data', (data: TokenEvent) => {
        buffer.push(data);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      pipeline.on('end', () => {
        ended = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      pipeline.on('error', (err: Error) => {
        error = err;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

      return {
        async next(): Promise<IteratorResult<TokenEvent>> {
          while (buffer.length === 0 && !ended && !error) {
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
          }

          if (error) {
            throw error;
          }

          if (buffer.length > 0) {
            return { value: buffer.shift()!, done: false };
          }

          return { value: undefined as never, done: true };
        },
      };
    },
  };
}
