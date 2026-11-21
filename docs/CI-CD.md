# Continuous integration and delivery

Three GitHub Actions workflows check every change, publish releases, and deploy to Azure. None of them stores a password or a key, and none of them runs with access to Azure for a pull request.

| Workflow | Runs when | What it does |
| --- | --- | --- |
| [Tests](../.github/workflows/tests.yml) | Every push to `main` and every pull request | Checks both targets, with no secrets and no cloud account |
| [Release](../.github/workflows/release.yml) | A version tag such as `v1.2.0` is pushed | Checks the code, publishes a GitHub release, and optionally deploys it to Azure |
| [Deploy to Azure](../.github/workflows/deploy-azure.yml) | Started by hand, or called by a release | Publishes the code to an existing library |

## What "Tests" checks

**The local library**, on Linux, macOS and Windows:

1. installs with `npm run setup` and runs the health check (`npm run doctor`);
2. runs the tests with the coverage limits (`npm run coverage`);
3. starts the library the way `npm start` does and uses it: opens the page, signs in, saves a book, reads its public address and sets it up with the one-time link; then starts it again as it runs behind an HTTPS proxy, and checks that it stops cleanly (`npm run smoke`).

Windows runs every time but does not block a merge yet. Once it has passed for a while, remove `continue-on-error` from the workflow to make it count.

**The Azure deployment code**, without touching Azure:

1. lints `scripts/deploy.sh`;
2. checks that every helper script parses;
3. builds the three Bicep templates;
4. builds the package that would be deployed, with the Linux image libraries Azure needs.

You can run the same checks on your computer:

```sh
npm run doctor
npm run check
npm run smoke
shellcheck scripts/deploy.sh
./scripts/deploy.sh package /tmp/pince-package
```

## Releasing

A release is how people who run Pince on their own computer get a new version, and it is the point at which Azure is updated.

```sh
npm version patch
git push --follow-tags
```

`npm version` raises the version in `package.json`, commits, and creates the matching tag (`patch`, `minor` or `major`). The Release workflow refuses a tag that does not match `package.json`, runs the full checks, and then publishes a GitHub release with notes generated from the merged pull requests.

To update a local library from a release, download it or pull the tag, then run `npm run setup` and `npm start`. The data in `.library/` is left alone.

## Deploying to Azure

The workflow runs `./scripts/deploy.sh publish`, the same command you would run by hand. It updates the site, the API and the cover worker, keeps the stored service keys, and ends with the script's own checks against the published site.

It does **not** create a library. Run `./scripts/deploy.sh init` once from your computer first, because it asks for the two account passwords; see [DEPLOY.md](../DEPLOY.md). Service keys are also stored from your computer, as described in [Configuration](CONFIGURATION.md#storing-a-service-key).

### One-time setup in Azure

GitHub proves its identity to Azure for each run (OpenID Connect), so there is no client secret to store or rotate. Create an identity that only this repository's `azure` environment can use, and give it rights on the library's resource group only.

Replace the values in angle brackets. The resource group is `pince-rg` unless you chose another.

```sh
az ad app create --display-name pince-github-deploy --query appId -o tsv
```

```sh
az ad sp create --id <app-id>
```

```sh
az ad app federated-credential create --id <app-id> --parameters '{"name":"github-azure-environment","issuer":"https://token.actions.githubusercontent.com","subject":"repo:<owner>/<repository>:environment:azure","audiences":["api://AzureADTokenExchange"]}'
```

```sh
az role assignment create --assignee <app-id> --role Contributor --scope /subscriptions/<subscription-id>/resourceGroups/<resource-group>
```

```sh
az role assignment create --assignee <app-id> --role "Role Based Access Control Administrator" --scope /subscriptions/<subscription-id>/resourceGroups/<resource-group>
```

The second role is needed because publishing re-applies the template that lets the cover worker read its queue. Both roles stop at the resource group: the identity can do nothing elsewhere in the subscription.

### One-time setup in GitHub

In the repository's **Settings**:

1. **Environments → New environment**, named `azure`. Add yourself under **Required reviewers**, so that every deployment waits for your approval, and limit **Deployment branches and tags** to `main` and `v*` tags.
2. In that environment, add three **secrets**. They are identifiers and not passwords, but as secrets they are blanked in logs:
   - `AZURE_CLIENT_ID`: the app ID from the first command;
   - `AZURE_TENANT_ID`: from `az account show --query tenantId -o tsv`;
   - `AZURE_SUBSCRIPTION_ID`: from `az account show --query id -o tsv`.
3. Optional environment **variables**, if you did not use the defaults: `LIBRARY_RESOURCE_GROUP` and `LIBRARY_LOCATION`.
4. To deploy every release automatically, add the repository **variable** `DEPLOY_RELEASES_TO_AZURE` with the value `true`. Without it, releases are published and Azure is updated only when you start **Deploy to Azure** by hand from the **Actions** tab.
5. **Branches → Add rule** for `main`: require the **Tests** checks to pass before merging.

### What the public log shows

The log of a public repository can be read by anyone, so the deploy workflow blanks the subscription's name, the names and addresses of the library's resources, and the deployment token before anything is published. A blanked value appears as `***`. Storage keys and service keys never pass through the log: the scripts hand them over through standard input.

If you ever see a real address, key or name in a log, delete that run's log from the **Actions** tab and, for a key, rotate it at the service that issued it.

## How the workflows are kept safe

- **Least privilege.** Every workflow starts with read-only access to the repository. Only the release job may write (to create the release), and only the deploy job may ask Azure for a token.
- **No secrets for pull requests.** Pull requests, including those from forks, run only the Tests workflow, which uses no secrets.
- **Pinned actions.** Each action is referenced by its exact commit, with the version in a comment, so a moved tag cannot change what runs. When updating one, replace both.
- **Approval before Azure.** With required reviewers on the `azure` environment, nothing is deployed until you approve that run.
- **One deployment at a time.** A second deployment waits for the first instead of interrupting it.

One of the tests fails if a workflow references an action by a tag, or if the deploy workflow gains a pull-request trigger.

## Not automated

- Creating a library (`init`), cost alerts (`budgets`) and storing service keys stay manual, because they take passwords or keys typed by you.
- Removing a library is manual too, and deliberately needs a typed confirmation: `./scripts/deploy.sh destroy`.
