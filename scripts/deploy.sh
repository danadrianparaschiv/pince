#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
group="${LIBRARY_RESOURCE_GROUP:-pince-rg}"
location="${LIBRARY_LOCATION:-westeurope}"
mode="${1:-help}"
usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy.sh init [--with-vision]       Provision resources and deploy the app
  ./scripts/deploy.sh publish                   Deploy code to the existing library
  ./scripts/deploy.sh budgets                   Configure group-scoped email alerts
  ./scripts/deploy.sh covers                    Provision and publish the background cover worker
  ./scripts/deploy.sh package NEW_DIRECTORY     Prepare web and Linux x64 API artifacts locally
  ./scripts/deploy.sh doctor                    Check this computer and your Azure sign-in before deploying
  ./scripts/deploy.sh status                    Show what is deployed and which optional services are set
  ./scripts/deploy.sh destroy                   Delete the library and everything in it, after confirmation
See DEPLOY.md for settings and costs. Azure commands use the selected az subscription.
USAGE
}
fail() { printf '%s\n' "$*" >&2; exit 1; }
case "$mode" in
  help|-h|--help) usage; exit 0 ;;
  init) [[ $# -eq 1 || ( $# -eq 2 && $2 == '--with-vision' ) ]] || { usage; exit 2; } ;;
  publish|budgets|covers|doctor|status|destroy) [[ $# -eq 1 ]] || { usage; exit 2; } ;;
  package) [[ $# -eq 2 && -n $2 && ! -e $2 ]] || fail 'Supply a new package directory.' ;;
  *) usage; exit 2 ;;
esac

# Prints what is wrong with Bicep, or nothing when it works. Bicep is a .NET program: on a minimal
# Linux it installs but cannot start without the ICU library, which is a different fix.
bicep_problem() {
  local out
  if out="$(az bicep version 2>&1)"; then return 0; fi
  if [[ $out == *ICU* ]]; then
    printf '%s' 'Bicep is installed but cannot start: it needs the ICU library. On Ubuntu or Debian: sudo apt-get install libicu-dev. On Fedora: sudo dnf install libicu'
  else
    printf '%s' 'Bicep is not installed: az bicep install'
  fi
}

# Reports every problem at once instead of stopping at the first, and changes nothing.
doctor() {
  local problems=0
  ok() { printf ' ok  %s\n' "$*"; }
  bad() { printf ' !!  %s\n' "$*"; problems=$((problems + 1)); }
  note() { printf '  -  %s\n' "$*"; }
  if command -v node >/dev/null; then
    if node -e 'if (+process.versions.node.split(".")[0] !== 22) process.exit(1)'; then ok "Node.js $(node --version)"
    else bad "Node.js $(node --version): use Node 22."; fi
  else bad 'Node.js is not installed: install Node 22.'; fi
  if command -v npm >/dev/null; then
    if node -e 'const [major,minor] = process.argv[1].split(".").map(Number); if (!(major > 10 || (major === 10 && minor >= 3))) process.exit(1)' "$(npm --version)" 2>/dev/null; then ok "npm $(npm --version)"
    else bad "npm $(npm --version): use npm 10.3 or newer."; fi
  else bad 'npm is not installed.'; fi
  if command -v zip >/dev/null; then ok 'zip'; else bad 'zip is not installed; the cover worker is uploaded as a zip file.'; fi
  if command -v swa >/dev/null; then
    if node -e 'const [major,minor] = process.argv[1].trim().split(".").map(Number); if (!(major > 2 || (major === 2 && minor >= 1))) process.exit(1)' "$(swa --version)" 2>/dev/null; then ok "Static Web Apps CLI $(swa --version)"
    else bad "Static Web Apps CLI $(swa --version): install 2.1.0 or newer with: npm install --global @azure/static-web-apps-cli@2.1.0"; fi
  else bad 'Static Web Apps CLI is not installed: npm install --global @azure/static-web-apps-cli@2.1.0'; fi
  if command -v az >/dev/null; then
    ok 'Azure CLI'
    local bicep subscription
    bicep="$(bicep_problem)"
    if [[ -z $bicep ]]; then ok 'Bicep'; else bad "$bicep"; fi
    if subscription="$(az account show --query name -o tsv 2>/dev/null)" && [[ -n $subscription ]]; then
      ok "Signed in to Azure; subscription: $subscription"
      if [[ $(az group exists --name "$group" 2>/dev/null) == true ]]; then
        if az deployment group show --resource-group "$group" --name pince-infra --query name -o tsv >/dev/null 2>&1; then
          note "A library exists in $group. Update it with: ./scripts/deploy.sh publish"
        else
          bad "The resource group $group exists but holds no library. Choose another name with LIBRARY_RESOURCE_GROUP."
        fi
      else
        note "No library in $group yet. Create one with: ./scripts/deploy.sh init"
      fi
    else
      bad 'Not signed in to Azure: az login'
    fi
  else
    bad 'Azure CLI is not installed: https://learn.microsoft.com/cli/azure/install-azure-cli'
  fi
  if [[ $problems -gt 0 ]]; then printf '\n%s to fix before deploying.\n' "$problems problem(s)"; return 1; fi
  printf '\nThis computer is ready to deploy.\n'
}
if [[ $mode == doctor ]]; then doctor; exit $?; fi

if [[ $mode != package ]]; then
  command -v az >/dev/null || fail 'Install Azure CLI and run az login.'
  az account show --query '{subscription:name,id:id}' -o table
fi
# A Bicep that cannot start would otherwise stop init only after the resource group was created.
case "$mode" in init|publish|covers|budgets)
  bicep="$(bicep_problem)"
  [[ $bicep != *'cannot start'* ]] || fail "$bicep" ;;
esac

# A resource group counts as a library only if this script created one in it.
library_exists() {
  [[ $(az group exists --name "$group") == true ]] &&
    az deployment group show --resource-group "$group" --name pince-infra --query name -o tsv >/dev/null 2>&1
}

# What is deployed. Settings are shown as set or not set, never by value.
status() {
  library_exists || { printf 'There is no library in %s. Create one with: ./scripts/deploy.sh init\n' "$group"; return 0; }
  local site hostname worker
  site="$(az deployment group show --resource-group "$group" --name pince-infra --query properties.outputs.siteName.value -o tsv)"
  hostname="$(az staticwebapp show --name "$site" --resource-group "$group" --query defaultHostname -o tsv)"
  printf 'Resource group: %s\nSite:           %s\nAddress:        https://%s\n' "$group" "$site" "$hostname"
  node -e '
    fetch(process.argv[1] + "/release.json", { signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : {})
      .then(v => console.log("Release:        " + (typeof v.release === "string" ? v.release.slice(0, 12) : "unknown")))
      .catch(() => console.log("Release:        the site did not answer"));' "https://$hostname"
  printf 'Site settings:\n'
  az staticwebapp appsettings list --resource-group "$group" --name "$site" --query properties -o json | node -e '
    let text = ""; process.stdin.on("data", c => text += c).on("end", () => {
      const have = JSON.parse(text || "{}"), set = names => names.every(n => typeof have[n] === "string" && have[n] !== "");
      const line = (label, names) => console.log("  " + label.padEnd(20) + (set(names) ? "set" : "not set"));
      line("Photo recognition", ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_KEY"]);
      line("Text detection", ["AZURE_VISION_ENDPOINT", "AZURE_VISION_KEY"]);
      line("Google Books", ["GOOGLE_BOOKS_API_KEY"]);
    });'
  worker="$(az deployment group show --resource-group "$group" --name pince-covers --query properties.outputs.workerName.value -o tsv 2>/dev/null || true)"
  if [[ -n $worker ]]; then
    printf 'Cover worker:   %s\n' "$worker"
    az functionapp config appsettings list --resource-group "$group" --name "$worker" -o json | node -e '
      let text = ""; process.stdin.on("data", c => text += c).on("end", () => {
        const have = Object.fromEntries(JSON.parse(text || "[]").map(s => [s.name, s.value]));
        for (const [label, name] of [["Google Books", "GOOGLE_BOOKS_API_KEY"], ["Brave image search", "BRAVE_SEARCH_API_KEY"]])
          console.log("  " + label.padEnd(20) + (typeof have[name] === "string" && have[name] !== "" ? "set" : "not set"));
      });'
  else
    printf 'Cover worker:   not deployed. Run: ./scripts/deploy.sh covers\n'
  fi
}
if [[ $mode == status ]]; then status; exit 0; fi

# Deletes the whole resource group: the site, the catalogue, every cover and shelf photo.
destroy() {
  library_exists || fail "There is no library in $group. Nothing was deleted."
  printf 'This permanently deletes the library in %s:\n' "$group"
  az resource list --resource-group "$group" --query '[].{name:name,type:type}' -o table
  printf '\nThe catalogue, notes, covers and shelf photos cannot be recovered afterwards.\nDownload a backup from Family settings first if you may want them back.\n\n'
  local answer="${LIBRARY_CONFIRM_DESTROY:-}"
  if [[ -z $answer ]]; then
    [[ -t 0 ]] || fail 'Nothing was deleted. Run this in a terminal to confirm, or set LIBRARY_CONFIRM_DESTROY to the group name.'
    read -r -p "Type the resource group's name to delete it: " answer
  fi
  [[ $answer == "$group" ]] || fail 'The name did not match. Nothing was deleted.'
  # Azure keeps deleted AI accounts for weeks, which blocks creating a library with the same
  # names and holds the one free text-detection account. Note them now and clear them afterwards.
  local accounts
  accounts="$(az cognitiveservices account list --resource-group "$group" --query '[].[name,location]' -o tsv)"
  az group delete --name "$group" --yes --only-show-errors
  while IFS=$'\t' read -r name place; do
    [[ -n $name ]] || continue
    az cognitiveservices account purge --name "$name" --resource-group "$group" --location "$place" --only-show-errors ||
      printf 'Could not clear the deleted account %s; clear it in the Azure portal before creating a new library.\n' "$name"
  done <<< "$accounts"
  printf 'The library in %s was deleted.\n' "$group"
}
if [[ $mode == destroy ]]; then destroy; exit 0; fi

budget_alerts() {
  [[ -n ${BUDGET_EMAIL:-} ]] || fail 'Set BUDGET_EMAIL for the Azure billing alerts.'
  az deployment group create --only-show-errors --name pince-budgets --resource-group "$group" \
    --template-file "$root/infra/budgets.bicep" \
    --parameters contactEmail="$BUDGET_EMAIL" monthlyAmount="${MONTHLY_BILLING_BUDGET:-3}" \
    annualAmount="${ANNUAL_BILLING_BUDGET:-30}" startDate="${BUDGET_START_DATE:-$(date -u +%Y-%m-01)}" -o none
}
if [[ $mode == budgets ]]; then budget_alerts; exit 0; fi

for tool in node npm; do command -v "$tool" >/dev/null || fail 'Install Node 22 and npm 10.3 or newer.'; done
node -e 'if (+process.versions.node.split(".")[0] !== 22) process.exit(1)' || fail 'Use Node 22 for this deployment.'
node -e 'const [major,minor] = process.argv[1].split(".").map(Number); if (!(major > 10 || (major === 10 && minor >= 3))) process.exit(1)' "$(npm --version)" || fail 'Use npm 10.3 or newer for Linux dependency selection.'
if [[ $mode != package ]]; then
  command -v swa >/dev/null || fail 'Install Azure Static Web Apps CLI 2.1.0 or newer.'
  node -e 'const [major,minor] = process.argv[1].trim().split(".").map(Number); if (!(major > 2 || (major === 2 && minor >= 1))) process.exit(1)' "$(swa --version)" || fail 'Upgrade Static Web Apps CLI to 2.1.0 or newer for the Node 22 runtime.'
fi
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/api" "$stage/web"
cp -R "$root/web/." "$stage/web/"
cp -R "$root/api/src" "$root/api/package.json" "$root/api/package-lock.json" "$root/api/host.json" "$stage/api/"
[[ -f "$stage/api/src/azure.js" && -f "$stage/web/app.js" ]] || fail 'The frontend or Azure Functions entry point is missing.'
release="$(node --input-type=module - "$stage" <<'NODE'
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const hash = createHash('sha256');
function walk(path) {
  for (const entry of readdirSync(join(dir, path), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name === '.DS_Store') continue;
    const file = join(path, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) hash.update(file + '\0').update(readFileSync(join(dir,file))).update('\0');
    else throw new Error('Unexpected packaged file ' + file);
  }
}
walk('api'); walk('web');
const release = hash.digest('hex');
writeFileSync(join(dir,'web','release.json'), JSON.stringify({release}));
console.log(release);
NODE
)"
# SWA CLI uploads prebuilt source and dependencies. Azure runs Linux x64, including when the developer uses a Mac.
npm ci --prefix "$stage/api" --omit=dev --include=optional --os=linux --cpu=x64 --libc=glibc --no-audit --no-fund
# npm 10 can install both libc variants. Only glibc is used by the managed Functions runtime.
rm -rf -- "$stage/api/node_modules/@img/sharp-linuxmusl-x64" "$stage/api/node_modules/@img/sharp-libvips-linuxmusl-x64"
# The temp parent stays private; files in the deployed zip must be readable by the Functions worker.
chmod -R u=rwX,go=rX "$stage/api" "$stage/web"
[[ -d "$stage/api/node_modules/@img/sharp-linux-x64" && -d "$stage/api/node_modules/@img/sharp-libvips-linux-x64" ]] || fail 'The package is missing the Linux Sharp image libraries.'
if [[ $mode == package ]]; then
  mkdir "$2"
  cp -pR "$stage/web" "$stage/api" "$2/"
  printf 'Prepared %s (release %s)\n' "$2" "$release"
  exit 0
fi

if [[ $mode == init ]]; then
  if [[ -z ${BOOTSTRAP_PARENT_PASSWORD:-} ]]; then
    read -r -s -p 'Initial parent password (10–128 characters): ' BOOTSTRAP_PARENT_PASSWORD; echo
  fi
  if [[ -z ${BOOTSTRAP_CHILD_PASSWORD:-} ]]; then
    read -r -s -p 'Initial child password (10–128 characters): ' BOOTSTRAP_CHILD_PASSWORD; echo
  fi
  export BOOTSTRAP_PARENT_PASSWORD BOOTSTRAP_CHILD_PASSWORD
  export PARENT_USERNAME="${PARENT_USERNAME:-parinte}" CHILD_USERNAME="${CHILD_USERNAME:-copil}"
  params() {
    node - "$1" "$location" <<'NODE'
const e = process.env;
if ([e.BOOTSTRAP_PARENT_PASSWORD,e.BOOTSTRAP_CHILD_PASSWORD].some(v => v.length < 10 || v.length > 128)) {
  throw new Error('Each initial password must be 10–128 characters long.');
}
if (![e.PARENT_USERNAME,e.CHILD_USERNAME].every(v => /^[a-zA-Z0-9_.-]{1,48}$/.test(v))) {
  throw new Error('Account names must be 1–48 ASCII letters, digits, dashes, dots or underscores.');
}
if (e.PARENT_USERNAME.toLowerCase() === e.CHILD_USERNAME.toLowerCase()) {
  throw new Error('Choose two different account names.');
}
const values = {
  parentUsername:e.PARENT_USERNAME, childUsername:e.CHILD_USERNAME,
  parentPassword:e.BOOTSTRAP_PARENT_PASSWORD, childPassword:e.BOOTSTRAP_CHILD_PASSWORD,
  location:process.argv[3], enableVision:process.argv[2] === '--with-vision',
  visionLocation:e.VISION_LOCATION || 'swedencentral',
  taxMultiplier:e.TAX_MULTIPLIER || '1.25', monthlyAzureReserve:e.AZURE_MONTHLY_RESERVE_USD || '0.60'
};
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}]))));
NODE
  }
  # Validate user input before creating any resource. The only secret delivery channel is stdin.
  params "${2:-}" >/dev/null
  az group create --name "$group" --location "$location" --only-show-errors -o none
  params "${2:-}" | az deployment group create --resource-group "$group" --name pince-infra \
    --template-file "$root/infra/main.bicep" --parameters @/dev/stdin --only-show-errors -o none
  if [[ ${LIBRARY_REASSIGN_ROLES:-} == 1 ]]; then
    site="$(az deployment group show --resource-group "$group" --name pince-infra --query properties.outputs.siteName.value -o tsv)"
    az staticwebapp appsettings list --resource-group "$group" --name "$site" \
      --query properties.AZURE_STORAGE_CONNECTION_STRING -o tsv |
      (cd "$stage/api" && node --input-type=module -e '
        import { AzureStore } from "./src/azure-store.js";
        import { reassignConfiguredRoles } from "./src/auth.js";
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        try {
          await reassignConfiguredRoles(new AzureStore(Buffer.concat(chunks).toString().trim()), process.env);
        } catch (error) {
          console.error("Account role reassignment failed", error.code || "storage");
          process.exitCode = 1;
        }
      ')
  fi
fi

# Managed Static Web Apps support HTTP triggers only. The small queue worker
# uses Flex Consumption, with no always-ready instances or paid log workspace.
# Preserve the worker's existing Google and Brave keys across deployments. Keys travel
# via captured process output and stdin, never shell arguments or deployment logs.
node --input-type=module - "$group" "$location" <<'NODE' | az deployment group create --only-show-errors --name pince-covers --resource-group "$group" \
  --template-file "$root/infra/covers.bicep" --parameters @/dev/stdin -o none
import { execFileSync } from 'node:child_process';
const [group, location] = process.argv.slice(2);
const az = args => execFileSync('az', args, { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
let key = process.env.GOOGLE_BOOKS_API_KEY, brave = process.env.BRAVE_SEARCH_API_KEY;
if (key === undefined || brave === undefined) {
  const apps = JSON.parse(az(['functionapp','list','-g',group,'--query',"[?starts_with(name, 'pince-covers-')].name",'-o','json']));
  if (apps.length > 1) throw new Error('Ambiguous cover worker; set GOOGLE_BOOKS_API_KEY and BRAVE_SEARCH_API_KEY explicitly.');
  const stored = name => apps.length ? JSON.parse(az(['functionapp','config','appsettings','list','-g',group,'-n',apps[0],
    '--query',"[?name=='" + name + "'].value",'-o','json']))[0] || '' : '';
  key ??= stored('GOOGLE_BOOKS_API_KEY');
  brave ??= stored('BRAVE_SEARCH_API_KEY');
}
process.stdout.write(JSON.stringify({ location:{value:location}, googleBooksApiKey:{value:key}, braveSearchApiKey:{value:brave} }));
NODE
worker="$(az deployment group show --resource-group "$group" --name pince-covers --query properties.outputs.workerName.value -o tsv)"
# Older deployments used account keys for all three connections. Remove any
# retained legacy settings before starting the new worker package.
legacy_settings="$(az functionapp config appsettings list --resource-group "$group" --name "$worker" \
  --query "length([?name=='AzureWebJobsStorage' || name=='AZURE_STORAGE_CONNECTION_STRING' || name=='DEPLOYMENT_STORAGE_CONNECTION_STRING'])" -o tsv)"
if [[ $legacy_settings != 0 ]]; then
  az functionapp config appsettings delete --resource-group "$group" --name "$worker" \
    --setting-names AzureWebJobsStorage AZURE_STORAGE_CONNECTION_STRING DEPLOYMENT_STORAGE_CONNECTION_STRING \
    --only-show-errors -o none
fi
mkdir "$stage/worker"
cp -R "$stage/api/." "$stage/worker/"
cp "$root/worker/main.js" "$root/worker/host.json" "$stage/worker/"
node --input-type=module - "$stage/worker/package.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2], pkg = JSON.parse(readFileSync(file));
pkg.main = 'main.js';
writeFileSync(file, JSON.stringify(pkg));
NODE
chmod -R u=rwX,go=rX "$stage/worker"
(cd "$stage/worker" && zip -qr "$stage/covers.zip" .)
az functionapp deployment source config-zip --only-show-errors --resource-group "$group" --name "$worker" \
  --src "$stage/covers.zip" --build-remote false -o none
if [[ $mode == covers ]]; then printf 'Background cover worker deployed.\n'; exit 0; fi

LIBRARY_RESOURCE_GROUP="$group" node "$root/scripts/sync-review-key.mjs"
LIBRARY_RESOURCE_GROUP="$group" node "$root/scripts/sync-vision-key.mjs"

site="$(az deployment group show --resource-group "$group" --name pince-infra --query properties.outputs.siteName.value -o tsv)"
hostname="$(az staticwebapp show --name "$site" --resource-group "$group" --query defaultHostname -o tsv)"
[[ -n $site && -n $hostname ]] || fail 'Missing site output. Run init for this resource group first.'
(
  cd "$stage"
  unset BOOTSTRAP_PARENT_PASSWORD BOOTSTRAP_CHILD_PASSWORD
  SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list --resource-group "$group" --name "$site" --query properties.apiKey -o tsv)"
  [[ -n $SWA_CLI_DEPLOYMENT_TOKEN ]] || fail 'Azure returned an empty deployment token.'
  # A GitHub Actions log is public: tell the runner to blank this token wherever it might be printed.
  [[ -z ${GITHUB_ACTIONS:-} ]] || printf '::add-mask::%s\n' "$SWA_CLI_DEPLOYMENT_TOKEN"
  export SWA_CLI_DEPLOYMENT_TOKEN
  swa --verbose log deploy ./web --app-location . --swa-config-location ./web --api-location ./api --api-language node --api-version 22 --env production
)
node "$root/scripts/deploy-check.mjs" "https://$hostname" "$release"
if [[ $mode == init && -n ${BUDGET_EMAIL:-} ]]; then budget_alerts; fi
printf 'Library URL: https://%s\n' "$hostname"
