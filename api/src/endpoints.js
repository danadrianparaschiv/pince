// Which addresses a key may be sent to. A key for an Azure service only ever goes to an HTTPS
// address on that service's own domain, whoever supplied the address.
function azureHost(value, pattern) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && pattern.test(url.host) && !url.username && !url.password;
  } catch {
    return false;
  }
}
/** The vision model: an Azure OpenAI or Azure AI resource. */
export const validModelEndpoint = (value) =>
  azureHost(value, /\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/);
/** The text detector: an Azure AI Vision resource. */
export const validTextEndpoint = (value) => azureHost(value, /\.cognitiveservices\.azure\.com$/);
