/** Complete declared resource admission; runtime enforcement owns computed resource requests. @module */
import { posix } from 'node:path'
import MarkdownIt from 'markdown-it'
import { parse } from 'acorn'
import type {
  Node,
  Literal,
  ImportDeclaration,
  ExportNamedDeclaration,
  ExportAllDeclaration,
  ImportExpression,
} from 'acorn'
import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseCss, walk } from 'css-tree'
import type { ArtifactAssetInput } from '@deepseek-ai/dsh-artifact'

/**
 * Refuse packages whose declared resources cannot be supplied by their immutable manifest.
 * @param assets - admitted complete asset bytes; no path or URL reads occur.
 */
export function validateDependencies(assets: readonly { input: ArtifactAssetInput; bytes: Buffer }[]): void {
  const names = new Set(assets.map(asset => asset.input.name))
  const reference = (owner: string, value: string): void => {
    if (value.startsWith('#')) return
    if (
      !/^(?:\.\/)?[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*(?:#[a-zA-Z0-9_.-]+)?$/u.test(
        value,
      )
    )
      throw new Error(
        'Artifact dependency must be a canonical published asset, without remote URLs, traversal or queries.',
      )
    const target = posix.join(posix.dirname(owner), value.replace(/#[a-zA-Z0-9_.-]+$/u, ''))
    if (!names.has(target))
      throw new Error('Artifact dependency is absent from the explicit asset manifest: ' + target)
  }
  const css = (owner: string, text: string, context: 'stylesheet' | 'declarationList'): void => {
    const tree = parseCss(text, {
      context,
      parseCustomProperty: true,
    })
    walk(tree, (node) => {
      if (node.type === 'Raw')
        throw new Error('Artifact CSS must parse without opaque resource declarations.')
      if (node.type === 'Url') reference(owner, node.value)
      if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude !== null)
        walk(node.prelude, (child) => {
          if (child.type === 'String') reference(owner, child.value)
        })
    })
  }
  const js = (owner: string, text: string, handler = false): void => {
    const tree = parse(text, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: handler,
    })
    const pending: Node[] = [tree]
    for (const node of pending) {
      if (node.type === 'Literal') {
        const value = (node as Literal).value
        if (
          typeof value === 'string' &&
          /^(?:(?:https?|wss?|file|data|blob|javascript|ftp):|\/\/)/iu.test(value)
        )
          throw new Error('Artifact JavaScript declares a remote resource or external protocol.')
      }
      if (
        node.type === 'ImportDeclaration' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportAllDeclaration'
      ) {
        const source = (node as ImportDeclaration | ExportNamedDeclaration | ExportAllDeclaration).source
        if (source != null) reference(owner, String(source.value))
      }
      if (node.type === 'ImportExpression') {
        const source = (node as ImportExpression).source
        if (source.type !== 'Literal' || typeof source.value !== 'string')
          throw new Error('Artifact imports must name literal published assets.')
        reference(owner, (source as Literal & { value: string }).value)
      }
      for (const value of Object.values(node)) {
        const children = Array.isArray(value) ? value : [value]
        for (const child of children)
          if (typeof child === 'object' && child !== null && 'type' in child) pending.push(child as Node)
      }
    }
  }
  const html = (owner: string, text: string): void => {
    const pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(text)]
    for (const node of pending) {
      if ('childNodes' in node) pending.push(...node.childNodes)
      if (!('tagName' in node)) continue
      if (['base', 'iframe', 'object', 'embed'].includes(node.tagName))
        throw new Error('Artifact embedded documents and alternate resource bases are unsupported.')
      if (node.tagName === 'template') pending.push((node as DefaultTreeAdapterTypes.Template).content)
      if (node.tagName === 'meta' && node.attrs.some(attr => attr.name === 'http-equiv'))
        throw new Error('Artifact metadata cannot declare navigation or resource policy.')
      for (const attr of node.attrs) {
        if (['srcset', 'imagesrcset', 'ping'].includes(attr.name))
          throw new Error('Artifact resource lists must use separate explicit assets.')
        if (['src', 'href', 'action', 'formaction', 'poster', 'background'].includes(attr.name))
          reference(owner, attr.value)
        if (attr.name === 'style') css(owner, attr.value, 'declarationList')
        if (attr.name.startsWith('on')) js(owner, attr.value, true)
      }
      const body = node.childNodes
        .filter(child => child.nodeName === '#text')
        .map(child => (child as DefaultTreeAdapterTypes.TextNode).value)
        .join('')
      if (node.tagName === 'style') css(owner, body, 'stylesheet')
      if (node.tagName === 'script') {
        const type = node.attrs.find(attr => attr.name === 'type')?.value
        if (type === undefined || type === 'module' || type === 'text/javascript') js(owner, body)
        else if (type !== 'application/json' && type !== 'application/ld+json')
          throw new Error('Artifact script type is unsupported.')
      }
    }
  }
  const markdown = new MarkdownIt({ html: false, linkify: false })
  for (const { input, bytes } of assets) {
    if (input.mediaType === 'text/html' || input.mediaType === 'image/svg+xml')
      html(input.name, bytes.toString('utf8'))
    if (input.mediaType === 'text/markdown') {
      const tokens = markdown.parse(bytes.toString('utf8'), {})
      for (const token of tokens) {
        if (token.children !== null) tokens.push(...token.children)
        if (token.type === 'image') reference(input.name, String(token.attrGet('src')))
      }
    }
    if (input.mediaType === 'text/javascript') js(input.name, bytes.toString('utf8'))
    if (input.mediaType === 'text/css') css(input.name, bytes.toString('utf8'), 'stylesheet')
  }
}
