/** Declared resource admission rejects incomplete packages before durable capture. */
import { expect, it } from 'vitest'
import { validateDependencies } from '../src/dependencies.ts'
const asset = (name: string, mediaType: string, text: string) => ({
  input: { name, mediaType, data: Buffer.from(text).toString('base64') },
  bytes: Buffer.from(text),
})
it('accepts complete HTML, SVG, stylesheet and transitive module assets with local fragment references', () => {
  validateDependencies([
    asset(
      'dir/index.html',
      'text/html',
      '<template><img src="./image.svg#icon"></template><a href="#local">Local</a><link href="style.css"><button style="background:url(image.svg)" onclick="return false">Click</button><script type="module" src="main.js"></script><script type="application/json">{"data":1}</script>',
    ),
    asset('dir/image.svg', 'image/svg+xml', '<svg><style>path{fill:red}</style><path id="icon"/></svg>'),
    asset('dir/style.css', 'text/css', '@import "more.css"; h1{background:url("image.svg")}'),
    asset('dir/more.css', 'text/css', ':root {--accent:red} h1 {color: var(--accent)}'),
    asset(
      'dir/main.js',
      'text/javascript',
      'import "./more.js"; export {value} from "more.js"; export * from "more.js"; import("more.js"); const result={value:"local"};',
    ),
    asset('dir/more.js', 'text/javascript', 'const value=1; export {value};'),
    asset('notes.md', 'text/markdown', '![icon](dir/image.svg)'),
    asset('readme.txt', 'text/plain', 'https://citation.example/'),
  ])
})
it.each([
  ['text/markdown', '![image](https://external.invalid/image)'],
  ['text/markdown', '![image](missing.png)'],
  ['text/html', '<img src="https://external.invalid/image">'],
  ['text/html', '<img src="&#104;ttps://external.invalid/image">'],
  ['text/html', '<img src="missing.png">'],
  ['text/html', '<a href="../escape.html">outside</a>'],
  ['text/html', '<img src="/root.png">'],
  ['text/html', '<img src="image.png?query">'],
  ['text/html', '<base href="local.html">'],
  ['text/html', '<iframe srcdoc="<h1>embedded</h1>"></iframe>'],
  ['text/html', '<object data="missing.pdf"></object>'],
  ['text/html', '<embed src="missing.pdf">'],
  ['text/html', '<meta http-equiv="refresh" content="0;url=https://external.invalid">'],
  ['text/html', '<img srcset="a.png 1x, b.png 2x">'],
  ['text/html', '<script type="importmap">{"imports":{}}</script>'],
  ['text/html', '<style>div{background:url(missing.png)}</style>'],
  ['text/html', '<button onclick="fetch(\'https://external.invalid\')">go</button>'],
  ['text/css', '@import "https://external.invalid/style";'],
  ['text/css', 'h1{background:url(https://external.invalid/img)}'],
  ['text/css', 'h1{background:url(missing.png)}'],
  ['text/css', 'h1{ color: url(] }'],
  ['text/javascript', 'import "missing.js"'],
  ['text/javascript', 'export * from "missing.js"'],
  ['text/javascript', 'import("missing.js")'],
  ['text/javascript', 'import(variable)'],
  ['text/javascript', 'import("./" + variable)'],
  ['text/javascript', 'fetch("https:\\x2f\\x2fexternal.invalid")'],
  ['text/javascript', 'const value="file:///private/secret"'],
  ['text/javascript', 'const value=;'],
])('rejects incomplete or external %s declaration %s', (mediaType, text) => {
  expect(() => {
    validateDependencies([asset('index.html', mediaType, text)])
  }).toThrow()
})
