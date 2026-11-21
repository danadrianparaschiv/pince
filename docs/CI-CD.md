# Continuous integration and delivery

Four GitHub Actions workflows check every change, publish releases and the container image, and deploy to Azure. None of them stores a password or a key, and none of them runs with access to Azure for a pull request.

| Workflow | Runs when | What it does |
| --- | --- | --- |
| [Tests](../.github/workflows/tests.yml) | Every push to `main` and every pull request | Checks all three targets, with no secrets and no cloud account |
| [Release](../.github/workflows/release.yml) | A version tag such as `v1.2.0` is pushed | Checks the code, publishes a GitHub release and the container image, and optionally deploys it to Azure |
| [Container image](../.github/workflows/image.yml) | Called by a release | Builds the image for x86-64 and ARM64, tries each as a container, and publishes it to the GitHub registry |
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

**The container image**, with Docker and nothing else, on x86-64 and on ARM64:

1. builds the image from the `Dockerfile`;
2. checks that only the library's own files are in it;
3. starts a container and uses it, with the same steps as for the local library, and checks that it reports itself healthy, does not run as root, and stops cleanly;
4. checks that the Compose example is valid.

You can run the same checks on your computer:

```sh
npm run doctor
npm run check
npm run smoke
shellcheck scripts/deploy.sh
./scripts/deploy.sh package /tmp/pince-package
docker build -t pince .
SMOKE_IMAGE=pince npm run smoke
```

## Releasing

A release is how people who run Pince on their own computer or in a container get a new version, and it is the point at which Azure is updated.

The new version number reaches `main` through a pull request, like any other change, and the tag follows once it is merged. For version 1.2.0:

```sh
git switch -c release-1.2.0 origin/main
npm version minor --no-git-tag-version
git commit -am "Release 1.2.0"
git push -u origin release-1.2.0
```

`npm version` raises the version in `package.json` (`patch`, `minor` or `major`); `--no-git-tag-version` leaves the commit and the tag to you. Open a pull request for the branch and merge it when the checks pass. Then tag the merged commit and push the tag:

```sh
git fetch origin
git tag v1.2.0 origin/main
git push origin v1.2.0
```

The Release workflow refuses a tag that does not match `package.json`, runs the full checks, and then publishes a GitHub release with notes generated from the merged pull requests. A pushed release tag cannot be moved or deleted, and a published release cannot be changed, so a mistake is corrected with the next version.

To update a local library from a release, download it or pull the tag, then run `npm run setup` and `npm start`. The data in `.library/` is left alone.

### The container image

After the GitHub release exists, the same run publishes the image:

1. It builds the image on an x86-64 and on an ARM64 runner, starts a container of each build and uses it, with the steps of `npm run smoke`. A build that fails this is not pushed, and then nothing is published under the version's names.
2. It joins the two builds under the version's names. Release 1.2.3 is published as `1.2.3`, `1.2`, `1` and `latest`, so a library that follows `1` gets fixes and features by pulling again.
3. It stores a signed record that the image was built by this workflow from this repository, which `gh attestation verify` checks; see [Running in a container](DOCKER.md#checking-where-an-image-came-from).

The registry accepts the workflow's own token, which exists for that run only, so nothing is stored. The image is named after the repository: a fork publishes to its own account.

**Once, after the first release:** check that the image can be pulled without signing in. GitHub can create a new package as private; if it did, open the package from your profile's **Packages** tab and make it public under **Package settings → Change visibility**. Later releases keep that choice.

A published image is never rebuilt. When the image's base has a newer build, Dependabot proposes the change as a pull request; merge it and release a patch version to publish it. Dependabot proposes newer packages and newer versions of the workflows' actions the same way.

## Deploying to Azure

The workflow runs `./scripts/deploy.sh publish`, the same command you would run by hand. It updates the site, the API and the cover worker, keeps the stored service keys, and ends with the script's own checks against the published site.

It does **not** create a library. Run `./scripts/deploy.sh setup` once from your computer first, because it asks for the two account passwords; see [DEPLOY.md](../DEPLOY.md). Service keys are also stored from your computer, as described in [Configuration](CONFIGURATION.md#storing-a-service-key).

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
5. The rules under [Repository rules](#repository-rules) below.

### What the public log shows

The log of a public repository can be read by anyone, so the deploy workflow blanks the subscription's name, the names and addresses of the library's resources, and the deployment token before anything is published. A blanked value appears as `***`. Storage keys and service keys never pass through the log: the scripts hand them over through standard input.

If you ever see a real address, key or name in a log, delete that run's log from the **Actions** tab and, for a key, rotate it at the service that issued it.

## Repository rules

These are settings of the repository on GitHub, not files in it, so a fork starts without them. In **Settings**:

| Where | Setting | Why |
| --- | --- | --- |
| Branches, rule for `main` | Require a pull request and the **Tests** checks, with no approvals required, for administrators too; no force pushes, no deletion | Nothing reaches `main` unchecked, not even from the maintainer |
| General, Pull Requests | Allow squash merging only; automatically delete head branches | One commit on `main` for each pull request, which the release notes are built from |
| Rules, Rulesets | A tag ruleset for `v*` that restricts updates and deletions | A tag is what publishes an image, and an image never changes |
| General, Releases | Enable release immutability | A published release cannot be edited or re-pointed |
| Actions, General | Require approval for all external contributors; read-only workflow permissions | A stranger's pull request runs nothing until you have looked at it |
| Advanced Security | Dependabot alerts and security updates, secret scanning with push protection, private vulnerability reporting, CodeQL default setup | Known problems in packages, keys pushed by mistake and risky code are reported, to you first |

One person cannot approve their own pull request, which is why no approval is required. With more than one maintainer, require one.

## How the workflows are kept safe

- **Least privilege.** Every workflow starts with read-only access to the repository. Only the release job may write to it (to create the release), only the image jobs may write to the registry, and only the deploy job may ask Azure for a token.
- **No secrets for pull requests.** Pull requests, including those from forks, run only the Tests workflow, which uses no secrets.
- **Pinned actions.** Each action is referenced by its exact commit, with the version in a comment, so a moved tag cannot change what runs. When updating one, replace both.
- **Approval before Azure.** With required reviewers on the `azure` environment, nothing is deployed until you approve that run.
- **One deployment at a time.** A second deployment waits for the first instead of interrupting it.

- **Tried before published.** An image is pushed only after a container of it has passed the start-up check, and only a release can start that workflow.

One of the tests fails if a workflow references an action by a tag, if the deploy workflow gains a pull-request trigger, or if anything but a release could publish an image.

## Not automated

- Creating a library (`init`), cost alerts (`budgets`) and storing service keys stay manual, because they take passwords or keys typed by you.
- Removing a library is manual too, and deliberately needs a typed confirmation: `./scripts/deploy.sh destroy`.
- Making the image's package public, once, is done by hand in GitHub.
