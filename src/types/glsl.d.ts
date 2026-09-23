declare module '*.glsl' {
  const content: string;
  export default content;
}

declare module '*.vert' {
  const content: string;
  export default content;
}

declare module '*.frag' {
  const content: string;
  export default content;
}

declare module '*.vs' {
  const content: string;
  export default content;
}

declare module '*.fs' {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;
declare const __DEV__: boolean;
declare const __PDEV__: boolean;

// 注意：Eruda 不再经 import('eruda') 引入，改由 <script> 标签加载原始 UMD
// （src/public/eruda.js），类型见 src/devconsole/index.ts 的 ErudaGlobal。
