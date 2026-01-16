declare module 'stream-chain' {
  import { Duplex } from 'node:stream';
  function chain(streams: unknown[]): Duplex;
  export default { chain };
  export { chain };
}

declare module 'stream-json' {
  import { Transform } from 'node:stream';
  function parser(): Transform;
  export default { parser };
  export { parser };
}

declare module 'stream-json/filters/Pick.js' {
  import { Transform } from 'node:stream';
  function pick(options: { filter: string }): Transform;
  export default { pick };
  export { pick };
}

declare module 'stream-json/streamers/StreamArray.js' {
  import { Transform } from 'node:stream';
  function streamArray(): Transform;
  export default { streamArray };
  export { streamArray };
}

declare module 'stream-json/streamers/StreamValues.js' {
  import { Transform } from 'node:stream';
  function streamValues(): Transform;
  export default { streamValues };
  export { streamValues };
}
