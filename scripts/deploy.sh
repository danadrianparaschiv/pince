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
  ./scripts/deploy.sh setup                     Guided first deployment: answer the questions, then it creates the library
  ./scripts/deploy.sh init [--with-vision]       Provision resources and deploy the app
  ./scripts/deploy.sh publish                   Deploy code to the existing library
  ./scripts/deploy.sh budgets                   Configure group-scoped email alerts
  ./scripts/deploy.sh covers                    Provision and publish the background cover worker
  ./scripts/deploy.sh keys                      Add or replace the optional Google Books and Brave keys
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
  setup|keys|publish|budgets|covers|doctor|status|destroy) [[ $# -eq 1 ]] || { usage; exit 2; } ;;
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
# `doctor tools` leaves out the look at the resource group, which setup asks about itself.
doctor() {
  local problems=0 scope="${1:-all}"
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
      if [[ $scope == tools ]]; then :
      elif [[ $(az group exists --name "$group" 2>/dev/null) == true ]]; then
        if az deployment group show --resource-group "$group" --name pince-infra --query name -o tsv >/dev/null 2>&1; then
          note "A library exists in $group. Update it with: ./scripts/deploy.sh publish"
        else
          bad "The resource group $group exists but holds no library. Choose another name with LIBRARY_RESOURCE_GROUP."
        fi
      else
        note "No library in $group yet. Create one with: ./scripts/deploy.sh setup"
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

# Setup starts with the doctor, which says the same things with their fixes.
if [[ $mode != package && $mode != setup ]]; then
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
  library_exists || { printf 'There is no library in %s. Create one with: ./scripts/deploy.sh setup\n' "$group"; return 0; }
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

# Questions, for setup and keys. The question is printed here and not by `read -p`, which says
# nothing unless a terminal is attached. Input that ends is never taken for an answer.
no_answer() { fail $'\nNo answer was received, so the script stopped here.'; }
# The caller's variable is set by name, so the names used inside must not be a caller's.
ask() { # ask VARIABLE 'Question' ['answer used for an empty reply']
  local _typed
  printf '%s%s: ' "$2" "${3:+ [$3]}"
  IFS= read -r _typed || no_answer
  [[ -t 0 ]] || printf '\n'
  _typed="${_typed#"${_typed%%[![:space:]]*}"}"
  _typed="${_typed%"${_typed##*[![:space:]]}"}"
  printf -v "$1" '%s' "${_typed:-${3:-}}"
}
ask_hidden() { # Typed or pasted without being shown.
  local _typed
  printf '%s: ' "$2"
  IFS= read -r -s _typed || no_answer
  printf '\n'
  printf -v "$1" '%s' "$_typed"
}
agree() { # Yes only when said; an empty reply is no.
  local reply
  while true; do
    ask reply "$1 [y/N]"
    case "$reply" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      ''|[Nn]|[Nn][Oo]) return 1 ;;
    esac
    printf 'Answer y or n.\n'
  done
}

# The two optional keys of the cover lookups. Each is typed or pasted unseen and handed to its own
# script on standard input, which tries it with one request and stores it only if that works.
# A key is never a command argument.
offer_key() { # offer_key 'Service' its-script.mjs
  local key
  while true; do
    ask_hidden key "$1 API key (hidden; press Enter alone to skip)"
    if [[ -z $key ]]; then printf '  -  %s: skipped, nothing was changed.\n' "$1"; return 0; fi
    if printf '%s' "$key" | LIBRARY_RESOURCE_GROUP="$group" node "$root/scripts/$2"; then return 0; fi
    if ! agree "Try another $1 key?"; then printf '  -  %s: skipped.\n' "$1"; return 0; fi
  done
}
service_keys() {
  printf '\nOptional keys for finding covers. Add or replace them at any time with: ./scripts/deploy.sh keys\n\n'
  printf 'Google Books is a second catalogue for title checks and covers, after Open Library.\nCreate a key restricted to the Books API in Google Cloud; lookups need no billing.\n'
  offer_key 'Google Books' set-google-books-key.mjs
  printf '\nBrave image search finds covers of Romanian editions on bookshop and publisher pages.\nCreate a key at https://brave.com/search/api/; trying it uses one search of the monthly credit.\n'
  offer_key 'Brave Search' set-brave-search-key.mjs
}
if [[ $mode == keys ]]; then
  library_exists || fail "There is no library in $group. Create one with: ./scripts/deploy.sh setup"
  service_keys
  exit 0
fi

choose_subscription() {
  local list count=0 current=1 choice name id selected
  list="$(az account list --query '[].[name,id,isDefault]' -o tsv)"
  count="$(printf '%s\n' "$list" | grep -c . || true)"
  if [[ $count -le 1 ]]; then return 0; fi
  printf 'Your Azure subscriptions:\n'
  count=0
  while IFS=$'\t' read -r name id selected; do
    [[ -n $name ]] || continue
    count=$((count + 1))
    if [[ $selected == [Tt]rue ]]; then current=$count; printf '  %d. %s (selected)\n' "$count" "$name"
    else printf '  %d. %s\n' "$count" "$name"; fi
  done <<< "$list"
  while true; do
    ask choice 'Number of the subscription for the library' "$current"
    if [[ $choice =~ ^[1-9][0-9]{0,3}$ ]] && [[ $choice -le $count ]]; then break; fi
    printf 'Answer with a number from 1 to %d.\n' "$count"
  done
  if [[ $choice -ne $current ]]; then
    id="$(printf '%s\n' "$list" | grep . | sed -n "${choice}p" | cut -f2)"
    az account set --subscription "$id" --only-show-errors
    printf 'Azure commands on this computer now use that subscription.\n'
  fi
}
choose_password() { # choose_password VARIABLE parent|child
  local first again
  while true; do
    ask_hidden first "Password for the $2 account (10-128 characters, hidden)"
    if [[ ${#first} -lt 10 || ${#first} -gt 128 ]]; then printf 'A password needs 10 to 128 characters.\n'; continue; fi
    ask_hidden again 'The same password again'
    if [[ $first == "$again" ]]; then break; fi
    printf 'The two did not match. Start again.\n'
  done
  printf -v "$1" '%s' "$first"
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Asks for everything `init` needs, in order, and creates nothing itself: with every answer in
# place and a yes to the last question, the script carries on exactly as `init` does.
with_vision=0
guided_setup() {
  local group_rule='^[A-Za-z0-9._()-]{1,90}$' name_rule='^[a-zA-Z0-9_.-]{1,48}$' email_rule='^[^@[:space:]]+@[^@[:space:]]+$'
  local state parent child email offered_group="$group" offered_location="$location"
  printf 'Set-up of a Pince library on Azure. Nothing is created before you confirm at the end.\n\n'
  doctor tools || fail 'Fix what is listed above, then run setup again.'
  printf '\n'
  choose_subscription
  while true; do
    ask group 'Resource group for the library' "$offered_group"
    if ! [[ $group =~ $group_rule ]] || [[ $group == *. ]]; then
      printf 'Use 1 to 90 letters, digits, dashes, dots, underscores or parentheses, not ending in a dot.\n'; continue
    fi
    if [[ $(az group exists --name "$group") != true ]]; then break; fi
    if library_exists; then
      state="$(az deployment group show --resource-group "$group" --name pince-infra --query properties.provisioningState -o tsv)"
      if [[ $state == Succeeded ]]; then
        printf '\nA library already exists in %s, so nothing new is created.\nTo publish the code again: ./scripts/deploy.sh publish. To see what is deployed: ./scripts/deploy.sh status\n' "$group"
        service_keys
        exit 0
      fi
      printf 'An earlier attempt to create a library in %s did not finish. Set-up tries again there.\n' "$group"
      break
    fi
    if [[ $(az resource list --resource-group "$group" --query 'length(@)' -o tsv) == 0 ]]; then
      printf 'The resource group %s exists and is empty. The library goes there.\n' "$group"
      break
    fi
    printf 'The resource group %s exists and holds something else. Choose another name.\n' "$group"
  done
  while true; do
    ask location 'Azure region for the site and its storage' "$offered_location"
    if [[ $location =~ ^[a-z0-9]+$ ]]; then break; fi
    printf 'Give the region by its short name, such as westeurope.\n'
  done
  while true; do
    ask parent 'Name of the parent account' "${PARENT_USERNAME:-parinte}"
    ask child 'Name of the child account' "${CHILD_USERNAME:-copil}"
    if ! [[ $parent =~ $name_rule && $child =~ $name_rule ]]; then
      printf 'An account name is 1 to 48 letters, digits, dashes, dots or underscores, without accents.\n'
    elif [[ $(lower "$parent") == "$(lower "$child")" ]]; then
      printf 'Choose two different account names.\n'
    else break; fi
  done
  PARENT_USERNAME="$parent" CHILD_USERNAME="$child"
  if [[ -n ${BOOTSTRAP_PARENT_PASSWORD:-} ]]; then printf 'The parent password is taken from BOOTSTRAP_PARENT_PASSWORD.\n'
  else choose_password BOOTSTRAP_PARENT_PASSWORD parent; fi
  if [[ -n ${BOOTSTRAP_CHILD_PASSWORD:-} ]]; then printf 'The child password is taken from BOOTSTRAP_CHILD_PASSWORD.\n'
  else choose_password BOOTSTRAP_CHILD_PASSWORD child; fi
  # shellcheck disable=SC2016
  printf '\nPhoto recognition reads titles from a photo of a cover or a shelf, with a pay-per-use model\nin your subscription: less than a cent a scan, and the library stops at $1.50 a month. It stays off\nuntil the parent switches it on in Family settings. Without it you type titles and upload covers.\n'
  if agree 'Add photo recognition?'; then with_vision=1; fi
  while true; do
    ask email 'Email address for Azure cost alerts (Enter alone for none)' "${BUDGET_EMAIL:-}"
    if [[ -z $email || $email =~ $email_rule ]]; then break; fi
    printf 'That does not look like an email address.\n'
  done
  BUDGET_EMAIL="$email"
  printf '\nReady to create:\n'
  printf '  Subscription:       %s\n' "$(az account show --query name -o tsv)"
  printf '  Resource group:     %s, in %s\n' "$group" "$location"
  printf '  Accounts:           %s (parent) and %s (child)\n' "$parent" "$child"
  if [[ $with_vision == 1 ]]; then printf '  Photo recognition:  yes, in %s\n' "${VISION_LOCATION:-swedencentral}"
  else printf '  Photo recognition:  no\n'; fi
  printf '  Cost alerts:        %s\n\n' "${email:-none}"
  printf 'Creating the library takes six to seven minutes. DEPLOY.md explains what a month costs.\n'
  if ! agree 'Create the library now?'; then printf 'Nothing was created.\n'; exit 0; fi
}
guided=0
if [[ $mode == setup ]]; then
  guided_setup
  # From here on this is `init` with the answers above.
  mode=init guided=1
  if [[ $with_vision == 1 ]]; then set -- init --with-vision; else set -- init; fi
fi

for tool in node npm; do command -v "$tool" >/dev/null || fail 'Install Node 22 and npm 10.3 or newer.'; done
node -e 'if (+process.versions.node.split(".")[0] !== 22) process.exit(1)' || fail 'Use Node 22 for this deployment.'
node -e 'const [major,minor] = process.argv[1].split(".").map(Number); if (!(major > 10 || (major === 10 && minor >= 3))) process.exit(1)' "$(npm --version)" || fail 'Use npm 10.3 or newer for Linux dependency selection.'
if [[ $mode != package ]]; then
  command -v swa >/dev/null || fail 'Install Azure Static Web Apps CLI 2.1.0 or newer.'
  node -e 'const [major,minor] = process.argv[1].trim().split(".").map(Number); if (!(major > 2 || (major === 2 && minor >= 1))) process.exit(1)' "$(swa --version)" || fail 'Upgrade Static Web Apps CLI to 2.1.0 or newer for the Node 22 runtime.'
fi
stage="$(mktemp -d)"
finish() {
  local code=$?
  rm -rf -- "$stage"
  if [[ $guided == 1 && $code -ne 0 ]]; then
    printf '\nSet-up stopped before the library was ready. When the cause above is fixed, run\n./scripts/deploy.sh setup again with the same resource group; it says how to carry on.\n' >&2
  fi
}
trap finish EXIT
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
if [[ $mode == init && -n ${BUDGET_EMAIL:-} ]]; then
  if [[ $guided == 1 ]]; then
    # A subscription that cannot hold budgets yet must not undo a library that is already live.
    budget_alerts || printf 'The cost alerts could not be created. The library works without them; try later with: BUDGET_EMAIL=... ./scripts/deploy.sh budgets\n'
  else budget_alerts; fi
fi
printf 'Library URL: https://%s\n' "$hostname"
if [[ $guided == 1 ]]; then
  service_keys
  printf '\nThe library is ready at https://%s\nSign in as %s with the parent password you chose, and keep both passwords in your password manager.\n' "$hostname" "$PARENT_USERNAME"
fi
