/** Native pi-ai OAuth login exposed through the provider-neutral LLM seam. */

import { createModels } from '@earendil-works/pi-ai'
import type { AuthPrompt, CredentialStore, MutableModels, Provider } from '@earendil-works/pi-ai'
import type { LlmProviderAuthenticator } from '@deepseek-ai/dsh-llm'

/** Select pi-ai's headless-safe device flow or refuse an unexpected prompt. */
function answerDevicePrompt(prompt: AuthPrompt): Promise<string> {
  if (prompt.type === 'select' && prompt.options.some(option => option.id === 'device_code')) {
    return Promise.resolve('device_code')
  }
  return Promise.reject(new Error('llm-pi-ai: this provider login requires an unsupported interactive prompt'))
}

/**
 * Build the provider-neutral authenticator for one OAuth catalog provider.
 * @param provider - installed pi-ai provider with an OAuth method.
 * @param credentials - durable pi-ai credential store.
 * @returns authenticator using the provider's native login implementation.
 */
export function piAiOAuthAuthenticator(
  provider: Provider,
  credentials: CredentialStore,
): LlmProviderAuthenticator {
  const oauth = provider.auth.oauth
  if (oauth === undefined) throw new Error(`llm-pi-ai: provider "${provider.id}" does not offer OAuth`)
  const models: MutableModels = createModels({ credentials })
  models.setProvider(provider)
  return {
    method: { type: 'oauth', name: oauth.name },
    async authenticated() {
      return (await models.checkAuth(provider.id))?.type === 'oauth'
    },
    async login(signal, notify) {
      await models.login(provider.id, 'oauth', {
        signal,
        prompt: answerDevicePrompt,
        notify: (event) => {
          if (event.type !== 'device_code') return
          notify({
            type: 'device-code',
            authorization: {
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              ...event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds },
              ...event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds },
            },
          })
        },
      })
    },
    async logout() {
      await models.logout(provider.id)
    },
  }
}
