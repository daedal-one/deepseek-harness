/** Verify image delivery to the model in the keyless PTC image composition. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'

export const name = 'snapshot-ptc-image-request'
export const inject = ['llm']

/** Require each follow-up request to retain the previously returned PNG attachments. */
export function apply(ctx: Context): void {
  let requests = 0
  ctx.on('llm/stream', (options, next) => {
    requests += 1
    if (requests > 1) {
      const images = options.messages.flatMap(message => message.content.filter(block => block.type === 'image'))
      assert.ok(images.length >= requests - 1, 'PTC image replay must deliver each prior image to the model request')
      for (const image of images) {
        assert.equal(image.attachment.attachmentId, 'sha256:b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640')
        assert.equal(image.attachment.mediaType, 'image/png')
        assert.equal(image.attachment.bytes, 69)
      }
    }
    return next()
  }, { prepend: true })
}
