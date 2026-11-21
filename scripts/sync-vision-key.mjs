// Give the site the text-detection endpoint and key of the library's own Vision account, if it has one.
// `publish` does not re-run the infrastructure template, so an existing library picks the settings up here.
// All settings are captured in memory and passed to ARM through stdin.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function syncVisionKey(group = process.env.LIBRARY_RESOURCE_GROUP || 'pince-rg') {
  const az = (args, input) => {
    try { return execFileSync('az', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { throw Error('Unable to synchronize the text-detection setting. Check Azure access.'); }
  };
  const accounts = JSON.parse(az(['cognitiveservices', 'account', 'list', '-g', group,
    '--query', "[?kind=='ComputerVision' && starts_with(name, 'pince-ocr-')].{name:name, endpoint:properties.endpoint}", '-o', 'json']));
  if (accounts.length !== 1) return false;
  const key = az(['cognitiveservices', 'account', 'keys', 'list', '-g', group, '-n', accounts[0].name, '--query', 'key1', '-o', 'tsv']).trim();
  const site = az(['deployment', 'group', 'show', '-g', group, '-n', 'pince-infra', '--query', 'properties.outputs.siteName.value', '-o', 'tsv']).trim();
  const info = JSON.parse(az(['staticwebapp', 'show', '-g', group, '-n', site, '-o', 'json']));
  const settings = JSON.parse(az(['staticwebapp', 'appsettings', 'list', '-g', group, '-n', site, '-o', 'json'])).properties;
  if (settings.AZURE_VISION_ENDPOINT === accounts[0].endpoint && settings.AZURE_VISION_KEY === key) return true;
  settings.AZURE_VISION_ENDPOINT = accounts[0].endpoint;
  settings.AZURE_VISION_KEY = key;
  az(['rest', '--method', 'put', '--url', 'https://management.azure.com' + info.id + '/config/appsettings?api-version=2024-11-01',
    '--body', '@-', '--only-show-errors', '-o', 'none'], JSON.stringify({ properties: settings }));
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(syncVisionKey() ? 'Text-detection setting synchronized securely.' : 'No text-detection account in this group; shelf cut-outs stay off.');
}
